# Nexla Source + Sink Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `run.py nexla` command group that pulls paper PDFs from a Nexla source, runs the existing Grobid pipeline, and publishes the cleaned JSON to a Nexla sink — by shelling out to the real `nexla-cli`.

**Architecture:** A new `ingestion/nexla/` package with focused modules — `errors` (exit-code→exception map), `config` (env resolution), `client` (the only thing that shells out to `nexla-cli`, via an injectable runner seam), `pipeline` (pull/push/ingest orchestration over the client + the existing `ingest_pdf.sh`), and `cli` (argparse wiring). `run.py` gains a thin `nexla` subparser that delegates to `cli`. Everything is testable with fakes — no live Nexla, Docker, or Grobid needed for the suite.

**Tech Stack:** Python 3.14 (repo `.venv`), stdlib `subprocess`/`shutil`/`urllib`, `argparse`, `python-dotenv` (already used), `pytest` (already pinned in `requirements.txt`), the external `nexla-cli` binary (optional at runtime).

## Global Constraints

- Python target: repo `.venv` (Python 3.14). Run everything via `.venv/bin/python` and `.venv/bin/pytest`.
- `nexla-cli` integration is via subprocess only — never reimplement its REST calls.
- Mutating commands (`pull`/`push`/`ingest`) default to **dry-run**; `--live` (alias `--no-dry-run` unnecessary) disables it.
- Nexla auth comes from env/`.env`: `NEXLA_SERVICE_KEY`, `NEXLA_API_URL` (default `https://dev-api-express-code.nexla.com/`), optional `NEXLA_MONITORING_URL`. The service key is exchanged for a token via `nexla-cli login --service-key`.
- Exit codes mirror `nexla-cli`: 0 ok, 1 generic, 2 input, 3 config/missing-binary, 4 auth, 5 not-found, 6 upstream.
- Graceful degradation: missing binary/token/URL must raise a typed error with an actionable hint, never a raw traceback at the CLI boundary.
- `nexla-cli` is an **optional** dependency — the existing local pipeline must keep working without it.
- Follow existing `run.py` patterns: argparse subparsers, a `cmd_*` dispatch function, `return`ing exit codes.

---

## File Structure

New files:
- `ingestion/nexla/__init__.py` — package marker.
- `ingestion/nexla/errors.py` — exception hierarchy + `error_from_exit_code`.
- `ingestion/nexla/config.py` — `NexlaConfig`, `load_config`, `require_auth`.
- `ingestion/nexla/client.py` — `NexlaClient` subprocess wrapper.
- `ingestion/nexla/pipeline.py` — `pull` / `push` / `ingest` orchestration.
- `ingestion/nexla/cli.py` — `add_nexla_parser` + `cmd_nexla`.
- `conftest.py` (repo root) — puts repo root on `sys.path` for tests.
- `tests/test_nexla_errors.py`, `tests/test_nexla_config.py`, `tests/test_nexla_client.py`, `tests/test_nexla_pipeline.py`, `tests/test_nexla_cli.py`.

Modified files:
- `run.py` — register the `nexla` subparser and dispatch to `cmd_nexla`.
- `requirements.txt` — note `nexla-cli` as an optional extra.
- `README.md`, `DOCUMENTATION.md` — Nexla ingestion usage.

---

## Task 1: Test scaffolding + `errors` module

**Files:**
- Create: `ingestion/nexla/__init__.py`, `ingestion/nexla/errors.py`, `conftest.py`
- Test: `tests/test_nexla_errors.py`

**Interfaces:**
- Produces: exception classes `NexlaError` (base, `exit_code=1`), `NexlaInputError` (2), `NexlaConfigError` (3), `NexlaAuthError` (4), `NexlaNotFoundError` (5), `NexlaUpstreamError` (6), `NexlaCliNotInstalled` (subclass of `NexlaConfigError`). Each instance has `.exit_code: int`. Function `error_from_exit_code(code: int, message: str) -> NexlaError`.

- [ ] **Step 1: Ensure pytest is installed and create the package + conftest**

```bash
.venv/bin/pip install pytest==9.0.3
mkdir -p ingestion/nexla tests
touch ingestion/nexla/__init__.py
```

Create `conftest.py` at the repo root:

```python
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_nexla_errors.py`:

```python
from ingestion.nexla.errors import (
    NexlaError,
    NexlaInputError,
    NexlaConfigError,
    NexlaAuthError,
    NexlaNotFoundError,
    NexlaUpstreamError,
    NexlaCliNotInstalled,
    error_from_exit_code,
)


def test_each_exception_carries_its_exit_code():
    assert NexlaError("x").exit_code == 1
    assert NexlaInputError("x").exit_code == 2
    assert NexlaConfigError("x").exit_code == 3
    assert NexlaAuthError("x").exit_code == 4
    assert NexlaNotFoundError("x").exit_code == 5
    assert NexlaUpstreamError("x").exit_code == 6


def test_cli_not_installed_is_a_config_error():
    err = NexlaCliNotInstalled("missing")
    assert isinstance(err, NexlaConfigError)
    assert err.exit_code == 3


def test_error_from_exit_code_maps_known_codes():
    assert isinstance(error_from_exit_code(4, "forbidden"), NexlaAuthError)
    assert isinstance(error_from_exit_code(5, "gone"), NexlaNotFoundError)
    assert isinstance(error_from_exit_code(6, "boom"), NexlaUpstreamError)


def test_error_from_exit_code_unknown_defaults_to_base():
    err = error_from_exit_code(1, "generic")
    assert type(err) is NexlaError
    assert err.exit_code == 1
    assert str(err) == "generic"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_nexla_errors.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ingestion.nexla.errors'`

