"""Core v1 fingerprints: what makes two items the same item."""

import copy

from jev.bench.core_v1 import fingerprint

ITEM = {
    "state": {"text": "hi"},
    "questions": {"answer": {"type": "choice", "instructions": "Which?", "criteria": {"x": None, "y": None}}},
    "truth": {"answer": "x"},
}


def test_option_order_changes_the_fingerprint():
    swapped = copy.deepcopy(ITEM)
    swapped["questions"]["answer"]["criteria"] = {"y": None, "x": None}
    assert fingerprint(ITEM) != fingerprint(swapped)


def test_the_prompt_version_changes_the_fingerprint():
    assert fingerprint(ITEM) != fingerprint(ITEM, "another")
