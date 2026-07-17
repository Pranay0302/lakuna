import json
from pathlib import Path

from ingestion.nexla import cli
from ingestion.nexla.config import NexlaConfig
from ingestion.nexla.errors import NexlaAuthError


class FakeClient:
    binary = "nexla-cli"

    def __init__(self):
        self.config = NexlaConfig("https://api/", "service", None, "https://mon/")
        self.which = lambda name: f"/bin/{name}"


def test_pull_delegates_to_pipeline_with_dry_run_by_default(monkeypatch, tmp_path, capsys):
    seen = {}

    def fake_pull(client, source_id, *, dest_dir, local_dir, dry_run):
        seen.update(
            client=client,
            source_id=source_id,
            dest_dir=Path(dest_dir),
            local_dir=local_dir,
            dry_run=dry_run,
        )
        return [Path(dest_dir) / "paper.pdf"]

    monkeypatch.setattr(cli.pipeline, "pull", fake_pull)
    out_dir = tmp_path / "papers"

    rc = cli.main(
        ["pull", "src1", "-o", str(out_dir), "--json"],
        client_factory=FakeClient,
    )

    assert rc == 0
    assert seen["source_id"] == "src1"
    assert seen["dest_dir"] == out_dir
    assert seen["local_dir"] is None
    assert seen["dry_run"] is True
    assert json.loads(capsys.readouterr().out) == [str(out_dir / "paper.pdf")]


def test_ingest_with_local_dir_delegates_to_pipeline_in_dry_run(monkeypatch, tmp_path):
    seen = {}

    def fake_ingest(client, sink_id, *, source_id, papers_dir, cleaned_dir, local_dir, dry_run):
        seen.update(
            sink_id=sink_id,
            source_id=source_id,
            papers_dir=Path(papers_dir),
            cleaned_dir=Path(cleaned_dir),
            local_dir=Path(local_dir),
            dry_run=dry_run,
        )
        return []

    monkeypatch.setattr(cli.pipeline, "ingest", fake_ingest)

    rc = cli.main(
            [
                "ingest",
                "123",
            "--local-dir",
            str(tmp_path / "src"),
            "--papers-dir",
            str(tmp_path / "papers"),
            "--cleaned-dir",
            str(tmp_path / "cleaned"),
        ],
        client_factory=FakeClient,
    )

    assert rc == 0
    assert seen["sink_id"] == "123"
    assert seen["source_id"] is None
    assert seen["dry_run"] is True


def test_ingest_live_with_local_dir_is_rejected(tmp_path, capsys):
    rc = cli.main(
        [
            "ingest",
            "sink1",
            "--local-dir",
            str(tmp_path / "src"),
            "--live",
        ],
        client_factory=FakeClient,
    )

    assert rc == 2
    assert "does not upload PDFs into the Nexla dashboard" in capsys.readouterr().err


def test_push_maps_nexla_error_to_exit_code(monkeypatch, tmp_path, capsys):
    def fake_push(client, cleaned_json, sink_id, *, dry_run):
        raise NexlaAuthError("forbidden")

    monkeypatch.setattr(cli.pipeline, "push", fake_push)

    rc = cli.main(["push", str(tmp_path / "paper_cleaned.json"), "123"],
                  client_factory=FakeClient)

    assert rc == 4
    assert "forbidden" in capsys.readouterr().err


def test_status_reports_diagnostics_without_auth(monkeypatch, capsys):
    class NoAuthClient(FakeClient):
        def __init__(self):
            super().__init__()
            self.config = NexlaConfig("https://api/", None, None, None)
            self.which = lambda name: None

    rc = cli.main(["status", "--json"], client_factory=NoAuthClient)

    assert rc == 0
    result = json.loads(capsys.readouterr().out)
    assert result["binary_found"] is False
    assert result["auth_configured"] is False
    assert "No Nexla credentials" in result["auth_error"]


def test_arxiv_atlas_exports_and_pushes_batches(monkeypatch, tmp_path, capsys):
    batch = tmp_path / "batch.jsonl"
    batch.write_text('{"id": "1"}\n')

    class FakeExport:
        records = [{"id": "1"}]
        batch_files = [batch]

    seen_export = {}
    seen_push = {}

    def fake_export(**kwargs):
        seen_export.update(kwargs)
        return FakeExport()

    def fake_push(client, cleaned_json, sink_id, *, dry_run):
        seen_push.update(
            cleaned_json=Path(cleaned_json),
            sink_id=sink_id,
            dry_run=dry_run,
        )
        return {"sink_id": sink_id, "records": 1, "dry_run": dry_run}

    monkeypatch.setattr(cli.arxiv_atlas, "export_current_atlas", fake_export)
    monkeypatch.setattr(cli.pipeline, "push", fake_push)

    rc = cli.main(
        [
            "arxiv-atlas",
            "--sink-id",
            "123",
            "--max-results",
            "1",
            "--batch-size",
            "1",
            "--output-dir",
            str(tmp_path),
            "--json",
        ],
        client_factory=FakeClient,
    )

    assert rc == 0
    assert seen_export["max_results"] == 1
    assert seen_export["batch_size"] == 1
    assert seen_push == {"cleaned_json": batch, "sink_id": "123", "dry_run": True}
    result = json.loads(capsys.readouterr().out)
    assert result["records"] == 1
    assert result["pushed"] == [{"sink_id": "123", "records": 1, "dry_run": True}]


def test_arxiv_atlas_rejects_placeholder_sink_id(monkeypatch, tmp_path, capsys):
    class FakeExport:
        records = [{"id": "1"}]
        batch_files = [tmp_path / "batch.jsonl"]

    monkeypatch.setattr(cli.arxiv_atlas, "export_current_atlas", lambda **kwargs: FakeExport())

    rc = cli.main(
        ["arxiv-atlas", "--sink-id", "DESTINATION_ID"],
        client_factory=FakeClient,
    )

    assert rc == 2
    assert "real Nexla numeric ID" in capsys.readouterr().err


def test_push_rejects_non_numeric_sink_id(tmp_path, capsys):
    rc = cli.main(
        ["push", str(tmp_path / "paper_cleaned.json"), "./incoming_pdfs"],
        client_factory=FakeClient,
    )

    assert rc == 2
    assert "must be a numeric Nexla ID" in capsys.readouterr().err