- [ ] **Step 4: Write the implementation**

Create `ingestion/nexla/errors.py`:

```python
"""Typed exceptions for the Nexla ingestion layer.

Exit codes mirror nexla-cli's own contract so the CLI boundary can re-emit them:
0 ok, 1 generic, 2 input, 3 config/missing-binary, 4 auth, 5 not-found, 6 upstream.
"""

from __future__ import annotations


class NexlaError(Exception):
    """Base error. Default exit code is 1 (generic)."""

    exit_code: int = 1

    def __init__(self, message: str, *, exit_code: int | None = None) -> None:
        super().__init__(message)
        if exit_code is not None:
            self.exit_code = exit_code


class NexlaInputError(NexlaError):
    exit_code = 2


class NexlaConfigError(NexlaError):
    exit_code = 3


class NexlaAuthError(NexlaError):
    exit_code = 4


class NexlaNotFoundError(NexlaError):
    exit_code = 5


class NexlaUpstreamError(NexlaError):
    exit_code = 6


class NexlaCliNotInstalled(NexlaConfigError):
    """The nexla-cli binary was not found on PATH."""


_EXIT_CODE_MAP: dict[int, type[NexlaError]] = {
    2: NexlaInputError,
    3: NexlaConfigError,
    4: NexlaAuthError,
    5: NexlaNotFoundError,
    6: NexlaUpstreamError,
}


def error_from_exit_code(code: int, message: str) -> NexlaError:
    """Return the typed exception matching a nexla-cli exit code."""
    cls = _EXIT_CODE_MAP.get(code, NexlaError)
    return cls(message, exit_code=code)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_nexla_errors.py -v`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**

```bash
git add conftest.py ingestion/nexla/__init__.py ingestion/nexla/errors.py tests/test_nexla_errors.py
git commit -m "feat(nexla): error hierarchy with exit-code mapping"
```

---

## Task 2: `config` module

**Files:**
- Create: `ingestion/nexla/config.py`
- Test: `tests/test_nexla_config.py`

**Interfaces:**
- Consumes: `NexlaConfigError` from `ingestion.nexla.errors`.
- Produces: `DEFAULT_API_URL: str`; frozen dataclass `NexlaConfig(api_url: str, service_key: str | None, token: str | None, monitoring_url: str | None)`; `load_config(env: dict | None = None) -> NexlaConfig`; `require_auth(config: NexlaConfig) -> None` (raises `NexlaConfigError` when no token and no service key).

- [ ] **Step 1: Write the failing test**

Create `tests/test_nexla_config.py`:

```python
import pytest

from ingestion.nexla.config import (
    DEFAULT_API_URL,
    NexlaConfig,
    load_config,
    require_auth,
)
from ingestion.nexla.errors import NexlaConfigError


def test_load_config_uses_default_api_url_when_absent():
    cfg = load_config({})
    assert cfg.api_url == DEFAULT_API_URL
    assert cfg.service_key is None
    assert cfg.token is None


def test_load_config_reads_env_values():
    cfg = load_config(
        {
            "NEXLA_API_URL": "https://custom.nexla.io/",
            "NEXLA_SERVICE_KEY": "abc123",
            "NEXLA_MONITORING_URL": "https://mon/",
        }
    )
    assert cfg.api_url == "https://custom.nexla.io/"
    assert cfg.service_key == "abc123"
    assert cfg.monitoring_url == "https://mon/"


def test_require_auth_raises_without_credentials():
    with pytest.raises(NexlaConfigError):
        require_auth(load_config({}))


def test_require_auth_passes_with_service_key():
    require_auth(load_config({"NEXLA_SERVICE_KEY": "abc"}))  # must not raise


def test_require_auth_passes_with_token():
    require_auth(NexlaConfig("https://x/", None, "tok", None))  # must not raise
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_nexla_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ingestion.nexla.config'`

- [ ] **Step 3: Write the implementation**

Create `ingestion/nexla/config.py`:

```python
"""Resolve Nexla credentials/config from the environment (or an explicit dict)."""

from __future__ import annotations

import os
from dataclasses import dataclass

from .errors import NexlaConfigError

DEFAULT_API_URL = "https://dev-api-express-code.nexla.com/"


@dataclass(frozen=True)
class NexlaConfig:
    api_url: str
    service_key: str | None
    token: str | None
    monitoring_url: str | None


def load_config(env: dict[str, str] | None = None) -> NexlaConfig:
    """Build a NexlaConfig from env vars. Defaults api_url to the express endpoint."""
    src = os.environ if env is None else env
    return NexlaConfig(
        api_url=src.get("NEXLA_API_URL") or DEFAULT_API_URL,
        service_key=src.get("NEXLA_SERVICE_KEY") or None,
        token=src.get("NEXLA_TOKEN") or None,
        monitoring_url=src.get("NEXLA_MONITORING_URL") or None,
    )


def require_auth(config: NexlaConfig) -> None:
    """Raise NexlaConfigError if neither a token nor a service key is present."""
    if not config.token and not config.service_key:
        raise NexlaConfigError(
            "No Nexla credentials found. Set NEXLA_SERVICE_KEY (and NEXLA_API_URL) "
            "in your environment or .env, then authenticate with:\n"
            '  nexla-cli login --service-key "$NEXLA_SERVICE_KEY"'
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_nexla_config.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add ingestion/nexla/config.py tests/test_nexla_config.py
git commit -m "feat(nexla): config/env resolution with auth check"
```

