"""Written answers: what a model wrote, read as answers to the questions it was asked."""

from jev.page.runs import text_answers

INTENT = {"intent": {"type": "choice", "instructions": "?", "criteria": dict.fromkeys(["time", "timer"])}}


def test_a_written_answer_matches_the_longest_option_it_starts_with():
    assert text_answers('{"intent": "timer"}', INTENT)["intent"]["choice"] == "timer"


def test_a_shorter_option_still_matches_on_its_own():
    assert text_answers('{"intent": "time"}', INTENT)["intent"]["choice"] == "time"
