from pathlib import Path

from agentswarm import KeywordRetriever, PaperExpertAgent, SwarmOrchestrator, load_paper


PAPER_PATH = (
    Path(__file__).parent.parent
    / "data"
    / "cleaned_json"
    / "attention_is_all_you_need_cleaned.json"
)


class StubLLM:
    def complete(self, messages):
        return f"Stubbed paper expert answer: {messages[-1]['content'][:80]}"


def test_load_paper_extracts_sections():
    paper = load_paper(PAPER_PATH)

    assert paper.paper_id == "attention_is_all_you_need"
    assert paper.title == "Attention Is All You Need"
    assert len(paper.chunks) > 80
    assert any(chunk.section == "Multi-Head Attention" for chunk in paper.chunks)


def test_retriever_finds_attention_mechanism():
    paper = load_paper(PAPER_PATH)
    retriever = KeywordRetriever([paper])

    results = retriever.search(
        "scaled dot-product attention mechanism",
        paper_id="attention_is_all_you_need",
        top_k=3,
    )

    assert results
    assert any("attention" in result.chunk.text.lower() for result in results)


def test_orchestrator_returns_grounded_synthesis():
    paper = load_paper(PAPER_PATH)
    retriever = KeywordRetriever([paper])
    agent = PaperExpertAgent(paper, retriever, llm=StubLLM())
    orchestrator = SwarmOrchestrator([agent])

    blackboard = orchestrator.run("What is scaled dot-product attention?")

    assert blackboard.claims
    assert blackboard.synthesis is not None
    assert "attention_is_all_you_need" in blackboard.synthesis.answer
    assert blackboard.synthesis.citations