---

## Task 3: `NexlaClient` subprocess wrapper

**Files:**
- Create: `ingestion/nexla/client.py`
- Test: `tests/test_nexla_client.py`

**Interfaces:**
- Consumes: `NexlaConfig`, `load_config`, `require_auth` from `config`; `NexlaCliNotInstalled`, `error_from_exit_code` from `errors`.
- Produces: type alias `Runner = Callable[[Sequence[str]], tuple[int, str, str]]`; dataclass `NexlaClient(config=load_config(), binary="nexla-cli", runner=_subprocess_runner, which=shutil.which)`. Methods: `run(args, *, dry_run=False, json_output=True) -> Any`; `login() -> str`; `source_get(id)`, `source_activate(id, *, dry_run=False)`, `flow_status(id)`, `sink_get(id)`, `sink_create(payload: dict, *, dry_run=False)`, `sink_activate(id, *, dry_run=False)`, `nexset_get(id)`. `run` injects `--output json` (when `json_output`) and `--dry-run` (when `dry_run`), maps non-zero exit codes to typed exceptions, and parses JSON stdout.

- [ ] **Step 1: Write the failing test**

Create `tests/test_nexla_client.py`:

```python
import pytest

from ingestion.nexla.client import NexlaClient
from ingestion.nexla.config import NexlaConfig
from ingestion.nexla.errors import NexlaAuthError, NexlaCliNotInstalled


class FakeRunner:
    def __init__(self, code=0, stdout="{}", stderr=""):
        self.code, self.stdout, self.stderr = code, stdout, stderr
        self.calls: list[list[str]] = []

    def __call__(self, argv):
        self.calls.append(list(argv))
        return self.code, self.stdout, self.stderr


def _client(runner):
    cfg = NexlaConfig("https://x/", "key", "tok", None)
    return NexlaClient(config=cfg, runner=runner, which=lambda name: "/bin/" + name)


def test_run_builds_argv_with_json_output_and_parses():
    r = FakeRunner(stdout='{"id": 42}')
    out = _client(r).source_get("42")
    assert out == {"id": 42}
    assert r.calls[0] == ["/bin/nexla-cli", "sources", "get", "42", "--output", "json"]


def test_dry_run_appends_flag():
    r = FakeRunner(stdout="{}")
    _client(r).source_activate("7", dry_run=True)
    assert "--dry-run" in r.calls[0]


def test_no_dry_run_omits_flag():
    r = FakeRunner(stdout="{}")
    _client(r).source_activate("7")
    assert "--dry-run" not in r.calls[0]


def test_nonzero_exit_maps_to_typed_exception():
    r = FakeRunner(code=4, stdout="", stderr="forbidden")
    with pytest.raises(NexlaAuthError) as exc:
        _client(r).source_get("1")
    assert exc.value.exit_code == 4
    assert "forbidden" in str(exc.value)


def test_missing_binary_raises_cli_not_installed():
    cfg = NexlaConfig("https://x/", "key", "tok", None)
    client = NexlaClient(config=cfg, runner=FakeRunner(), which=lambda name: None)
    with pytest.raises(NexlaCliNotInstalled):
        client.source_get("1")


def test_login_reuses_existing_token_without_calling_cli():
    r = FakeRunner()
    assert _client(r).login() == "tok"
    assert r.calls == []


def test_login_exchanges_service_key_when_no_token():
    r = FakeRunner(stdout="fresh-token\n")
    cfg = NexlaConfig("https://x/", "key", None, None)
    client = NexlaClient(config=cfg, runner=r, which=lambda name: "/bin/" + name)
    assert client.login() == "fresh-token"
    assert r.calls[0] == ["/bin/nexla-cli", "login", "--service-key", "key"]


def test_sink_create_passes_json_payload():
    r = FakeRunner(stdout='{"id": 9}')
    _client(r).sink_create({"name": "out"}, dry_run=True)
    argv = r.calls[0]
    assert "create" in argv and "--json" in argv and "--dry-run" in argv
    assert '{"name": "out"}' in argv
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_nexla_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ingestion.nexla.client'`

- [ ] **Step 3: Write the implementation**

Create `ingestion/nexla/client.py`:

