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
