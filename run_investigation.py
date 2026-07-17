#!/usr/bin/env python3
"""
run_investigation.py — ingest stage for a Knowledge-Void investigation.

Invoked by the visualizer server (visualizer/src/index.ts, spawnInvestigation)
when the user clicks "Investigate" on a void:

    python3 run_investigation.py \
        --void-id   <int> \
        --void-name "<name>" \
        --papers    '<json array of {doi,title,year,citation_count,abstract}>' \
        --gx10-url  <llm base url>

It prepares a per-void workspace under outputs/investigations/void_<id>/ (the
path the server later looks in for logs/metrics) from the papers that bound the
void, streaming human-readable progress to stdout. On success it exits 0, which
makes the UI advance to the "click Research to start the agent swarm" stage.

This step does no LLM work — it only stages the investigation. The agent swarm
runs later, in the Research phase (run_research_swarm.py / run_research_swarm.sh).
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _log(msg: str) -> None:
    """Print a progress line and flush so it streams live into the UI logs."""
    print(msg, flush=True)


def _parse_papers(raw: str) -> list[dict]:
    try:
        papers = json.loads(raw)
    except json.JSONDecodeError as e:
        _log(f"ERROR: could not parse --papers JSON: {e}")
        raise SystemExit(2)
    if not isinstance(papers, list):
        _log("ERROR: --papers must be a JSON array")
        raise SystemExit(2)
    return papers


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest a knowledge void for investigation")
    parser.add_argument("--void-id", required=True)
    parser.add_argument("--void-name", required=True)
    parser.add_argument("--papers", required=True, help="JSON array of the void's boundary papers")
    parser.add_argument("--gx10-url", default=None, help="LLM base URL (unused in the ingest stage)")
    args = parser.parse_args()

    papers = _parse_papers(args.papers)

    _log(f"=== INGEST: void {args.void_id} — {args.void_name} ===")
    _log(f"Boundary papers: {len(papers)}")

    session_dir = ROOT / "outputs" / "investigations" / f"void_{args.void_id}"
    (session_dir / "logs").mkdir(parents=True, exist_ok=True)

    staged: list[dict] = []
    for i, p in enumerate(papers, 1):
        title = str(p.get("title", "<untitled>")).strip()
        doi = str(p.get("doi") or p.get("DOI") or "").strip()
        year = p.get("year")
        abstract = str(p.get("abstract", "") or "").strip()
        _log(f"  [{i}/{len(papers)}] {title[:72]}"
             + (f"  ({year})" if year else "")
             + (f"  doi:{doi}" if doi else "")
             + (f"  — abstract {len(abstract)} chars" if abstract else "  — no abstract"))
        staged.append({
            "title": title,
            "doi": doi,
            "year": year,
            "citation_count": p.get("citation_count"),
            "abstract": abstract,
        })

    # Persist the staged corpus + a manifest the Research phase / UI can read back.
    (session_dir / "papers.json").write_text(json.dumps(staged, indent=2))
    manifest = {
        "void_id": args.void_id,
        "void_name": args.void_name,
        "num_papers": len(staged),
        "ingested_at": datetime.now(timezone.utc).isoformat(),
        "gx10_url": args.gx10_url,
    }
    (session_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))

    _log(f"Staged {len(staged)} papers → {session_dir}")
    _log("Ingest ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
