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
