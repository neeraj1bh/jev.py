"""Offline checks, run by jev-bench check: written answers, fingerprints, RAGTruth's length pairing
and the scorer, on made-up data with no network. The letter readout's are in tests/."""

import json

from jev.bench.core_v1 import fingerprint
from jev.bench.picks import RAGTRUTH, ragtruth
from jev.page import runs


def check():
    """Offline asserts on written answers, fingerprints and RAGTruth's pairing; no network."""
    intent = {"intent": {"type": "choice", "instructions": "?", "criteria": dict.fromkeys(["time", "timer"])}}
    assert runs.text_answers('{"intent": "timer"}', intent)["intent"]["choice"] == "timer"
    assert runs.text_answers('{"intent": "time"}', intent)["intent"]["choice"] == "time"
    assert json.loads(json.dumps(0.123456789)) == 0.123456789
    item = {
        "state": {"text": "hi"},
        "questions": {
            "answer": {"type": "choice", "instructions": "Which?", "criteria": {"x": None, "y": None}}
        },
        "truth": {"answer": "x"},
    }
    swapped = json.loads(json.dumps(item))
    swapped["questions"]["answer"]["criteria"] = {"y": None, "x": None}
    assert fingerprint(item) != fingerprint(swapped), "option order must count"
    assert fingerprint(item) != fingerprint(item, "another"), "the prompt version must count"

    def ragtruth_row(i, label, size, task):
        row = {"row_idx": i, "row": {"task_type": task, "context": f"source {i}"}}
        return row, {"state": {"response": "word " * size}, "truth": {"answer": label}}

    tasks = [task for task in RAGTRUTH for _ in range(10)]
    unmatched = [ragtruth_row(i, "yes", 10, t) for i, t in enumerate(tasks)]
    unmatched += [ragtruth_row(100 + i, "no", 100, t) for i, t in enumerate(tasks)]
    try:
        ragtruth(unmatched, "check")
        raise AssertionError("RAGTruth must stop when its pairs cannot be length-matched")
    except ValueError:
        pass
    check_scoring()
    print("OK  written answers, fingerprint, RAGTruth pairing and scoring checks")


def check_scoring():
    """The scorer's weighting, probability eligibility and failures, on made-up counts."""
    from jev.bench import score

    sets = {
        "A": {"track": "headline", "group": "one"},
        "B": {"track": "headline", "group": "one"},
        "C": {"track": "headline", "group": "two"},
        "RewardBench": {"track": "headline", "group": "three"},
        "D": {"track": "auxiliary", "group": "two"},
    }
    counts = {
        ("A", None): [1, 1],
        ("B", None): [0, 1],
        ("C", None): [1, 2],
        ("D", None): [5, 5],  # auxiliary: never in the headline
        ("RewardBench", "Chat"): [1, 1],
        ("RewardBench", "Safety"): [1, 3],  # families averaged: 2/3, not the pooled 1/2
    }
    overall, groups = score.headline(counts, sets)
    assert groups == {"one": 0.5, "two": 0.5, "three": 2 / 3} and abs(overall - 5 / 9) < 1e-12
    partial = {"type": "choice", "choice": "x", "probabilities": {"x": 1.0, "y": 0.0}}
    assert score.distribution(partial | {"coverage": {"status": "partial"}}, ["x", "y"]) is None
    assert score.distribution(partial, ["x", "y"]) == [1.0, 0.0]
    assert score.distribution({"type": "noul", "noul": 0.25}, ["yes", "no"]) == [0.25, 0.75]
    assert score.distribution(None, ["yes", "no"]) is None
    row = {
        "set": "A",
        "source": "a · test row 7",
        "state": {"text": "hi"},
        "questions": {"q": {"type": "noul", "instructions": "?"}},
        "truth": {"q": "yes"},
        "answers": {},  # no answer: wrong, and no probabilities
    }
    (missing,) = score.outcomes(row, {}, {})
    assert not missing["right"] and missing["p"] is None
    probs = score.probability_scores([missing | {"p": [0.0, 1.0], "y": 0}, missing])
    assert probs["complete"] == 1 and probs["clipped"] == 1 and probs["brier"] == 2
