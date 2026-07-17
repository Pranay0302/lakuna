"""LLM clients for paper expert agents."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Callable, Protocol


OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "nvidia/nemotron-3-super-120b-a12b:free")
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")
RETRYABLE_HTTP_STATUSES = {408, 409, 425, 429, 500, 502, 503, 504}


class PaperExpertLLM(Protocol):
    """Completion interface used by paper expert agents."""

    def complete(self, messages: list[dict[str, str]]) -> str:
        """Return the assistant text for a chat-style prompt."""


@dataclass
class OfflineResearchLLM:
    """Deterministic local fallback used when no cloud/local LLM credentials exist.

    It emits the same structured formats the brainstorm parsers expect, so the
    backend remains fully usable in hosted demos without leaking or requiring
    API keys. Outputs are intentionally conservative and labeled by downstream
    code as heuristic rather than benchmarked model results.
    """

    def complete(self, messages: list[dict[str, str]]) -> str:
        prompt = "\n\n".join(message.get("content", "") for message in messages)
        area = _extract_prompt_field(prompt, "Research area") or "the selected knowledge void"
        paper = _extract_paper_title(prompt) or "the selected paper"
        problem = _extract_prompt_field(prompt, "Problem") or area
        iteration = _extract_prompt_field(prompt, "Iteration") or "1"

        if "---ORCHESTRATION_DIAGNOSIS---" in prompt:
            return (
                "---ORCHESTRATION_DIAGNOSIS---\n"
                "SUMMARY: The current editable model should be improved through a small, controlled architecture "
                "and optimizer change while preserving the run command and metrics contract.\n"
                "DATASET_CONTEXT:\n"
                "- The backend evaluation command writes metrics to logs/latest_metrics.json.\n"
                "- The editable surface is intentionally narrow, usually model.py.\n"
                "ISSUES:\n"
                "- Weak baselines often underfit because capacity, activation choice, or dropout is too conservative.\n"
                "- Any code change must preserve build_model(), TRAINING_CONFIG, and tensor shapes expected by train.py.\n"
                "SUGGESTIONS:\n"
                "- Increase useful capacity without changing the dataset or evaluation command.\n"
                "- Prefer ReLU/GELU, Adam/AdamW, moderate dropout, and valid output class dimensions.\n"
                "---END---"
            )

        if "---MODEL_IDEA---" in prompt:
            focus, change = _offline_paper_strategy(paper)
            return (
                "---MODEL_IDEA---\n"
                f"TEXT: Use {paper} as the evidence lens for a {focus} candidate addressing {problem}.\n"
                f"RATIONALE: The retrieved passage from {paper} supports testing {focus} under the fixed benchmark rather than making an ungrounded generic change.\n"
                "EXPECTED_EFFECT: Improve the required test metric while preserving input, output, and metrics contracts.\n"
                f"CHANGES: {change}\n"
                "---END---"
            )

        if "---MODEL_CROSS_IDEA---" in prompt:
            seed = _extract_prompt_field(prompt, "Seed idea from") or "the companion proposal"
            return (
                "---MODEL_CROSS_IDEA---\n"
                f"TEXT: Cross-test {paper} against {seed} in one controlled candidate for {problem}.\n"
                "CONNECTION: The first paper supplies a representation or optimization mechanism while the seed supplies the complementary constraint; the bridge is tested through ablation on one unchanged evaluation command.\n"
                "CHANGES: Combine only the compatible mechanisms, preserve tensor shapes and public APIs, and isolate the contribution with the judge's before/after metric.\n"
                "---END---"
            )

        if "Numeric decision:" in prompt and "Previous metrics:" in prompt and "New metrics:" in prompt:
            return (
                "The numeric judge should keep the change if the required metric improved and the evaluation "
                "produced a valid metrics file. The next round should preserve the shape-safe architecture cleanup, "
                "then tune capacity and regularization rather than reverting to the weak baseline."
            )

        if "---FILE:" in prompt and "model.py" in prompt:
            return _offline_model_replacement(prompt)

        if "---RESEARCH_PLAN---" in prompt:
            return (
                "---RESEARCH_PLAN---\n"
                f"SUMMARY: Iteration {iteration} implements the highest-confidence evidence-backed mechanism selected by the search and paper-analysis agents, while preserving the benchmark contract.\n"
                "TARGET_FILES:\n"
                "- model.py\n"
                "STEPS:\n"
                "- Preserve build_model(), MODEL_CONFIG, and TRAINING_CONFIG names.\n"
                "- Apply the selected representation and optimization changes as a shape-safe candidate.\n"
                "- Keep output class count compatible with the dataset and retain deterministic evaluation.\n"
                "EXPECTED_EFFECT: The next evaluation should produce a higher test_accuracy than the baseline.\n"
                "VALIDATION: Keep only if the judge sees a valid metrics file and non-regressed test_accuracy.\n"
                "---END---"
            )

        if "---CROSSPOLLINATE---" in prompt:
            seed_title = _extract_seed_title(prompt) or "the companion paper"
            return (
                "---CROSSPOLLINATE---\n"
                f"TEXT: Combine {paper} with {seed_title} through a shared evaluation protocol for {area}.\n"
                "CONNECTION: Use the first paper as the primary signal source and the second as the stress-test "
                "or transfer setting, then compare utility, robustness, and privacy leakage under the same metrics.\n"
                "---END---"
            )

        if "---IDEA---" in prompt:
            return (
                "---IDEA---\n"
                f"TEXT: Prototype a grounded {area} experiment using {paper} as the baseline method.\n"
                "GROUNDING: The paper supplies the core representation, model family, or evaluation signal for a "
                "minimal reproducible study.\n"
                "GAP: Test whether the same signal remains useful under a stricter cross-domain, robustness, or "
                "privacy-preserving constraint.\n"
                "---END---"
            )

        return (
            f"## Research Agenda: {area}\n\n"
            "### Conservative benchmark bridge\n"
            "**Core idea**: Turn the selected paper cluster into a shared benchmark with comparable inputs, metrics, "
            "and ablations.\n"
            "**Papers it draws from**: The selected source papers.\n"
            "**Why this is promising**: It separates genuine signal transfer from coincidental topical overlap.\n"
            "**First step**: Implement a small baseline and report utility, robustness, and failure cases.\n\n"
            "### Cross-paper stress test\n"
            "**Core idea**: Pair each proposed method with another paper's evaluation setting.\n"
            "**Papers it draws from**: Seed and cross-pollinated ideas.\n"
            "**Why this is promising**: Strong ideas should survive transfer beyond their original experimental setup.\n"
            "**First step**: Run one transfer experiment and compare against the original baseline.\n\n"
            "### Open Questions\n"
            "- Which signal transfers across papers without overfitting?\n"
            "- Which ablation best explains the predicted gain?"
        )

    def complete_stream(
        self,
        messages: list[dict[str, str]],
        on_token: Callable[[str], None],
    ) -> str:
        text = self.complete(messages)
        for token in _stream_chunks(text):
            on_token(token)
            time.sleep(0.01)
        return text


@dataclass
class OpenRouterLLM:
    """Chat-completions client with switchable backends.

    Set LLM_BACKEND=openrouter (default) to use OpenRouter cloud inference, or
    LLM_BACKEND=gx10 to route all inference to the ASUS GX10 local server.

    GX10 requires LOCAL_LLM_URL (e.g. http://100.123.34.54:11434).
    Optionally set LOCAL_LLM_MODEL to override the model name (defaults to gemma4:31b)
    and LOCAL_LLM_MAX_TOKENS / LOCAL_LLM_TIMEOUT for capacity tuning.
    """

    model: str = OPENROUTER_MODEL
    api_key_env: str = "OPENROUTER_API_KEY"
    base_url: str = "https://openrouter.ai/api/v1/chat/completions"
    timeout: float = 60.0
    max_tokens: int = 700
    temperature: float = 0.2
    max_retries: int = 3
    retry_base_delay: float = 1.0

    def complete(self, messages: list[dict[str, str]]) -> str:
        """Return the full completion text (blocking, no streaming)."""
        return self._request(messages, stream=False)

    def complete_stream(
        self,
        messages: list[dict[str, str]],
        on_token: Callable[[str], None],
    ) -> str:
        """
        Stream the completion token-by-token via on_token callback.
        Returns the full concatenated text when the stream ends.
        """
        try:
            return self._request(messages, stream=True, on_token=on_token)
        except RuntimeError as exc:
            if not _should_fallback_to_non_streaming(exc):
                raise
            return self._request(messages, stream=False)

    # ── internals ─────────────────────────────────────────────────────────────

    def _build_request(self, messages: list[dict[str, str]], stream: bool) -> urllib.request.Request:
        backend = os.environ.get("LLM_BACKEND", "openrouter").lower()
        if backend == "gx10":
            gx10_url = os.environ.get("LOCAL_LLM_URL")
            if not gx10_url:
                raise RuntimeError("LOCAL_LLM_URL must be set when LLM_BACKEND=gx10")
            url = f"{gx10_url.rstrip('/')}/v1/chat/completions"
            api_key = "ollama"
            model = os.environ.get("LOCAL_LLM_MODEL", self.model)
            max_tokens = int(os.environ.get("LOCAL_LLM_MAX_TOKENS", "2048"))
        else:
            url = self.base_url
            api_key = os.environ.get(self.api_key_env)
            if not api_key:
                raise RuntimeError(f"{self.api_key_env} is required when LLM_BACKEND=openrouter.")
            model = self.model
            max_tokens = self.max_tokens

        print(f"[LLM] backend={backend} model={model}", flush=True)
        payload = {
            "model": model,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": max_tokens,
            "stream": stream,
        }
        return urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/local/agentswarm",
                "X-Title": "Agent Swarm",
            },
            method="POST",
        )

    def _request(
        self,
        messages: list[dict[str, str]],
        *,
        stream: bool,
        on_token: Callable[[str], None] | None = None,
    ) -> str:
        backend = os.environ.get("LLM_BACKEND", "openrouter").lower()
        timeout = float(os.environ.get("LOCAL_LLM_TIMEOUT", "300")) if backend == "gx10" else self.timeout
        attempts = max(1, self.max_retries + 1)
        last_error: RuntimeError | None = None

        for attempt in range(attempts):
            request = self._build_request(messages, stream)
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    if stream:
                        return self._consume_stream(response, on_token)
                    body = response.read().decode("utf-8")
                return self._extract_content(json.loads(body))
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                last_error = RuntimeError(f"LLM request failed with HTTP {exc.code}: {detail}")
                if exc.code not in RETRYABLE_HTTP_STATUSES or attempt == attempts - 1:
                    raise last_error from exc
                self._sleep_before_retry(attempt)
            except urllib.error.URLError as exc:
                last_error = RuntimeError(f"LLM request failed: {exc.reason}")
                if attempt == attempts - 1:
                    raise last_error from exc
                self._sleep_before_retry(attempt)
            except RuntimeError as exc:
                last_error = exc
                if not _is_retryable_runtime_error(exc) or attempt == attempts - 1:
                    raise
                self._sleep_before_retry(attempt)

        raise last_error or RuntimeError("LLM request failed without a captured error.")

    def _sleep_before_retry(self, attempt: int) -> None:
        delay = self.retry_base_delay * (2 ** attempt)
        if delay > 0:
            time.sleep(delay)

    @staticmethod
    def _consume_stream(
        response: object,
        on_token: Callable[[str], None] | None,
    ) -> str:
        """Parse Server-Sent Events lines from the streaming response body."""
        parts: list[str] = []
        while True:
            raw = response.readline()  # type: ignore[attr-defined]
            if not raw:
                break
            line = raw.decode("utf-8").rstrip("\r\n")
            if not line or line == "data: [DONE]":
                continue
            if not line.startswith("data: "):
                continue
            try:
                data = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            if data.get("error"):
                raise RuntimeError(f"LLM stream failed: {data['error']!r}")
            choice = (data.get("choices") or [{}])[0]
            delta_obj = choice.get("delta") or {}
            delta = (
                delta_obj.get("content")
                or delta_obj.get("reasoning_content")
                or choice.get("text")
                or (choice.get("message") or {}).get("content")
                or ""
            )
            if delta:
                if on_token is not None:
                    on_token(delta)
                parts.append(delta)

        text = "".join(parts).strip()
        if not text:
            raise RuntimeError("LLM returned an empty streaming completion.")
        return text

    @staticmethod
    def _extract_content(data: dict) -> str:
        try:
            msg = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"LLM returned an unexpected response: {data!r}") from exc
        text = str(msg.get("content") or msg.get("reasoning") or "").strip()
        if not text:
            raise RuntimeError("LLM returned an empty completion.")
        return text


@dataclass
class AnthropicLLM:
    """Claude client via the official Anthropic SDK (LLM_BACKEND=anthropic).

    Requires ANTHROPIC_API_KEY. Uses the Messages API: OpenAI-style ``system``
    messages are hoisted to the top-level ``system`` parameter, and the rest
    become the ``messages`` turns. No sampling params are sent — temperature /
    top_p / top_k are removed on Claude Opus 4.8 (they return a 400).
    """

    model: str = ANTHROPIC_MODEL
    api_key_env: str = "ANTHROPIC_API_KEY"
    timeout: float = 300.0
    max_tokens: int = 2048
    max_retries: int = 3
    _client: object | None = field(default=None, init=False, repr=False)

    def _client_or_init(self):
        if self._client is None:
            try:
                import anthropic
            except ModuleNotFoundError as exc:  # pragma: no cover - env guard
                raise RuntimeError(
                    "The 'anthropic' package is required when LLM_BACKEND=anthropic "
                    "(pip install anthropic)."
                ) from exc
            api_key = os.environ.get(self.api_key_env)
            if not api_key:
                raise RuntimeError(f"{self.api_key_env} is required when LLM_BACKEND=anthropic.")
            self._client = anthropic.Anthropic(
                api_key=api_key, timeout=self.timeout, max_retries=self.max_retries
            )
        return self._client

    @staticmethod
    def _split(messages: list[dict[str, str]]) -> tuple[str | None, list[dict[str, str]]]:
        """Split OpenAI-style messages into (system_prompt, conversation_turns)."""
        system_parts: list[str] = []
        conversation: list[dict[str, str]] = []
        for message in messages:
            role = message.get("role")
            content = message.get("content", "") or ""
            if role == "system":
                system_parts.append(content)
            else:
                conversation.append(
                    {"role": "assistant" if role == "assistant" else "user", "content": content}
                )
        if not conversation:
            # Anthropic requires at least one message; fall back to the system text.
            conversation = [{"role": "user", "content": "\n\n".join(system_parts) or "Continue."}]
        system = "\n\n".join(part for part in system_parts if part).strip() or None
        return system, conversation

    def _request_kwargs(self, messages: list[dict[str, str]]) -> dict:
        system, conversation = self._split(messages)
        kwargs: dict = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": conversation,
        }
        if system:
            kwargs["system"] = system
        return kwargs

    def complete(self, messages: list[dict[str, str]]) -> str:
        client = self._client_or_init()
        print(f"[LLM] backend=anthropic model={self.model}", flush=True)
        message = client.messages.create(**self._request_kwargs(messages))
        text = "".join(b.text for b in message.content if b.type == "text").strip()
        if not text:
            raise RuntimeError("Claude returned an empty completion.")
        return text

    def complete_stream(
        self,
        messages: list[dict[str, str]],
        on_token: Callable[[str], None],
    ) -> str:
        client = self._client_or_init()
        print(f"[LLM] backend=anthropic model={self.model}", flush=True)
        parts: list[str] = []
        with client.messages.stream(**self._request_kwargs(messages)) as stream:
            for text in stream.text_stream:
                if text:
                    on_token(text)
                    parts.append(text)
        out = "".join(parts).strip()
        if not out:
            raise RuntimeError("Claude returned an empty streaming completion.")
        return out


def build_llm(
    model: str | None = None,
    *,
    max_tokens: int = 700,
    temperature: float = 0.2,
    **kwargs,
) -> PaperExpertLLM:
    """Construct the LLM client for the configured backend (env ``LLM_BACKEND``).

    - ``offline``    → deterministic local fallback (default for hosted demos)
    - ``anthropic``  → Claude via the official Anthropic SDK (needs ANTHROPIC_API_KEY)
    - ``openrouter`` → OpenRouter cloud inference
    - ``gx10``       → local OpenAI-compatible server

    ``temperature`` is accepted for call-site compatibility but ignored on the
    Anthropic path (unsupported on Claude Opus 4.8).
    """
    backend = os.environ.get("LLM_BACKEND", "offline").lower()
    if backend in {"offline", "deterministic", "none", "mock"}:
        return OfflineResearchLLM()
    if backend == "anthropic":
        # OpenRouter model ids (e.g. "nvidia/...") mean nothing to Anthropic —
        # only honor an explicit claude-* override, else use the default.
        claude_model = model if (model and str(model).startswith("claude")) else ANTHROPIC_MODEL
        return AnthropicLLM(model=claude_model, max_tokens=max(int(max_tokens), 1024))
    return OpenRouterLLM(
        model=model or OPENROUTER_MODEL,
        max_tokens=max_tokens,
        temperature=temperature,
        **kwargs,
    )


def _extract_prompt_field(prompt: str, field: str) -> str:
    match = re.search(rf"^{re.escape(field)}:\s*(.+)$", prompt, flags=re.MULTILINE)
    return match.group(1).strip() if match else ""


def _extract_paper_title(prompt: str) -> str:
    patterns = [
        r"expert for '([^']+)'",
        r"paper '([^']+)'",
        r"YOUR paper \('([^']+)'\)",
        r"Evidence from YOUR paper \('([^']+)'\)",
    ]
    for pattern in patterns:
        match = re.search(pattern, prompt)
        if match:
            return match.group(1).strip()
    return ""


def _extract_seed_title(prompt: str) -> str:
    match = re.search(r"Another expert \(for '([^']+)'\)", prompt)
    return match.group(1).strip() if match else ""


def _offline_paper_strategy(title: str) -> tuple[str, str]:
    lowered = title.lower()
    if "self-supervised" in lowered or "contrastive" in lowered:
        return (
            "normalization-stable contrastive representation",
            "Add shape-safe normalization and a stronger feature projection, reduce destructive dropout, and use AdamW so the supervised proxy can test whether the representation transfers.",
        )
    if "ordinary differential" in lowered or "neural ode" in lowered or "node" in lowered:
        return (
            "stable residual feature-evolution",
            "Use residual feature blocks with conservative step-like updates, normalization, and gradient-stable activations while preserving the classifier head.",
        )
    if "transformer" in lowered or "attention" in lowered:
        return (
            "local-to-global feature mixing",
            "Strengthen the convolutional stem and add efficient channel/context mixing with GELU and normalization without changing the fixed image or class dimensions.",
        )
    if "gan" in lowered or "generative" in lowered:
        return (
            "robust feature discrimination",
            "Increase discriminator-like feature capacity, use moderate regularization, and avoid unstable generative objectives in the fixed classification benchmark.",
        )
    if "point cloud" in lowered or "registration" in lowered or "medical" in lowered:
        return (
            "multi-scale geometry-aware representation",
            "Use a multi-scale convolutional hierarchy with normalization and residual feature preservation so local and global structure remain available to the classifier.",
        )
    return (
        "paper-grounded robust representation",
        "Increase useful capacity with normalization and modern activations, retain the fixed public API, and validate the change with the unchanged metric command.",
    )


def _stream_chunks(text: str) -> list[str]:
    words = text.split(" ")
    return [word + (" " if i < len(words) - 1 else "") for i, word in enumerate(words)]


def _offline_model_replacement(prompt: str) -> str:
    if "Tiny-ImageNet" in prompt or "64x64 RGB" in prompt or "num_classes\": 200" in prompt:
        body = '''from __future__ import annotations

import torch
from torch import nn


MODEL_CONFIG = {
    "channels": [24, 48, 96],
    "dropout": 0.15,
    "activation": "gelu",
    "use_batchnorm": True,
    "num_classes": 200,
}

TRAINING_CONFIG = {
    "epochs": 3,
    "batch_size": 32,
    "learning_rate": 8e-4,
    "optimizer": "adamw",
    "weight_decay": 1e-4,
    "momentum": 0.0,
    "seed": 42,
    "limit_train": 1200,
    "limit_test": 300,
    "image_size": 64,
    "lr_scheduler": "cosine_decay",
}

OPTIMIZER_CONFIG = {
    "optimizer": "adamw",
    "beta_1": 0.9,
    "beta_2": 0.98,
}


class BaselineCNNImageNet(nn.Module):
    def __init__(self, config: dict | None = None) -> None:
        super().__init__()
        config = dict(MODEL_CONFIG if config is None else config)
        channels = list(config.get("channels", [24, 48, 96]))
        dropout = float(config.get("dropout", 0.15))
        use_batchnorm = bool(config.get("use_batchnorm", True))
        num_classes = int(config.get("num_classes", 200))

        layers: list[nn.Module] = []
        in_channels = 3
        for out_channels in channels:
            out_channels = int(out_channels)
            layers.append(nn.Conv2d(in_channels, out_channels, kernel_size=3, stride=1, padding=1, bias=not use_batchnorm))
            if use_batchnorm:
                layers.append(nn.BatchNorm2d(out_channels))
            layers.append(nn.GELU())
            layers.append(nn.Conv2d(out_channels, out_channels, kernel_size=3, stride=1, padding=1, bias=not use_batchnorm))
            if use_batchnorm:
                layers.append(nn.BatchNorm2d(out_channels))
            layers.append(nn.GELU())
            layers.append(nn.MaxPool2d(2, 2))
            layers.append(nn.Dropout2d(dropout))
            in_channels = out_channels

        self.features = nn.Sequential(*layers)
        self.pool = nn.AdaptiveAvgPool2d((1, 1))
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(in_channels, 256),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(256, num_classes),
        )

    def forward(self, images: torch.Tensor) -> torch.Tensor:
        x = self.features(images)
        x = self.pool(x)
        return self.classifier(x)


def build_model() -> nn.Module:
    return BaselineCNNImageNet()
'''
    else:
        body = '''"""Improved MNIST fully connected model for the research swarm."""

from __future__ import annotations

import torch
from torch import nn


MODEL_CONFIG = {
    "hidden_sizes": [256, 128],
    "dropout": 0.15,
    "activation": "gelu",
}

TRAINING_CONFIG = {
    "epochs": 3,
    "batch_size": 128,
    "learning_rate": 1e-3,
    "optimizer": "adamw",
    "weight_decay": 1e-4,
    "seed": 7,
    "limit_train": 6000,
    "limit_test": 1000,
}


class BaselineFullyConnectedMNIST(nn.Module):
    """A compact but capable MLP that preserves the train.py contract."""

    def __init__(self, config: dict | None = None) -> None:
        super().__init__()
        config = dict(MODEL_CONFIG if config is None else config)
        hidden_sizes = list(config.get("hidden_sizes", [256, 128]))
        dropout = float(config.get("dropout", 0.15))

        layers: list[nn.Module] = [nn.Flatten()]
        in_features = 28 * 28
        for hidden_size in hidden_sizes:
            hidden_size = int(hidden_size)
            layers.append(nn.Linear(in_features, hidden_size))
            layers.append(nn.LayerNorm(hidden_size))
            layers.append(nn.GELU())
            layers.append(nn.Dropout(dropout))
            in_features = hidden_size
        layers.append(nn.Linear(in_features, 10))
        self.net = nn.Sequential(*layers)

    def forward(self, images: torch.Tensor) -> torch.Tensor:
        return self.net(images)


def build_model() -> nn.Module:
    return BaselineFullyConnectedMNIST()
'''
    return f"---FILE: model.py---\n```python\n{body.rstrip()}\n```\n---END FILE---"


def _should_fallback_to_non_streaming(exc: RuntimeError) -> bool:
    text = str(exc)
    return (
        "empty streaming completion" in text
        or "LLM stream failed" in text
        or any(f"HTTP {status}" in text for status in RETRYABLE_HTTP_STATUSES)
    )


def _is_retryable_runtime_error(exc: RuntimeError) -> bool:
    text = str(exc)
    return (
        "empty streaming completion" in text
        or "LLM stream failed" in text
        or any(f"HTTP {status}" in text for status in RETRYABLE_HTTP_STATUSES)
    )
