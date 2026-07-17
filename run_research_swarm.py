#!/usr/bin/env python3
"""
run_research_swarm.py — Research phase for a Knowledge-Void investigation.

Invoked by the visualizer server (visualizer/src/index.ts, start-research) when
the user clicks "Research" on a void:

    python3 run_research_swarm.py --void-id <int> --void-name "<name>" --gx10-url <url>

It runs the agent-swarm *brainstorm* over the papers that bound the void
(staged by run_investigation.py into outputs/investigations/void_<id>/papers.json):
each paper becomes an expert, experts propose research directions grounded in
their paper, then cross-pollinate across papers, and the orchestrator synthesizes
a research agenda.

Contract with the frontend (visualizer DeepResearchTab):
  * prints ``Session directory: <dir>`` once — the server captures this and then
    polls ``<dir>/events.jsonl``;
  * writes ``events.jsonl`` with ``agents_selected`` / ``seed_ideas_done`` /
    ``cross_ideas_done`` / ``plan_done`` records (emitted cumulatively so the UI
    fills in live);
  * streams human-readable progress to stdout for the "Full Logs" tab.

The LLM backend is chosen by the environment (LLM_BACKEND); with LLM_BACKEND=anthropic
this runs on Claude. ``--gx10-url`` is accepted for CLI compatibility but unused.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from itertools import count
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from agentswarm.brainstorm import BrainstormBlackboard, BrainstormOrchestrator
from agentswarm.expert import PaperExpertAgent
from agentswarm.llm import build_llm
from agentswarm.log import SwarmLogger
from agentswarm.paper_loader import Paper, PaperChunk
from agentswarm.research import ResearchEventLog
from agentswarm.retriever import KeywordRetriever


def _log(msg: str) -> None:
    print(msg, flush=True)


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug[:48] or "paper"


def _load_void_papers(void_id: str, explicit: str | None) -> list[dict]:
    """Read the void's boundary papers staged by run_investigation.py."""
    if explicit:
        return json.loads(explicit)
    staged = ROOT / "outputs" / "investigations" / f"void_{void_id}" / "papers.json"
    if not staged.exists():
        _log(f"ERROR: no staged papers at {staged} — run Investigate (ingest) first.")
        raise SystemExit(2)
    return json.loads(staged.read_text())


def _build_papers(items: list[dict]) -> list[Paper]:
    """Turn void papers ({title, doi, abstract, ...}) into single-chunk Papers."""
    papers: list[Paper] = []
    seen: set[str] = set()
    for item in items:
        title = str(item.get("title") or "Untitled").strip()
        doi = str(item.get("doi") or item.get("DOI") or "").strip()
        pid = _slug(doi or title)
        base, n = pid, 2
        while pid in seen:
            pid, n = f"{base}_{n}", n + 1
        seen.add(pid)

        abstract = str(item.get("abstract") or "").strip()
        text = abstract or title
        chunk = PaperChunk(
            chunk_id=f"{pid}:abstract:0",
            paper_id=pid,
            paper_title=title,
            section="Abstract",
            sec_num=None,
            text=text,
            source="abstract",
        )
        papers.append(
            Paper(paper_id=pid, title=title, abstract=abstract,
                  path=Path(f"void://{pid}"), chunks=[chunk])
        )
    return papers


def _seed_payload(idea) -> dict:
    """Map a ResearchIdea onto the fields the DeepResearchTab seed cards render."""
    return {
        "idea_id": idea.idea_id,
        "agent_id": idea.agent_id,
        "paper_id": idea.paper_id,
        "paper_title": idea.paper_title,
        "text": idea.text,
        "rationale": idea.grounding,
        "expected_effect": idea.gap,
        "changes": "",
    }


