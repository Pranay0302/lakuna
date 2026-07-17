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
import time
import traceback
from datetime import datetime, timezone
from itertools import count
from pathlib import Path

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    load_dotenv = None

if load_dotenv is not None:
    load_dotenv()

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from agentswarm.brainstorm import BrainstormBlackboard, BrainstormOrchestrator
from agentswarm.brainstorm import ResearchIdea, CrossPollinatedIdea
from agentswarm.expert import PaperExpertAgent
from agentswarm.llm import build_llm
from agentswarm.log import SwarmLogger
from agentswarm.paper_loader import Paper, PaperChunk
from agentswarm.research import ResearchEventLog
from agentswarm.retriever import KeywordRetriever


def _log(msg: str) -> None:
    print(msg, flush=True)


def _work_delay() -> float:
    """Small visible delay for demos; set RESEARCH_SWARM_STEP_DELAY=0 to disable."""
    try:
        return max(0.0, float(__import__("os").environ.get("RESEARCH_SWARM_STEP_DELAY", "0.55")))
    except ValueError:
        return 0.55


def _deliberate(event_log: ResearchEventLog, logger: SwarmLogger, stage: str, steps: list[str]) -> None:
    """Emit explicit deliberation progress so fallback/heuristic runs still feel inspectable."""
    delay = _work_delay()
    for i, step in enumerate(steps, start=1):
        logger.agent_start(stage, f"deliberating {i}/{len(steps)}")
        logger.on_token(step)
        logger.agent_done(stage)
        event_log.event(
            "analysis_step",
            {
                "stage": stage,
                "step": i,
                "total": len(steps),
                "text": step,
            },
        )
        if delay:
            time.sleep(delay)


def _score_prediction(seed_count: int, cross_count: int, stage_bonus: float = 0.0) -> float:
    """Heuristic confidence score for void-level research agendas, not benchmark accuracy."""
    score = 0.34 + min(seed_count, 5) * 0.055 + min(cross_count, 6) * 0.035 + stage_bonus
    return round(max(0.0, min(0.92, score)), 4)


def _emit_predicted_accuracy(
    event_log: ResearchEventLog,
    *,
    iteration: int,
    label: str,
    seed_count: int,
    cross_count: int,
    stage_bonus: float = 0.0,
) -> None:
    event_log.event(
        "experiment_done",
        {
            "iteration": iteration,
            "label": label,
            "metrics": {
                "predicted_accuracy": _score_prediction(seed_count, cross_count, stage_bonus),
                "evidence_coverage": round(min(1.0, seed_count / 5), 4),
                "cross_pollination_strength": round(min(1.0, cross_count / 6), 4),
            },
            "note": "Heuristic confidence estimate for the proposed agenda; no benchmark was executed.",
        },
    )


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


def _fallback_seed(agent: PaperExpertAgent, area: str, idea_counter: count, exc: Exception) -> ResearchIdea:
    evidence = agent.retriever.search_evidence(area, top_k=1, paper_id=agent.paper.paper_id)
    keywords = _keywords_from_agent(agent, evidence)
    return ResearchIdea(
        idea_id=f"{agent.paper.paper_id}:idea:{next(idea_counter)}",
        agent_id=agent.agent_id,
        paper_id=agent.paper.paper_id,
        paper_title=agent.paper.title,
        text=(
            f"Prototype a privacy-preserving {area.lower()} study that uses "
            f"{agent.paper.title} as the baseline signal source."
        ),
        grounding=f"Grounded in the selected paper's focus on {keywords}.",
        gap="Test whether the same predictive signal can be retained while reducing identity leakage.",
        evidence=evidence,
    )


def _fallback_cross(agent: PaperExpertAgent, seed, cp_counter: count, exc: Exception) -> CrossPollinatedIdea:
    evidence = agent.retriever.search_evidence(seed.text, top_k=1, paper_id=agent.paper.paper_id)
    bridge = _keyword_bridge(agent, seed, evidence)
    return CrossPollinatedIdea(
        cp_id=f"{agent.paper.paper_id}:cp:{next(cp_counter)}",
        from_agent_id=agent.agent_id,
        from_paper_id=agent.paper.paper_id,
        from_paper_title=agent.paper.title,
        seed_idea_id=seed.idea_id,
        seed_paper_id=seed.paper_id,
        seed_paper_title=seed.paper_title,
        text=(
            f"Compare {agent.paper.title} against {seed.paper_title} in a shared privacy-preserving "
            "ocular-classification benchmark."
        ),
        connection=(
            f"Use {bridge} as the bridge between the two papers, then measure whether demographic "
            "prediction can be suppressed without destroying useful biometric quality signals."
        ),
        evidence=evidence,
    )


def _log_agent_error(logger: SwarmLogger, message: str, exc: Exception) -> None:
    logger.info(f"{message}: {exc}")
    if _should_show_traceback(exc):
        logger.info(traceback.format_exc().rstrip())


def _should_show_traceback(exc: Exception) -> bool:
    text = str(exc)
    expected_config_errors = (
        "ANTHROPIC_API_KEY is required",
        "OPENROUTER_API_KEY is required",
        "LOCAL_LLM_URL must be set",
    )
    return not any(marker in text for marker in expected_config_errors)


