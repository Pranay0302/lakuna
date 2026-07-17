from itertools import count

from agentswarm.blackboard import Evidence
from agentswarm.brainstorm import _parse_cross_pollination, _parse_ideas


def test_parse_ideas_fallback_handles_empty_model_output():
    ideas = _parse_ideas("", "expert:p1", "p1", "Paper One", [], count(1))

    assert len(ideas) == 1
    assert ideas[0].text == "Explore a concrete research direction grounded in the selected paper."
    assert ideas[0].gap == "(see full response)"


def test_parse_ideas_fallback_uses_first_sentence_without_adding_dot_only():
    ideas = _parse_ideas("Use contrastive pretraining for robust registration", "expert:p1",
                         "p1", "Paper One", [], count(1))

    assert ideas[0].text == "Use contrastive pretraining for robust registration"


def test_parse_cross_pollination_fallback_handles_empty_model_output():
    seed = _parse_ideas("Seed idea for multimodal alignment.", "expert:p1", "p1",
                        "Paper One", [], count(1))[0]

    cp = _parse_cross_pollination("", "expert:p2", "p2", "Paper Two", seed, [], count(1))

    assert cp.text == "Combine the selected papers into a concrete hybrid research direction."
    assert cp.connection == "(see full response)"
