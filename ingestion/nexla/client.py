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
    _token: str | None = field(default=None, repr=False, init=False)

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
