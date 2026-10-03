"""The hosted letter readout: option probabilities from a provider's top log-probabilities."""

import math

import pytest

from jev import remote
from jev.remote import letter_probs


def top(**probabilities):
    """Top log-probabilities as a provider sends them; `_A` stands for the token " A"."""
    return [
        {"token": token.replace("_", " "), "logprob": math.log(probability)}
        for token, probability in probabilities.items()
    ]


def test_a_letter_with_and_without_a_leading_space_is_one_option():
    probabilities, coverage = letter_probs(top(A=0.2, _A=0.2, B=0.3), 2)
    assert coverage["status"] == "complete"
    assert probabilities == pytest.approx([4 / 7, 3 / 7])


def test_an_option_missing_from_the_top_tokens_makes_coverage_partial():
    probabilities, coverage = letter_probs(top(A=0.8, hello=0.1), 2)
    assert coverage["status"] == "partial"
    assert coverage["missing"] == ["B"]
    assert probabilities == [1.0, 0.0]


def test_no_option_letter_among_the_top_tokens_gives_no_readout():
    probabilities, coverage = letter_probs(top(hello=0.5, the=0.3), 2)
    assert coverage["status"] == "none"
    assert probabilities is None


@pytest.mark.parametrize("tokens", [top(**{"\n": 0.8}), top(AB=0.8)], ids=["whitespace", "two letters"])
def test_tokens_that_are_not_a_single_letter_are_no_option(tokens):
    assert letter_probs(tokens, 2) == (None, {"status": "none", "observed": 0, "missing": ["A", "B"]})


def test_probabilities_are_shared_out_over_the_options_seen():
    probabilities, coverage = letter_probs(top(A=0.2, B=0.3, _=0.4), 2)
    assert coverage["status"] == "complete"
    assert coverage["observed"] == pytest.approx(0.5)
    assert probabilities == pytest.approx([0.4, 0.6])


def test_token_counts_add_up_over_requests():
    reported = [{"prompt_tokens": 11, "completion_tokens": 1, "prompt_tokens_details": {"cached_tokens": 5}}]
    assert remote.total(reported * 2, "prompt_tokens") == 22


def test_a_count_one_request_did_not_report_is_unknown_not_zero():
    reported = [{"prompt_tokens": 11, "completion_tokens": 1}, {"prompt_tokens": 9}]
    assert remote.total(reported, "completion_tokens") is None
