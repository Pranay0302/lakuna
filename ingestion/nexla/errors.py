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
