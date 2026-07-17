"""Opt-in Exa web search through the Zero capability marketplace.

The integration deliberately uses the Zero CLI instead of calling Exa directly:
Zero discovers the current capability, exposes its schema, enforces a spend cap,
handles payment, and records the run.  Nothing is charged unless ``search`` is
called, which only happens when the research CLI receives ``--zero-exa``.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Sequence
from urllib.parse import urlencode, urlsplit, urlunsplit


class ZeroServiceError(RuntimeError):
    """Raised when Zero cannot discover or call the configured capability."""


@dataclass(frozen=True)
class ZeroSearchHit:
    title: str
    url: str
    text: str
    score: float = 0.0


CommandRunner = Callable[[Sequence[str], float], subprocess.CompletedProcess[str]]


class ZeroExaSearch:
    """One Zero service: live research search backed by Exa.

    A capability is re-discovered and inspected before every paid fetch, as
    required by Zero's changing marketplace.  ``max_pay_usd`` is passed to the
    runner as a hard per-call cap.
    """

    discovery_query = "Exa Search API semantic web search research papers"

    def __init__(
        self,
        *,
        max_results: int = 4,
        max_pay_usd: float = 0.02,
        timeout_s: float = 60.0,
        executable: str | None = None,
        runner: CommandRunner | None = None,
    ) -> None:
        if max_results < 1:
            raise ValueError("max_results must be at least 1")
        if max_pay_usd <= 0:
            raise ValueError("max_pay_usd must be positive")
        self.max_results = max_results
        self.max_pay_usd = max_pay_usd
        self.timeout_s = timeout_s
        self.executable = executable or resolve_zero_executable()
        self._runner = runner or _subprocess_runner

    def search(self, query: str) -> list[ZeroSearchHit]:
        query = " ".join(query.split())[:1200]
        if not query:
            return []
        if not self.executable:
            raise ZeroServiceError(
                "Zero CLI is unavailable. Install @zeroxyz/cli and authenticate with `zero auth login`."
            )

        search_data = self._json_command(["search", self.discovery_query, "--json"])
        capability = _select_exa_capability(search_data)
        reference = str(
            capability.get("token")
            or capability.get("slug")
            or capability.get("uid")
            or ""
        )
        if not reference:
            raise ZeroServiceError("Zero search returned Exa without a capability reference")

        details = self._json_command(["get", reference])
        endpoint = _find_string(details, ("url", "endpoint", "requestUrl"))
        schema = _find_value(details, ("bodySchema", "inputSchema", "schema"))
        if not endpoint:
            raise ZeroServiceError("The discovered Exa capability did not include an endpoint URL")
        if schema is None:
            raise ZeroServiceError("The discovered Exa capability has no request schema")

        method = (_find_string(details, ("method",)) or "POST").upper()
        payload = _exa_payload(query, self.max_results, schema)
        fetch_args = ["fetch", endpoint, "--capability", reference]
        if method == "GET":
            fetch_args[1] = _with_query(endpoint, payload)
        else:
            fetch_args += ["-X", method, "-d", json.dumps(payload, separators=(",", ":"))]
        fetch_args += [
            "--max-pay",
            f"{self.max_pay_usd:.4f}",
            "--timeout",
            str(max(1, int(self.timeout_s))),
            "--json",
        ]

        envelope = self._json_command(fetch_args)
        run_id = str(envelope.get("runId") or "") if isinstance(envelope, dict) else ""
        ok = bool(envelope.get("ok")) if isinstance(envelope, dict) and "ok" in envelope else True
        body = envelope.get("body") if isinstance(envelope, dict) and "body" in envelope else envelope
        hits = _normalize_hits(body, self.max_results) if ok else []
        if run_id:
            self._review(run_id, success=ok and bool(hits))
        if not ok:
            detail = envelope.get("bodyRaw") or envelope.get("body") or "unknown Zero fetch error"
            raise ZeroServiceError(f"Zero Exa fetch failed: {detail}")
        return hits

    def _json_command(self, args: Sequence[str]) -> Any:
        command = [self.executable, *args]
        try:
            result = self._runner(command, self.timeout_s + 10)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ZeroServiceError(f"Zero command failed: {exc}") from exc
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "unknown error").strip()
            raise ZeroServiceError(f"Zero command failed ({result.returncode}): {detail}")
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise ZeroServiceError("Zero returned non-JSON output") from exc

    def _review(self, run_id: str, *, success: bool) -> None:
        outcome = "--success" if success else "--no-success"
        args = [self.executable, "review", run_id, outcome]
        if success:
            args += ["--accuracy", "4", "--value", "4", "--reliability", "4"]
        try:
            self._runner(args, min(self.timeout_s, 30) + 5)
        except (OSError, subprocess.TimeoutExpired):
            # A review failure must not discard already-delivered evidence.
            pass


def resolve_zero_executable() -> str | None:
    """Resolve the official Zero runner without installing or modifying anything."""

    candidates = [
        shutil.which("zero"),
        os.environ.get("ZERO_RUNNER"),
        str(Path.home() / ".zero" / "runtime" / "bin" / "zero"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def _subprocess_runner(command: Sequence[str], timeout: float) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(command),
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _walk_dicts(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_dicts(child)


def _select_exa_capability(value: Any) -> dict[str, Any]:
    candidates = [item for item in _walk_dicts(value) if item.get("token") or item.get("slug") or item.get("uid")]
    if not candidates:
        raise ZeroServiceError("Zero did not return any capabilities")

    def rank(item: dict[str, Any]) -> tuple[int, int]:
        text = json.dumps(item, sort_keys=True).lower()
        return (int("exa" in text), int("search" in text))

    selected = max(candidates, key=rank)
    if "exa" not in json.dumps(selected, sort_keys=True).lower():
        raise ZeroServiceError("Zero did not find an Exa search capability")
    return selected


def _find_value(value: Any, keys: Sequence[str]) -> Any:
    for item in _walk_dicts(value):
        for key in keys:
            if key in item:
                return item[key]
    return None


def _find_string(value: Any, keys: Sequence[str]) -> str | None:
    found = _find_value(value, keys)
    return found if isinstance(found, str) and found else None


def _schema_properties(schema: Any) -> set[str]:
    if not isinstance(schema, dict):
        return set()
    properties = schema.get("properties")
    if isinstance(properties, dict):
        for envelope_key in ("body", "queryParams"):
            nested = properties.get(envelope_key)
            if isinstance(nested, dict) and isinstance(nested.get("properties"), dict):
                return set(nested["properties"])
        return set(properties)
    for key in ("body", "queryParams", "input"):
        nested = schema.get(key)
        props = _schema_properties(nested)
        if props:
            return props
    return set()


def _exa_payload(query: str, max_results: int, schema: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "query": query,
        "numResults": max_results,
        "type": "auto",
        "category": "research paper",
        "contents": {
            "text": {"maxCharacters": 1800},
            "highlights": {"numSentences": 3},
        },
    }
    supported = _schema_properties(schema)
    if not supported:
        return payload
    aliases = {"q": query, "limit": max_results, "num_results": max_results}
    shaped = {key: value for key, value in payload.items() if key in supported}
    for key, value in aliases.items():
        if key in supported:
            shaped[key] = value
    if not any(key in shaped for key in ("query", "q")):
        raise ZeroServiceError("The Exa capability schema has no supported query field")
    return shaped


def _with_query(url: str, params: dict[str, Any]) -> str:
    split = urlsplit(url)
    encoded = urlencode(params, doseq=True)
    query = f"{split.query}&{encoded}" if split.query else encoded
    return urlunsplit((split.scheme, split.netloc, split.path, query, split.fragment))


def _normalize_hits(value: Any, limit: int) -> list[ZeroSearchHit]:
    results = _find_value(value, ("results", "items", "data"))
    if isinstance(results, dict):
        results = _find_value(results, ("results", "items"))
    if not isinstance(results, list):
        return []
    hits: list[ZeroSearchHit] = []
    for index, item in enumerate(results):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("name") or f"Exa result {index + 1}")
        url = str(item.get("url") or item.get("id") or "")
        highlights = item.get("highlights")
        if isinstance(highlights, list):
            highlights = "\n".join(str(part) for part in highlights)
        text = str(item.get("summary") or highlights or item.get("text") or item.get("snippet") or "")
        if not text:
            continue
        try:
            score = float(item.get("score") or 0.0)
        except (TypeError, ValueError):
            score = 0.0
        hits.append(ZeroSearchHit(title=title, url=url, text=text[:4000], score=score))
        if len(hits) >= limit:
            break
    return hits
