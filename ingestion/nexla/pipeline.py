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
    path = Path(path)
    if path.suffix == ".jsonl":
        records = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                records.append(json.loads(line))
        return records
    data = json.loads(path.read_text())
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