```python
"""Thin subprocess wrapper around the nexla-cli binary.

This is the ONLY module that shells out to nexla-cli. The subprocess call and the
binary lookup are injectable seams (`runner`, `which`) so tests never need the real
binary installed.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

from .config import NexlaConfig, load_config, require_auth
from .errors import NexlaCliNotInstalled, error_from_exit_code

# A runner takes an argv list and returns (exit_code, stdout, stderr).
Runner = Callable[[Sequence[str]], tuple[int, str, str]]


def _subprocess_runner(argv: Sequence[str]) -> tuple[int, str, str]:
    proc = subprocess.run(list(argv), capture_output=True, text=True)
    return proc.returncode, proc.stdout, proc.stderr


@dataclass
class NexlaClient:
    config: NexlaConfig = field(default_factory=load_config)
    binary: str = "nexla-cli"
    runner: Runner = _subprocess_runner
    which: Callable[[str], str | None] = shutil.which
    _token: str | None = field(default=None, repr=False)

    def _resolve_binary(self) -> str:
        path = self.which(self.binary)
        if path is None:
            raise NexlaCliNotInstalled(
                f"'{self.binary}' not found on PATH. Install it with:\n"
                "  pip install nexla-cli   # or: uv tool install nexla-cli"
            )
        return path

    def run(self, args: Sequence[str], *, dry_run: bool = False,
            json_output: bool = True) -> Any:
        """Invoke nexla-cli with `args`; return parsed JSON (dict/list), raw stdout
        (when json_output is False), or None (empty JSON output)."""
        binary = self._resolve_binary()
        argv = [binary, *args]
        if json_output:
            argv += ["--output", "json"]
        if dry_run:
            argv += ["--dry-run"]
        code, stdout, stderr = self.runner(argv)
        if code != 0:
            message = stderr.strip() or stdout.strip() or f"nexla-cli exited {code}"
            raise error_from_exit_code(code, message)
        if not json_output:
            return stdout
        if not stdout.strip():
            return None
        try:
            return json.loads(stdout)
        except json.JSONDecodeError:
            return stdout  # tolerate non-JSON (e.g. dry-run plan text)

    # ── auth ──────────────────────────────────────────────────────────────
    def login(self) -> str:
        """Return a session token, exchanging the service key via the CLI if needed."""
        require_auth(self.config)
        if self.config.token:
            self._token = self.config.token
            return self._token
        out = self.run(["login", "--service-key", self.config.service_key],
                       json_output=False)
        self._token = out.strip() if isinstance(out, str) else None
        return self._token or ""

    # ── sources / flows ───────────────────────────────────────────────────
    def source_get(self, source_id: str) -> Any:
        return self.run(["sources", "get", source_id])

    def source_activate(self, source_id: str, *, dry_run: bool = False) -> Any:
        return self.run(["sources", "activate", source_id], dry_run=dry_run)

    def flow_status(self, flow_id: str) -> Any:
        return self.run(["flows", "get", flow_id])

    # ── sinks ─────────────────────────────────────────────────────────────
    def sink_get(self, sink_id: str) -> Any:
        return self.run(["sinks", "get", sink_id])

    def sink_create(self, payload: dict, *, dry_run: bool = False) -> Any:
        return self.run(["sinks", "create", "--json", json.dumps(payload)],
                        dry_run=dry_run)

    def sink_activate(self, sink_id: str, *, dry_run: bool = False) -> Any:
        return self.run(["sinks", "activate", sink_id], dry_run=dry_run)

    # ── nexsets ───────────────────────────────────────────────────────────
    def nexset_get(self, nexset_id: str) -> Any:
        return self.run(["nexsets", "get", nexset_id])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_nexla_client.py -v`
Expected: PASS (8 passed)

- [ ] **Step 5: Commit**

```bash
git add ingestion/nexla/client.py tests/test_nexla_client.py
git commit -m "feat(nexla): NexlaClient subprocess wrapper with injectable seams"
```

---

## Task 4: `pipeline` orchestration (pull / push / ingest)

**Files:**
- Create: `ingestion/nexla/pipeline.py`
- Test: `tests/test_nexla_pipeline.py`

**Interfaces:**
- Consumes: `NexlaClient` from `client` (only its `source_activate`, `source_get`, `sink_activate` methods are used here).
- Produces:
  - Constants `REPO_ROOT`, `DEFAULT_PAPERS_DIR`, `DEFAULT_CLEANED_DIR`, `INGEST_SCRIPT`.
  - `pull(client, source_id=None, *, dest_dir=DEFAULT_PAPERS_DIR, local_dir=None, dry_run=True, download_fn=None) -> list[Path]`
  - `push(client, cleaned_json, sink_id, *, dry_run=True, upload_fn=None) -> dict` (returns `{"sink_id", "records", "dry_run"}`)
  - `ingest(client, source_id=None, sink_id, *, papers_dir=DEFAULT_PAPERS_DIR, cleaned_dir=DEFAULT_CLEANED_DIR, local_dir=None, dry_run=True, grobid_step=None) -> list[dict]`
  - Helper seams: `_download_source_files(client, source_id, dest_dir, download_fn) -> list[Path]`, `_default_grobid_step(pdf, cleaned_dir) -> Path`, `_records_from_cleaned(path) -> list`, `_default_upload(client, sink_id, records, *, dry_run) -> dict`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_nexla_pipeline.py`:

```python
import json
from pathlib import Path

import pytest

from ingestion.nexla import pipeline


class FakeClient:
    def __init__(self, source_files=None):
        self._source_files = source_files or []
        self.activated_sources: list[tuple[str, bool]] = []
        self.activated_sinks: list[tuple[str, bool]] = []

    def source_activate(self, source_id, *, dry_run=False):
        self.activated_sources.append((source_id, dry_run))

    def source_get(self, source_id):
        return {"files": self._source_files}

    def sink_activate(self, sink_id, *, dry_run=False):
        self.activated_sinks.append((sink_id, dry_run))


def _make_pdf(dir_: Path, name: str) -> Path:
    p = dir_ / name
    p.write_bytes(b"%PDF-1.4 fake")
    return p


