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
