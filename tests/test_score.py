"""The Core v1 scorer: weighting, which answers count for probabilities, and failures."""

import pytest

from jev.bench import score

SETS = {
    "A": {"track": "headline", "group": "one"},
    "B": {"track": "headline", "group": "one"},
    "C": {"track": "headline", "group": "two"},
    "RewardBench": {"track": "headline", "group": "three"},
    "D": {"track": "auxiliary", "group": "two"},
}


def test_the_headline_averages_groups_and_rewardbench_families():
    counts = {
        ("A", None): [1, 1],
        ("B", None): [0, 1],
        ("C", None): [1, 2],
        ("D", None): [5, 5],  # auxiliary: never in the headline
        ("RewardBench", "Chat"): [1, 1],
        ("RewardBench", "Safety"): [1, 3],  # families averaged: 2/3, not the pooled 1/2
    }
    overall, groups = score.headline(counts, SETS)
    assert groups == {"one": 0.5, "two": 0.5, "three": pytest.approx(2 / 3)}
    assert overall == pytest.approx(5 / 9)


def test_only_answers_with_complete_probabilities_have_a_distribution():
    answer = {"type": "choice", "choice": "x", "probabilities": {"x": 1.0, "y": 0.0}}
    assert score.distribution(answer, ["x", "y"]) == [1.0, 0.0]
    assert score.distribution(answer | {"coverage": {"status": "partial"}}, ["x", "y"]) is None
    assert score.distribution(None, ["yes", "no"]) is None


def test_a_yes_no_answer_is_its_probability_of_yes():
    assert score.distribution({"type": "noul", "noul": 0.25}, ["yes", "no"]) == [0.25, 0.75]


def test_a_missing_answer_is_wrong_and_has_no_probabilities():
    row = {
        "set": "A",
        "source": "a · test row 7",
        "state": {"text": "hi"},
        "questions": {"q": {"type": "noul", "instructions": "?"}},
        "truth": {"q": "yes"},
        "answers": {},
    }
    (missing,) = score.outcomes(row, {}, {})
    assert not missing["right"]
    assert missing["p"] is None
    probabilities = score.probability_scores([missing | {"p": [0.0, 1.0], "y": 0}, missing])
    assert probabilities["complete"] == 1
    assert probabilities["clipped"] == 1
    assert probabilities["brier"] == 2