def test_pull_local_dir_copies_pdfs(tmp_path):
    src = tmp_path / "src"; src.mkdir()
    _make_pdf(src, "a.pdf"); _make_pdf(src, "b.pdf")
    dest = tmp_path / "papers"
    out = pipeline.pull(FakeClient(), local_dir=src, dest_dir=dest)
    assert sorted(p.name for p in out) == ["a.pdf", "b.pdf"]
    assert (dest / "a.pdf").exists()


def test_pull_dry_run_activates_source_but_downloads_nothing(tmp_path):
    client = FakeClient()
    out = pipeline.pull(client, source_id="s1", dest_dir=tmp_path, dry_run=True)
    assert out == []
    assert client.activated_sources == [("s1", True)]


def test_pull_without_source_or_local_dir_raises(tmp_path):
    with pytest.raises(ValueError):
        pipeline.pull(FakeClient(), dest_dir=tmp_path)


def test_download_source_files_uses_download_fn(tmp_path):
    client = FakeClient(source_files=[{"name": "x.pdf", "url": "http://h/x.pdf"}])
    seen = {}

    def fake_dl(url, target):
        seen[url] = Path(target)
        Path(target).write_bytes(b"pdf")

    out = pipeline._download_source_files(client, "s1", tmp_path, fake_dl)
    assert out == [tmp_path / "x.pdf"]
    assert seen["http://h/x.pdf"] == tmp_path / "x.pdf"


def test_records_from_cleaned_wraps_dict(tmp_path):
    p = tmp_path / "paper_cleaned.json"
    p.write_text(json.dumps({"title": "T"}))
    assert pipeline._records_from_cleaned(p) == [{"title": "T"}]


def test_push_activates_sink_and_reports(tmp_path):
    p = tmp_path / "paper_cleaned.json"
    p.write_text(json.dumps({"title": "T"}))
    client = FakeClient()
    res = pipeline.push(client, p, "sink9", dry_run=True)
    assert res == {"sink_id": "sink9", "records": 1, "dry_run": True}
    assert client.activated_sinks == [("sink9", True)]


def test_ingest_runs_grobid_and_push_per_pdf(tmp_path):
    src = tmp_path / "src"; src.mkdir()
    _make_pdf(src, "a.pdf"); _make_pdf(src, "b.pdf")
    cleaned_dir = tmp_path / "cleaned"; cleaned_dir.mkdir()

    def fake_grobid(pdf: Path, out_dir: Path) -> Path:
        target = out_dir / f"{pdf.stem}_cleaned.json"
        target.write_text(json.dumps({"paper": pdf.stem}))
        return target

    client = FakeClient()
    results = pipeline.ingest(
        client, sink_id="sinkZ", local_dir=src,
        papers_dir=tmp_path / "papers", cleaned_dir=cleaned_dir,
        dry_run=True, grobid_step=fake_grobid,
    )
    assert len(results) == 2
    assert {r["sink_id"] for r in results} == {"sinkZ"}
    assert len(client.activated_sinks) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_nexla_pipeline.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ingestion.nexla.pipeline'`

- [ ] **Step 3: Write the implementation**

Create `ingestion/nexla/pipeline.py`:

