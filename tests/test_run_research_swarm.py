from itertools import count
from pathlib import Path

import run_research_swarm
from agentswarm import KeywordRetriever, Paper, PaperChunk, PaperExpertAgent
from agentswarm.brainstorm import BrainstormBlackboard


def test_fallback_seed_keeps_research_session_moving_after_agent_error():
    paper = Paper(
        paper_id="2106_08493",
        title="Multi-Scale Neural ODEs",
        abstract="",
        path=Path("void://2106_08493"),
        chunks=[
            PaperChunk(
                chunk_id="2106_08493:abstract:0",
                paper_id="2106_08493",
                paper_title="Multi-Scale Neural ODEs",
                section="Abstract",
                sec_num=None,
                text="registration multimodal medical image neural ode",
                source="abstract",
            )
        ],
    )
    retriever = KeywordRetriever([paper])
    agent = PaperExpertAgent(paper, retriever)

    idea = run_research_swarm._fallback_seed(
        agent,
        "Self-supervised contrastive learning for multimodal medical image registration",
        count(1),
        RuntimeError("Claude returned an empty completion."),
    )

    assert idea.paper_id == "2106_08493"
    assert "Multi-Scale Neural ODEs" in idea.text
    assert "Claude returned an empty completion" not in idea.grounding
    assert "identity leakage" in idea.gap


def test_fallback_agenda_omits_missing_key_from_visible_research_plan():
    bb = BrainstormBlackboard(area="medical registration")
    agenda = run_research_swarm._fallback_agenda(
        "medical registration",
        bb,
        RuntimeError("ANTHROPIC_API_KEY is required when LLM_BACKEND=anthropic."),
    )

    assert "## Research Agenda: medical registration" in agenda
    assert "ANTHROPIC_API_KEY is required" not in agenda
    assert "privacy/utility tradeoffs" in agenda
    assert "demographic leakage" in agenda


def test_expected_llm_config_errors_suppress_tracebacks():
    assert run_research_swarm._should_show_traceback(
        RuntimeError("ANTHROPIC_API_KEY is required when LLM_BACKEND=anthropic.")
    ) is False
    assert run_research_swarm._should_show_traceback(RuntimeError("unexpected parser bug")) is True
