"""RAGTruth's picking rule: hallucinated and faithful responses of matched length."""

import pytest

from jev.bench.picks import RAGTRUTH, ragtruth


def ragtruth_row(index, label, words, task):
    row = {"row_idx": index, "row": {"task_type": task, "context": f"source {index}"}}
    return row, {"state": {"response": "word " * words}, "truth": {"answer": label}}


def test_ragtruth_stops_when_its_pairs_cannot_be_length_matched():
    tasks = [task for task in RAGTRUTH for _ in range(10)]
    short_yes = [ragtruth_row(index, "yes", 10, task) for index, task in enumerate(tasks)]
    long_no = [ragtruth_row(100 + index, "no", 100, task) for index, task in enumerate(tasks)]
    with pytest.raises(ValueError):
        ragtruth(short_yes + long_no, "check")