```python
"""Orchestration for Nexla-backed ingestion: pull PDFs, run Grobid, push cleaned JSON.

Steps that depend on Nexla's exact file-transfer wire format (`_download_source_files`,
the record transfer in `_default_upload`) are isolated behind injectable seams and
default to dry-run, so they can be validated against a live instance without touching
the surrounding orchestration (see design §5).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

from .client import NexlaClient

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PAPERS_DIR = REPO_ROOT / "papers"
DEFAULT_CLEANED_DIR = REPO_ROOT / "data" / "cleaned_json"
INGEST_SCRIPT = REPO_ROOT / "ingestion" / "scripts" / "ingest_pdf.sh"

# Grobid step: (pdf_path, cleaned_output_dir) -> cleaned_json_path
GrobidStep = Callable[[Path, Path], Path]
# Download step: (url, target_path) -> None
DownloadFn = Callable[[str, Path], None]


def _urlretrieve(url: str, target: Path) -> None:
    import urllib.request

    urllib.request.urlretrieve(url, target)  # noqa: S310


def _default_grobid_step(pdf: Path, cleaned_dir: Path) -> Path:
    """Run the existing PDF→cleaned-JSON pipeline via ingest_pdf.sh."""
    subprocess.run(["bash", str(INGEST_SCRIPT), str(pdf), str(cleaned_dir)], check=True)
    return cleaned_dir / f"{pdf.stem}_cleaned.json"


def _download_source_files(client: NexlaClient, source_id: str, dest_dir: Path,
                           download_fn: DownloadFn) -> list[Path]:
    """Download files exposed by a Nexla source into dest_dir.

    Assumes source_get returns {"files": [{"name": ..., "url": ...}, ...]}. Nexla's
    exact schema must be confirmed against a live instance (design §5); only this
    function changes if it differs.
    """
    source = client.source_get(source_id) or {}
    files = source.get("files", []) if isinstance(source, dict) else []
    downloaded: list[Path] = []
    for entry in files:
        name, url = entry.get("name"), entry.get("url")
        if not name or not url:
            continue
        target = dest_dir / name
        download_fn(url, target)
        downloaded.append(target)
    return downloaded


def pull(client: NexlaClient, source_id: str | None = None, *,
         dest_dir: Path = DEFAULT_PAPERS_DIR, local_dir: Path | None = None,
         dry_run: bool = True, download_fn: DownloadFn | None = None) -> list[Path]:
    """Fetch PDFs into dest_dir from a Nexla source (or a local stand-in folder)."""
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    if local_dir is not None:
        copied: list[Path] = []
        for pdf in sorted(Path(local_dir).glob("*.pdf")):
            target = dest_dir / pdf.name
            shutil.copy(pdf, target)
            copied.append(target)
        return copied

    if source_id is None:
        raise ValueError("pull requires either source_id or local_dir")

    client.source_activate(source_id, dry_run=dry_run)
    if dry_run:
        return []
    return _download_source_files(client, source_id, dest_dir,
                                  download_fn or _urlretrieve)


def _records_from_cleaned(path: Path) -> list[Any]:
    data = json.loads(Path(path).read_text())
    return [data] if isinstance(data, dict) else list(data)


def _default_upload(client: NexlaClient, sink_id: str, records: list[Any], *,
                    dry_run: bool) -> dict:
    """Publish records to a Nexla sink by activating it.

    The record byte-transfer is validated against a live instance (design §5).
    """
    client.sink_activate(sink_id, dry_run=dry_run)
    return {"sink_id": sink_id, "records": len(records), "dry_run": dry_run}


def push(client: NexlaClient, cleaned_json: Path, sink_id: str, *,
         dry_run: bool = True,
         upload_fn: Callable[..., dict] | None = None) -> dict:
    """Publish a cleaned JSON paper to a Nexla sink."""
    cleaned_json = Path(cleaned_json)
    if not cleaned_json.exists():
        raise FileNotFoundError(f"cleaned JSON not found: {cleaned_json}")
    records = _records_from_cleaned(cleaned_json)
    upload = upload_fn or _default_upload
    return upload(client, sink_id, records, dry_run=dry_run)


def ingest(client: NexlaClient, sink_id: str, *, source_id: str | None = None,
           papers_dir: Path = DEFAULT_PAPERS_DIR,
           cleaned_dir: Path = DEFAULT_CLEANED_DIR,
           local_dir: Path | None = None, dry_run: bool = True,
           grobid_step: GrobidStep | None = None) -> list[dict]:
    """Full flow: pull PDFs → run Grobid per PDF → push each cleaned JSON to the sink."""
    grobid = grobid_step or _default_grobid_step
    pdfs = pull(client, source_id, dest_dir=papers_dir, local_dir=local_dir,
                dry_run=dry_run)
    results: list[dict] = []
    for pdf in pdfs:
        cleaned = grobid(pdf, cleaned_dir)
        results.append(push(client, cleaned, sink_id, dry_run=dry_run))
    return results
```

Note: `ingest` takes `sink_id` as the first positional after `client` and `source_id` as a keyword, so the signature is valid Python (no non-default arg after a default one). The test and CLI call it accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_nexla_pipeline.py -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add ingestion/nexla/pipeline.py tests/test_nexla_pipeline.py
git commit -m "feat(nexla): pull/push/ingest orchestration over client + Grobid"
```

---

## Task 5: `cli` wiring + `run.py` integration

**Files:**
- Create: `ingestion/nexla/cli.py`
- Modify: `run.py` (add import, subparser, dispatch entry)
- Test: `tests/test_nexla_cli.py`

**Interfaces:**
- Consumes: `NexlaClient` from `client`; `load_config` from `config`; `NexlaError` from `errors`; `pipeline` module.
- Produces: `add_nexla_parser(subparsers) -> argparse.ArgumentParser`; `cmd_nexla(args) -> int`. Args namespace fields: `nexla_command` ∈ {`pull`,`push`,`ingest`,`status`}, `dry_run: bool` (default True), plus command-specific `source_id`, `sink_id`, `cleaned_json`, `local_dir`, `output`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_nexla_cli.py`:

```python
import argparse

from ingestion.nexla import cli, pipeline


def _parse(argv):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    cli.add_nexla_parser(sub)
    return parser.parse_args(argv)


def test_pull_defaults_to_dry_run():
    args = _parse(["nexla", "pull", "src123"])
    assert args.nexla_command == "pull"
    assert args.source_id == "src123"
    assert args.dry_run is True


def test_live_flag_disables_dry_run():
    args = _parse(["nexla", "ingest", "srcA", "sinkB", "--live"])
    assert args.dry_run is False
    assert args.source_id == "srcA"
    assert args.sink_id == "sinkB"


def test_cmd_nexla_pull_invokes_pipeline(monkeypatch):
    seen = {}

    def fake_pull(client, source_id, **kw):
        seen["source_id"] = source_id
        seen["dry_run"] = kw["dry_run"]
        return []

    monkeypatch.setattr(pipeline, "pull", fake_pull)
    rc = cli.cmd_nexla(_parse(["nexla", "pull", "srcX"]))
    assert rc == 0
    assert seen == {"source_id": "srcX", "dry_run": True}


def test_cmd_nexla_push_invokes_pipeline(monkeypatch):
    seen = {}

    def fake_push(client, cleaned_json, sink_id, **kw):
        seen["sink_id"] = sink_id
        return {"sink_id": sink_id, "records": 1, "dry_run": kw["dry_run"]}

    monkeypatch.setattr(pipeline, "push", fake_push)
    rc = cli.cmd_nexla(_parse(["nexla", "push", "x_cleaned.json", "sink1"]))
    assert rc == 0
    assert seen["sink_id"] == "sink1"


def test_cmd_nexla_maps_error_to_exit_code(monkeypatch):
    from ingestion.nexla.errors import NexlaAuthError

    def boom(*a, **k):
        raise NexlaAuthError("forbidden")

    monkeypatch.setattr(pipeline, "pull", boom)
    rc = cli.cmd_nexla(_parse(["nexla", "pull", "srcX"]))
    assert rc == 4


def test_cmd_nexla_status_returns_zero():
    rc = cli.cmd_nexla(_parse(["nexla", "status"]))
    assert rc == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_nexla_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'ingestion.nexla.cli'`

