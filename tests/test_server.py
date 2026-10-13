"""The page answers a Core v1 item exactly as frozen, whatever the browser did to its copy."""

import json

from jev.page import server

ITEM = {
    "state": {"text": "A number of bits", "price": 70600.0},
    "questions": {
        "bits": {"type": "choice", "instructions": "?", "criteria": dict.fromkeys(["32", "16", "8", "4"])}
    },
    "truth": {"bits": "16"},
}


def test_a_core_v1_item_reaches_the_model_in_its_frozen_order():
    server.CORE_ITEMS["Core v1"] = [ITEM]
    served = server.sample("Core v1", fresh=True)
    sent_back = json.loads(json.dumps(served))
    sent_back["questions"]["bits"]["criteria"] = dict.fromkeys(["4", "8", "16", "32"])
    sent_back["state"]["price"] = 70600
    asked = server.as_served(sent_back)
    assert list(asked["questions"]["bits"]["criteria"]) == ["32", "16", "8", "4"]
    assert isinstance(asked["state"]["price"], float)
    assert asked["truth"] == ITEM["truth"]


def test_a_request_without_a_served_fingerprint_is_left_as_sent():
    body = {"state": {}, "questions": {}, "fingerprint": "not-served"}
    assert server.as_served(body) is body
