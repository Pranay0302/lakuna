"""Export current arXiv paper metadata as Nexla-friendly atlas records."""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


ARXIV_API_URL = "https://export.arxiv.org/api/query"
ATOM = {"atom": "http://www.w3.org/2005/Atom"}
ARXIV = {"arxiv": "http://arxiv.org/schemas/atom"}


@dataclass(frozen=True)
class ArxivAtlasExport:
    records: list[dict]
    batch_files: list[Path]


def build_category_query(categories: Iterable[str]) -> str:
    parts = [f"cat:{category}" for category in categories if category]
    if not parts:
        return "cat:cs.CV"
    return " OR ".join(parts)


def fetch_current_papers(
    *,
    query: str | None = None,
    categories: Iterable[str] = ("cs.CV",),
    max_results: int = 100,
    page_size: int = 100,
    sleep_seconds: float = 3.0,
    opener=urllib.request.urlopen,
) -> list[dict]:
    """Fetch newest arXiv papers as normalized atlas records.

    The arXiv API is paginated and asks clients not to hammer it, so this function
    fetches in batches and sleeps between requests when more than one page is needed.
    """
    if max_results < 1:
        raise ValueError("max_results must be at least 1")
    if page_size < 1:
        raise ValueError("page_size must be at least 1")

    search_query = query or build_category_query(categories)
    records: list[dict] = []
    start = 0
    while len(records) < max_results:
        limit = min(page_size, max_results - len(records))
        payload = _fetch_page(
            search_query=search_query,
            start=start,
            max_results=limit,
            opener=opener,
        )
        page_records = parse_arxiv_feed(payload)
        if not page_records:
            break
        records.extend(page_records)
        start += len(page_records)
        if len(page_records) < limit or len(records) >= max_results:
            break
        time.sleep(sleep_seconds)
    return records[:max_results]


def _fetch_page(*, search_query: str, start: int, max_results: int, opener) -> bytes:
    params = {
        "search_query": search_query,
        "start": str(start),
        "max_results": str(max_results),
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    }
    url = f"{ARXIV_API_URL}?{urllib.parse.urlencode(params)}"
    with opener(url, timeout=30) as response:
        return response.read()


def parse_arxiv_feed(payload: bytes | str) -> list[dict]:
    root = ET.fromstring(payload)
    records = []
    for entry in root.findall("atom:entry", ATOM):
        records.append(_record_from_entry(entry))
    return records


def _text(entry: ET.Element, path: str, namespaces: dict[str, str] = ATOM) -> str:
    found = entry.find(path, namespaces)
    return " ".join((found.text or "").split()) if found is not None else ""


def _record_from_entry(entry: ET.Element) -> dict:
    abs_url = _text(entry, "atom:id")
    arxiv_id = abs_url.rstrip("/").rsplit("/", 1)[-1]
    pdf_url = ""
    for link in entry.findall("atom:link", ATOM):
        if link.attrib.get("title") == "pdf" or link.attrib.get("type") == "application/pdf":
            pdf_url = link.attrib.get("href", "")
            break

    categories = [cat.attrib.get("term", "") for cat in entry.findall("atom:category", ATOM)]
    primary = entry.find("arxiv:primary_category", ARXIV)
    authors = [_text(author, "atom:name") for author in entry.findall("atom:author", ATOM)]

    return {
        "id": arxiv_id,
        "arxiv_id": arxiv_id,
        "title": _text(entry, "atom:title"),
        "summary": _text(entry, "atom:summary"),
        "authors": [author for author in authors if author],
        "published": _text(entry, "atom:published"),
        "updated": _text(entry, "atom:updated"),
        "categories": [category for category in categories if category],
        "primary_category": primary.attrib.get("term", "") if primary is not None else "",
        "abs_url": abs_url,
        "pdf_url": pdf_url,
        "source": "arxiv",
        "atlas_dataset": "arxiv_atlas",
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


def write_jsonl_batches(records: list[dict], output_dir: Path, *,
                        batch_size: int = 100) -> list[Path]:
    if batch_size < 1:
        raise ValueError("batch_size must be at least 1")
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    batch_files = []
    for index in range(0, len(records), batch_size):
        batch = records[index:index + batch_size]
        batch_no = index // batch_size + 1
        path = output_dir / f"arxiv_atlas_batch_{batch_no:04d}.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for record in batch:
                f.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
        batch_files.append(path)
    return batch_files


def export_current_atlas(
    *,
    output_dir: Path,
    query: str | None = None,
    categories: Iterable[str] = ("cs.CV",),
    max_results: int = 100,
    page_size: int = 100,
    batch_size: int = 100,
    sleep_seconds: float = 3.0,
    opener=urllib.request.urlopen,
) -> ArxivAtlasExport:
    records = fetch_current_papers(
        query=query,
        categories=categories,
        max_results=max_results,
        page_size=page_size,
        sleep_seconds=sleep_seconds,
        opener=opener,
    )
    batch_files = write_jsonl_batches(records, output_dir, batch_size=batch_size)
    return ArxivAtlasExport(records=records, batch_files=batch_files)