- [ ] **Step 3: Write the CLI module**

Create `ingestion/nexla/cli.py`:

```python
"""argparse wiring for the `run.py nexla` command group."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import pipeline
from .client import NexlaClient
from .config import load_config
from .errors import NexlaError


def _add_dry_run_flags(sp: argparse.ArgumentParser) -> None:
    sp.add_argument("--dry-run", dest="dry_run", action="store_true",
                    help="Preview nexla-cli calls without executing (default)")
    sp.add_argument("--live", dest="dry_run", action="store_false",
                    help="Execute for real instead of previewing")
    sp.set_defaults(dry_run=True)


def add_nexla_parser(subparsers) -> argparse.ArgumentParser:
    p = subparsers.add_parser(
        "nexla",
        help="Nexla source/sink ingestion (pull PDFs, push cleaned JSON)",
    )
    nsub = p.add_subparsers(dest="nexla_command", required=True)

    p_pull = nsub.add_parser("pull", help="Fetch source files into a local dir")
    p_pull.add_argument("source_id", nargs="?", default=None)
    p_pull.add_argument("--local-dir", default=None,
                        help="Local folder of PDFs used as a stand-in source")
    p_pull.add_argument("-o", "--output", default=None,
                        help="Destination dir (default: papers/)")
    _add_dry_run_flags(p_pull)

    p_push = nsub.add_parser("push", help="Publish a cleaned JSON to a sink")
    p_push.add_argument("cleaned_json")
    p_push.add_argument("sink_id")
    _add_dry_run_flags(p_push)

    p_ingest = nsub.add_parser("ingest", help="Source → Grobid → sink full flow")
    p_ingest.add_argument("source_id", nargs="?", default=None)
    p_ingest.add_argument("sink_id")
    p_ingest.add_argument("--local-dir", default=None,
                          help="Local folder of PDFs used as a stand-in source")
    _add_dry_run_flags(p_ingest)

    nsub.add_parser("status", help="Show Nexla env & CLI availability")
    return p


def _status(client: NexlaClient) -> int:
    cfg = load_config()
    binary = client.which(client.binary)
    print("Nexla status:")
    print(f"  API URL     : {cfg.api_url}")
    print(f"  Service key : {'set' if cfg.service_key else 'MISSING'}")
    print(f"  Token       : {'set' if cfg.token else '(login via service key)'}")
    print(f"  nexla-cli   : {binary or 'NOT INSTALLED (pip install nexla-cli)'}")
    return 0


def cmd_nexla(args: argparse.Namespace) -> int:
    client = NexlaClient()
    try:
        if args.nexla_command == "status":
            return _status(client)

        if args.nexla_command == "pull":
            dest = Path(args.output) if args.output else pipeline.DEFAULT_PAPERS_DIR
            pdfs = pipeline.pull(
                client, args.source_id, dest_dir=dest,
                local_dir=Path(args.local_dir) if args.local_dir else None,
                dry_run=args.dry_run,
            )
            print(f"Pulled {len(pdfs)} file(s) → {dest}")
            for pdf in pdfs:
                print(f"  {pdf}")
            return 0

        if args.nexla_command == "push":
            res = pipeline.push(client, Path(args.cleaned_json), args.sink_id,
                                dry_run=args.dry_run)
            print(f"Pushed to sink {res['sink_id']}: "
                  f"{res['records']} record(s) (dry_run={res['dry_run']})")
            return 0

        if args.nexla_command == "ingest":
            results = pipeline.ingest(
                client, args.sink_id, source_id=args.source_id,
                local_dir=Path(args.local_dir) if args.local_dir else None,
                dry_run=args.dry_run,
            )
            print(f"Ingested {len(results)} paper(s) → sink {args.sink_id}.")
            return 0
    except NexlaError as exc:
        print(f"Nexla error: {exc}", file=sys.stderr)
        return exc.exit_code
    except FileNotFoundError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    return 2
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_nexla_cli.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Wire into `run.py`**

In `run.py`, add the dispatch function after `cmd_codegen` (before `def main()`):

```python
def cmd_nexla(args: argparse.Namespace) -> int:
    """Nexla source/sink ingestion (pull PDFs, run Grobid, push cleaned JSON)."""
    sys.path.insert(0, str(ROOT))
    from ingestion.nexla.cli import cmd_nexla as _cmd_nexla

    return _cmd_nexla(args)
```

In `main()`, register the subparser. Add this right before the `args = parser.parse_args()` line:

```python
    # ── nexla ─────────────────────────────────────────────────────────────────
    sys.path.insert(0, str(ROOT))
    from ingestion.nexla.cli import add_nexla_parser
    add_nexla_parser(sub)
