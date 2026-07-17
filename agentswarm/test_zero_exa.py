import json
import subprocess

import pytest

from agentswarm.zero_exa import ZeroExaSearch, ZeroServiceError


def test_zero_exa_runs_discover_inspect_fetch_review_with_spend_cap():
    commands = []

    def runner(command, timeout):
        commands.append(list(command))
        if command[1] == "search":
            body = {"results": [{"name": "Exa Search API", "token": "z_test.1"}]}
        elif command[1] == "get":
            body = {
                "url": "https://search.example.test/exa",
                "method": "POST",
                "bodySchema": {
                    "properties": {
                        "body": {
                            "properties": {
                                "query": {"type": "string"},
                                "numResults": {"type": "integer"},
                                "contents": {"type": "object"},
                            }
                        }
                    }
                },
            }
        elif command[1] == "fetch":
            body = {
                "runId": "run-123",
                "ok": True,
                "body": {
                    "results": [
                        {
                            "title": "A useful paper",
                            "url": "https://example.test/paper",
                            "highlights": ["A grounded technical result."],
                            "score": 0.91,
                        }
                    ]
                },
            }
        else:
            body = {"ok": True}
        return subprocess.CompletedProcess(command, 0, json.dumps(body), "")

    service = ZeroExaSearch(
        executable="/test/zero",
        runner=runner,
        max_results=3,
        max_pay_usd=0.015,
    )
    hits = service.search("robust multimodal registration")

    assert hits[0].title == "A useful paper"
    assert hits[0].text == "A grounded technical result."
    assert [command[1] for command in commands] == ["search", "get", "fetch", "review"]
    fetch = commands[2]
    assert fetch[fetch.index("--capability") + 1] == "z_test.1"
    assert fetch[fetch.index("--max-pay") + 1] == "0.0150"
    payload = json.loads(fetch[fetch.index("-d") + 1])
    assert payload["query"] == "robust multimodal registration"
    assert payload["numResults"] == 3


def test_zero_exa_requires_the_runner_before_spending():
    service = ZeroExaSearch(executable=None, runner=lambda *_: None)
    service.executable = None

    with pytest.raises(ZeroServiceError, match="Zero CLI is unavailable"):
        service.search("test")


def test_zero_exa_rejects_capability_without_schema():
    def runner(command, timeout):
        if command[1] == "search":
            body = {"results": [{"name": "Exa Search", "token": "z_test.1"}]}
        else:
            body = {"url": "https://example.test/search", "bodySchema": None}
        return subprocess.CompletedProcess(command, 0, json.dumps(body), "")

    service = ZeroExaSearch(executable="/test/zero", runner=runner)
    with pytest.raises(ZeroServiceError, match="no request schema"):
        service.search("test")