def _cross_payload(cp, seed_agent_by_id: dict[str, str]) -> dict:
    """Map a CrossPollinatedIdea onto the fields the cross-idea cards render."""
    return {
        "idea_id": cp.cp_id,
        "agent_id": cp.from_agent_id,
        "paper_id": cp.from_paper_id,
        "seed_idea_id": cp.seed_idea_id,
        "seed_agent_id": seed_agent_by_id.get(cp.seed_idea_id, ""),
        "seed_paper_title": cp.seed_paper_title,
        "text": cp.text,
        "connection": cp.connection,
        "changes": "",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Agent-swarm research over a knowledge void")
    parser.add_argument("--void-id", required=True)
    parser.add_argument("--void-name", required=True)
    parser.add_argument("--gx10-url", default=None, help="Accepted for compatibility; unused.")
    parser.add_argument("--papers", default=None, help="Optional JSON array override.")
    parser.add_argument("--max-agents", type=int, default=3,
                        help="Max paper-experts to involve (kept small for demo latency).")
    parser.add_argument("--max-cross-ideas", type=int, default=4,
                        help="Cap on cross-pollinated ideas (each is one LLM call).")
    parser.add_argument("--top-k", type=int, default=4)
    args = parser.parse_args()

    area = args.void_name
    _log(f"=== RESEARCH: void {args.void_id} — {area} ===")

    items = _load_void_papers(args.void_id, args.papers)
    papers = _build_papers(items)
    _log(f"Loaded {len(papers)} papers as experts.")

    session_dir = (
        ROOT / "outputs" / "investigations" / f"void_{args.void_id}"
        / f"session_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
    )
    session_dir.mkdir(parents=True, exist_ok=True)
    # The server parses this exact line to locate events.jsonl.
    _log(f"Session directory: {session_dir}")

    event_log = ResearchEventLog(session_dir)
    logger = SwarmLogger(stream=sys.stdout)
    llm = build_llm(max_tokens=1400)

    retriever = KeywordRetriever(papers)
    agents = [
        PaperExpertAgent(paper, retriever, top_k=args.top_k, llm=llm, logger=logger)
        for paper in papers
    ]

    # ── Select the most relevant experts ──────────────────────────────────────
    logger.phase("Selecting relevant experts")
    selected = sorted(agents, key=lambda a: a.relevance(area), reverse=True)[: args.max_agents]
    selected_ids = [a.agent_id for a in selected]
    logger.selected(selected_ids)
    event_log.event("agents_selected", {"agents": selected_ids})

    idea_counter: count = count(1)
    cp_counter: count = count(1)
    bb = BrainstormBlackboard(area=area)

    # ── Seed round: each expert proposes directions from its own paper ────────
    logger.phase(f"Seed round — {len(selected)} expert(s) propose research directions")
    for agent in selected:
        for idea in agent.propose_research(area, idea_counter):
            bb.add_seed(idea)
        # Emit cumulatively so the UI grows the seed list live.
        event_log.event("seed_ideas_done", {"ideas": [_seed_payload(s) for s in bb.seeds]})
    logger.phase_done(f"{len(bb.seeds)} seed idea(s)")

    seed_agent_by_id = {s.idea_id: s.agent_id for s in bb.seeds}

    # ── Cross-pollination: combine insights across papers (capped) ────────────
    if len(selected) > 1 and bb.seeds:
        logger.phase(f"Cross-pollination — combining insights (up to {args.max_cross_ideas})")
        done = False
        for agent in selected:
            if done:
                break
            for seed in [s for s in bb.seeds if s.agent_id != agent.agent_id]:
                cp = agent.cross_pollinate(area, seed, cp_counter)
                bb.add_cross_pollination(cp)
                event_log.event(
                    "cross_ideas_done",
                    {"ideas": [_cross_payload(c, seed_agent_by_id) for c in bb.cross_pollinations]},
                )
                if len(bb.cross_pollinations) >= args.max_cross_ideas:
                    done = True
                    break
        logger.phase_done(f"{len(bb.cross_pollinations)} hybrid idea(s)")
    else:
        logger.info("Single expert — skipping cross-pollination.")

    # ── Synthesis: research agenda over the void ──────────────────────────────
    logger.phase("Synthesizing research agenda")
    orchestrator = BrainstormOrchestrator(
        selected, llm=llm, max_agents=len(selected), cross_pollinate_rounds=1, logger=logger
    )
    bb.agenda = orchestrator._synthesize(bb)
    event_log.event("plan_done", {"plan": bb.agenda})
    logger.phase_done("Research agenda ready")

    event_log.event("session_done", {"session_dir": str(session_dir)})

    _log("\n" + "=" * 60)
    _log(f"RESEARCH AGENDA — {area}\n")
    _log(bb.agenda or "(no agenda produced)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