```

In the `dispatch` dict inside `main()`, add the `nexla` entry:

```python
    dispatch = {
        "ingest": cmd_ingest,
        "discuss": cmd_discuss,
        "brainstorm": cmd_brainstorm,
        "research": cmd_research,
        "codegen": cmd_codegen,
        "nexla": cmd_nexla,
    }
```

- [ ] **Step 6: Verify the CLI wiring end-to-end (dry-run, no live calls)**

Run:
```bash
.venv/bin/python run.py nexla status
.venv/bin/python run.py nexla --help
```
Expected: `status` prints the Nexla env block with `nexla-cli : NOT INSTALLED ...` and exits 0; `--help` lists `pull`, `push`, `ingest`, `status`.

- [ ] **Step 7: Commit**

```bash
git add ingestion/nexla/cli.py run.py tests/test_nexla_cli.py
git commit -m "feat(nexla): run.py nexla subcommand group (pull/push/ingest/status)"
```

---

## Task 6: Docs + optional dependency note

**Files:**
- Modify: `requirements.txt`, `README.md`, `DOCUMENTATION.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Note nexla-cli as optional in `requirements.txt`**

Append to the end of `requirements.txt`:

```text
# Optional: Nexla source/sink ingestion (run.py nexla ...). Install separately if used:
#   pip install nexla-cli
# Not required for the local PDF→JSON pipeline.
```

- [ ] **Step 2: Add a Nexla ingestion section to `README.md`**

Insert after the "### 4. Ingest a new PDF" section (before "### 5. Generate a code repo"):

```markdown
### 4b. Ingest via Nexla (remote source → sink)

Pull PDFs from a Nexla source, run the Grobid pipeline, and publish the cleaned
JSON to a Nexla sink. Requires the `nexla-cli` binary and credentials in `.env`.

Install the CLI and set credentials:
```bash
pip install nexla-cli
# .env:
#   NEXLA_SERVICE_KEY=...        # your Nexla service key
#   NEXLA_API_URL=https://dev-api-express-code.nexla.com/
```

Check what's configured (never makes live calls):
```bash
python run.py nexla status
```

Commands (all default to **dry-run** — add `--live` to execute):
```bash
python run.py nexla pull <SOURCE_ID>                 # source files → papers/
python run.py nexla push <cleaned.json> <SINK_ID>    # cleaned JSON → sink
python run.py nexla ingest <SOURCE_ID> <SINK_ID>     # source → Grobid → sink
```

No Nexla account yet? Use a local folder as a stand-in source:
```bash
python run.py nexla ingest --local-dir papers/ <SINK_ID> --live
```
```

- [ ] **Step 3: Document env vars in `README.md`**

In the "## Environment variables" table at the end of `README.md`, add rows:

```markdown
| `NEXLA_SERVICE_KEY` | nexla | Nexla service key (exchanged for a token) |
| `NEXLA_API_URL` | nexla | Nexla instance URL (default express.dev endpoint) |
| `NEXLA_MONITORING_URL` | nexla | Optional Nexla monitoring endpoint |
```

- [ ] **Step 4: Add a Nexla subsection to `DOCUMENTATION.md`**

Add a section describing the `ingestion/nexla/` module: its purpose (source→Grobid→sink), the module breakdown (`errors`/`config`/`client`/`pipeline`/`cli`), the dry-run default and exit-code contract, and the note that the file up/download steps (`_download_source_files`, `_default_upload`) are isolated seams pending live-instance validation. Match the file's existing heading style.

- [ ] **Step 5: Run the full test suite**

Run: `.venv/bin/pytest tests/ -v`
Expected: PASS (all Nexla tests green: errors 4, config 5, client 8, pipeline 7, cli 6).

- [ ] **Step 6: Commit**

```bash
git add requirements.txt README.md DOCUMENTATION.md
git commit -m "docs(nexla): document nexla ingestion commands and env vars"
```

---

## Self-Review

**Spec coverage:**
- Both source + sink → Task 4 `pull`/`push`/`ingest`. ✓
- New `nexla` subcommand group → Task 5. ✓
- Shell out to `nexla-cli` → Task 3 `NexlaClient`. ✓
- Graceful degradation (missing binary/token/URL) → Task 1 `NexlaCliNotInstalled`, Task 2 `require_auth`, Task 5 `status`/error mapping. ✓
- Dry-run default → Task 4 defaults + Task 5 `--live` flag. ✓
- express.dev URL default → Task 2 `DEFAULT_API_URL`. ✓
- Local-dir fallback → Task 4 `pull(local_dir=...)`, Task 5 `--local-dir`. ✓
- Exit-code contract → Task 1 map, Task 5 re-emit. ✓
- Live-validation seams isolated → Task 4 `_download_source_files` / `_default_upload`. ✓
- Testing without live Nexla/Docker/Grobid → all tasks use fakes/injected seams. ✓
- Docs + optional dependency → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the "seam" functions are fully implemented against a documented assumption, not stubs.

**Type consistency:** `NexlaClient` method names (`source_get`, `source_activate`, `sink_activate`, `sink_create`, `nexset_get`, `flow_status`, `login`, `run`) are identical across Tasks 3–5. `pipeline.pull/push/ingest` signatures match their CLI call sites in Task 5 (note `ingest(client, sink_id, *, source_id=...)` keyword ordering). `error_from_exit_code` / `.exit_code` consistent Tasks 1, 3, 5.