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


def test_records_from_cleaned_reads_jsonl_batches(tmp_path):
    p = tmp_path / "arxiv_atlas_batch.jsonl"
    p.write_text('{"id": "1"}\n\n{"id": "2"}\n')
    assert pipeline._records_from_cleaned(p) == [{"id": "1"}, {"id": "2"}]


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