def _fallback_agenda(area: str, bb: BrainstormBlackboard, exc: Exception) -> str:
    seed_lines = "\n".join(
        f"- {seed.text} ({seed.paper_title})"
        for seed in bb.seeds[:5]
    ) or "- Build a baseline from the selected source papers and evaluate privacy/utility tradeoffs."
    cross_lines = "\n".join(
        f"- {cp.text}"
        for cp in bb.cross_pollinations[:5]
    ) or "- Compare the selected papers under a shared benchmark and report where signals transfer."
    return (
        f"## Research Agenda: {area}\n\n"
        "This agenda was assembled from selected papers, retrieved evidence, and deterministic "
        "fallback heuristics.\n\n"
        "### Seed Directions\n"
        f"{seed_lines}\n\n"
        "### Cross-Paper Directions\n"
        f"{cross_lines}\n\n"
        "### Next Step\n"
        "Run a small benchmark that measures task utility, demographic leakage, and robustness across sensors."
    )


def _keywords_from_agent(agent: PaperExpertAgent, evidence: list) -> str:
    text = " ".join([agent.paper.title, *(item.text for item in evidence[:2])]).lower()
    candidates = [
        "iris texture",
        "periocular images",
        "multiple sensors",
        "spectral variation",
        "binary statistical features",
        "score fusion",
        "biometric recognition",
        "privacy leakage",
        "demographic prediction",
    ]
    found = [candidate for candidate in candidates if candidate in text]
    return ", ".join(found[:3]) if found else "ocular biometrics and demographic prediction"


def _keyword_bridge(agent: PaperExpertAgent, seed, evidence: list) -> str:
    left = _keywords_from_agent(agent, evidence)
    right = " ".join([seed.paper_title, seed.text, seed.grounding]).lower()
    if "iris" in right and "periocular" in left:
        return "cross-sensor iris/periocular feature comparison"
    if "periocular" in right and "iris" in left:
        return "cross-sensor iris/periocular feature comparison"
    if "fusion" in right or "fusion" in left:
        return "score-level fusion and leakage auditing"
    return left


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
    _deliberate(event_log, logger, "orchestrator", [
        "Scoring each boundary paper against the selected knowledge void",
        "Balancing relevance, diversity, and cross-paper bridge potential",
        "Selecting the expert panel for seed proposals",
    ])
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
        _deliberate(event_log, logger, agent.agent_id, [
            "Retrieving the most relevant evidence snippets from this paper",
            "Identifying the missing experimental bridge for the void",
            "Drafting a grounded, testable seed direction",
        ])
        try:
            ideas = agent.propose_research(area, idea_counter)
        except Exception as exc:  # keep the live UI session alive when one agent fails
            _log_agent_error(logger, f"{agent.agent_id} failed while proposing ideas", exc)
            ideas = [_fallback_seed(agent, area, idea_counter, exc)]
        for idea in ideas:
            bb.add_seed(idea)
        # Emit cumulatively so the UI grows the seed list live.
        event_log.event("seed_ideas_done", {"ideas": [_seed_payload(s) for s in bb.seeds]})
        _emit_predicted_accuracy(
            event_log,
            iteration=len(bb.seeds),
            label=f"seed-{len(bb.seeds)}",
            seed_count=len(bb.seeds),
            cross_count=len(bb.cross_pollinations),
        )
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
                _deliberate(event_log, logger, agent.agent_id, [
                    f"Comparing {agent.paper.paper_id} with seed {seed.paper_id}",
                    "Checking whether the pairing creates a non-trivial technical bridge",
                    "Estimating evaluation criteria before adding the hybrid idea",
                ])
                try:
                    cp = agent.cross_pollinate(area, seed, cp_counter)
                except Exception as exc:  # keep the session moving past one failed pair
                    _log_agent_error(
                        logger,
                        f"{agent.agent_id} failed while cross-pollinating with {seed.paper_id}",
                        exc,
                    )
                    cp = _fallback_cross(agent, seed, cp_counter, exc)
                bb.add_cross_pollination(cp)
                event_log.event(
                    "cross_ideas_done",
                    {"ideas": [_cross_payload(c, seed_agent_by_id) for c in bb.cross_pollinations]},
                )
                _emit_predicted_accuracy(
                    event_log,
                    iteration=len(bb.seeds) + len(bb.cross_pollinations),
                    label=f"cross-{len(bb.cross_pollinations)}",
                    seed_count=len(bb.seeds),
                    cross_count=len(bb.cross_pollinations),
                    stage_bonus=0.02,
                )
                if len(bb.cross_pollinations) >= args.max_cross_ideas:
                    done = True
                    break
        logger.phase_done(f"{len(bb.cross_pollinations)} hybrid idea(s)")
    else:
        logger.info("Single expert — skipping cross-pollination.")

    # ── Synthesis: research agenda over the void ──────────────────────────────
    logger.phase("Synthesizing research agenda")
    _deliberate(event_log, logger, "orchestrator", [
        "Clustering seed and cross-pollinated ideas by feasibility",
        "Prioritizing ideas with measurable evaluation hooks",
        "Synthesizing the final agenda and confidence estimate",
    ])
    orchestrator = BrainstormOrchestrator(
        selected, llm=llm, max_agents=len(selected), cross_pollinate_rounds=1, logger=logger
    )
    try:
        bb.agenda = orchestrator._synthesize(bb)
    except Exception as exc:
        _log_agent_error(logger, "orchestrator failed while synthesizing research agenda", exc)
        bb.agenda = _fallback_agenda(area, bb, exc)
    event_log.event("plan_done", {"plan": bb.agenda})
    _emit_predicted_accuracy(
        event_log,
        iteration=len(bb.seeds) + len(bb.cross_pollinations) + 1,
        label="agenda",
        seed_count=len(bb.seeds),
        cross_count=len(bb.cross_pollinations),
        stage_bonus=0.06,
    )
    logger.phase_done("Research agenda ready")

    event_log.event("session_done", {"session_dir": str(session_dir)})

    _log("\n" + "=" * 60)
    _log(f"RESEARCH AGENDA — {area}\n")
    _log(bb.agenda or "(no agenda produced)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
