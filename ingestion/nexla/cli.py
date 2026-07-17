"""Argparse command group for Nexla-backed ingestion."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable, Sequence

from .client import NexlaClient
from .config import require_auth
from .errors import NexlaError, NexlaInputError
from . import pipeline
from .. import arxiv_atlas


def _print_payload(payload: Any, *, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(payload)


def _dry_run_from_args(args: argparse.Namespace) -> bool:
    return not getattr(args, "live", False)


def _reject_live_local_dir(args: argparse.Namespace) -> None:
    if getattr(args, "local_dir", None) and getattr(args, "live", False):
        raise NexlaInputError(
            "--local-dir is a local-only fallback and does not upload PDFs into the "
            "Nexla dashboard. Upload PDFs to the Nexla File Upload source in the UI, "
            "then run with the Nexla source id and destination id, for example: "
            "python3 run.py nexla ingest <source_id> <destination_id> --live"
        )


def _require_real_id(value: str | None, label: str) -> None:
    if value in {None, "", "DESTINATION_ID", "REAL_SINK_ID", "SINK_ID", "<sink_id>", "<destination_id>"}:
        raise NexlaInputError(
            f"{label} must be a real Nexla numeric ID copied from the dashboard, "
            f"not the placeholder {value!r}."
        )
    if value is not None and not str(value).isdigit():
        raise NexlaInputError(
            f"{label} must be a numeric Nexla ID. Got {value!r}."
        )


def cmd_pull(args: argparse.Namespace, client: NexlaClient) -> int:
    _reject_live_local_dir(args)
    pdfs = pipeline.pull(
        client,
        args.source_id,
        dest_dir=Path(args.output),
        local_dir=Path(args.local_dir) if args.local_dir else None,
        dry_run=_dry_run_from_args(args),
    )
    _print_payload([str(path) for path in pdfs], as_json=args.json)
    return 0


def cmd_push(args: argparse.Namespace, client: NexlaClient) -> int:
    _require_real_id(args.sink_id, "sink_id")
    result = pipeline.push(
        client,
        Path(args.cleaned_json),
        args.sink_id,
        dry_run=_dry_run_from_args(args),
    )
    _print_payload(result, as_json=args.json)
    return 0


def cmd_ingest(args: argparse.Namespace, client: NexlaClient) -> int:
    _reject_live_local_dir(args)
    if args.local_dir:
        source_id = None
        sink_id = args.source_or_sink
    else:
        source_id = args.source_or_sink
        sink_id = args.sink_id
    if not sink_id:
        raise SystemExit("ingest requires <source_id> <sink_id>, or <sink_id> with --local-dir")
    if source_id is not None:
        _require_real_id(source_id, "source_id")
    _require_real_id(sink_id, "sink_id")

    results = pipeline.ingest(
        client,
        sink_id,
        source_id=source_id,
        papers_dir=Path(args.papers_dir),
        cleaned_dir=Path(args.cleaned_dir),
        local_dir=Path(args.local_dir) if args.local_dir else None,
        dry_run=_dry_run_from_args(args),
    )
    _print_payload(results, as_json=args.json)
    return 0


def cmd_status(args: argparse.Namespace, client: NexlaClient) -> int:
    cfg = client.config
    binary_path = client.which(client.binary)
    auth_ok = False
    auth_error = None
    try:
        require_auth(cfg)
        auth_ok = True
    except NexlaError as exc:
        auth_error = str(exc)

    result = {
        "api_url": cfg.api_url,
        "monitoring_url": cfg.monitoring_url,
        "binary": client.binary,
        "binary_path": binary_path,
        "binary_found": binary_path is not None,
        "has_service_key": bool(cfg.service_key),
        "has_token": bool(cfg.token),
        "auth_configured": auth_ok,
        "auth_error": auth_error,
    }
    _print_payload(result, as_json=args.json)
    return 0


def cmd_arxiv_atlas(args: argparse.Namespace, client: NexlaClient) -> int:
    export = arxiv_atlas.export_current_atlas(
        output_dir=Path(args.output_dir),
        query=args.query,
        categories=args.category,
        max_results=args.max_results,
        page_size=args.page_size,
        batch_size=args.batch_size,
    )

    pushed = []
    if args.sink_id:
        _require_real_id(args.sink_id, "sink_id")
        for batch_file in export.batch_files:
            pushed.append(
                pipeline.push(
                    client,
                    batch_file,
                    args.sink_id,
                    dry_run=_dry_run_from_args(args),
                )
            )

    result = {
        "records": len(export.records),
        "batch_files": [str(path) for path in export.batch_files],
        "sink_id": args.sink_id,
        "dry_run": _dry_run_from_args(args),
        "pushed": pushed,
    }
    _print_payload(result, as_json=args.json)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run.py nexla",
        description="Pull PDFs from Nexla sources and publish cleaned JSON to sinks.",
    )
    sub = parser.add_subparsers(dest="nexla_command", required=True)

    def add_common_mutation_flags(p: argparse.ArgumentParser) -> None:
        p.add_argument("--live", "--no-dry-run", action="store_true", dest="live",
                       help="Execute live Nexla mutations; default is dry-run")
        p.add_argument("--json", action="store_true",
                       help="Print machine-readable JSON output")

    p_pull = sub.add_parser("pull", help="Fetch PDFs from a Nexla source or local stand-in")
    p_pull.add_argument("source_id", nargs="?", default=None, help="Nexla source id")
    p_pull.add_argument("-o", "--output", default=str(pipeline.DEFAULT_PAPERS_DIR),
                        help="Output directory for PDFs")
    p_pull.add_argument("--local-dir", default=None,
                        help="Copy PDFs from this local folder instead of Nexla")
    add_common_mutation_flags(p_pull)
    p_pull.set_defaults(func=cmd_pull)

    p_push = sub.add_parser("push", help="Publish one cleaned JSON file to a Nexla sink")
    p_push.add_argument("cleaned_json", help="Path to *_cleaned.json")
    p_push.add_argument("sink_id", help="Nexla sink id")
    add_common_mutation_flags(p_push)
    p_push.set_defaults(func=cmd_push)

    p_ingest = sub.add_parser("ingest", help="Pull PDFs, run Grobid, then push cleaned JSON")
    p_ingest.add_argument("source_or_sink",
                          help="Nexla source id, or sink id when --local-dir is used")
    p_ingest.add_argument("sink_id", nargs="?", default=None, help="Nexla sink id")
    p_ingest.add_argument("--papers-dir", default=str(pipeline.DEFAULT_PAPERS_DIR))
    p_ingest.add_argument("--cleaned-dir", default=str(pipeline.DEFAULT_CLEANED_DIR))
    p_ingest.add_argument("--local-dir", default=None,
                          help="Copy PDFs from this local folder instead of Nexla")
    add_common_mutation_flags(p_ingest)
    p_ingest.set_defaults(func=cmd_ingest)

    p_status = sub.add_parser("status", help="Show Nexla configuration diagnostics")
    p_status.add_argument("--json", action="store_true",
                          help="Print machine-readable JSON output")
    p_status.set_defaults(func=cmd_status)

    p_arxiv = sub.add_parser(
        "arxiv-atlas",
        help="Export current arXiv atlas metadata and optionally push batches to Nexla",
    )
    p_arxiv.add_argument("--sink-id", default=None,
                         help="Optional Nexla destination/sink id to receive JSONL batches")
    p_arxiv.add_argument("--query", default=None,
                         help="Raw arXiv API search query; overrides --category")
    p_arxiv.add_argument("--category", action="append", default=["cs.CV"],
                         help="arXiv category to include; repeatable (default: cs.CV)")
    p_arxiv.add_argument("--max-results", type=int, default=100,
                         help="Maximum current arXiv records to fetch")
    p_arxiv.add_argument("--page-size", type=int, default=100,
                         help="arXiv API page size")
    p_arxiv.add_argument("--batch-size", type=int, default=100,
                         help="Records per JSONL batch file")
    p_arxiv.add_argument("--output-dir", default="data/nexla/arxiv_atlas",
                         help="Directory for JSONL batch files")
    add_common_mutation_flags(p_arxiv)
    p_arxiv.set_defaults(func=cmd_arxiv_atlas)

    return parser


def main(argv: Sequence[str] | None = None, *,
         client_factory: Callable[[], NexlaClient] = NexlaClient) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    client = client_factory()
    try:
        return args.func(args, client)
    except NexlaError as exc:
        print(f"Nexla error: {exc}", file=sys.stderr)
        return exc.exit_code


__all__ = ["build_parser", "main"]
