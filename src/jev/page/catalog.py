"""OpenRouter's catalog, cut to the models that really return log-probabilities, and each direct
API's own price, both read from the providers' public pages and kept for a few hours."""

import json
import os
import time
import urllib.error
import urllib.request
from threading import Thread

from jev.bench.datasets import DATA
from jev.local.downloads import PROGRESS
from jev.remote import BACKENDS, NoProbabilities, Remote, env

GATEWAY = {"at": 0.0, "models": []}  # OpenRouter's catalog, refetched every few hours
VERCEL_MODELS = "https://ai-gateway.vercel.sh/v1/models"
OPENROUTER_ENDPOINTS = "https://openrouter.ai/api/v1/models/{}/endpoints"
# Where each direct API's own price is published: Vercel's gateway lists Jev; OpenRouter lists what
# each provider charges for a model, and the provider's own entry is its API price.
PRICED_AS = {
    "typesafe": (VERCEL_MODELS, "typesafe-ai/jev"),
    "vercel": (VERCEL_MODELS, "typesafe-ai/jev"),
    "deepseek": (OPENROUTER_ENDPOINTS.format("deepseek/deepseek-v4.1-flash"), "DeepSeek"),
    "moonshot": (OPENROUTER_ENDPOINTS.format("moonshotai/kimi-k2.6"), "Moonshot AI"),
    "openai": (OPENROUTER_ENDPOINTS.format("openai/gpt-4o-mini"), "OpenAI"),
    "openrouter": (OPENROUTER_ENDPOINTS.format("openai/gpt-4o-mini"), "OpenAI"),
}
PRICES = {"at": 0.0, "prices": {}}  # backend -> ($ per 1M input, $ per 1M output)


def live_prices():
    """Each direct API's own price, read at most every few hours with no key; a price that cannot
    be read is left out, so the page shows no estimate rather than a wrong one."""
    if time.time() - PRICES["at"] > 6 * 3600:
        pages, prices = {}, {}
        for backend, (url, name) in PRICED_AS.items():
            if url not in pages:
                try:
                    with urllib.request.urlopen(url, timeout=10) as r:
                        pages[url] = json.load(r)["data"]
                except (OSError, ValueError, KeyError):
                    pages[url] = None
            data = pages[url]
            if url == VERCEL_MODELS:
                entry = next((m["pricing"] for m in data or [] if m["id"] == name), None)
                keys = ("input", "output")
            else:
                entries = data["endpoints"] if data else []
                entry = next((e["pricing"] for e in entries if e["provider_name"] == name), None)
                keys = ("prompt", "completion")
            if entry:
                prices[backend] = tuple(round(float(entry.get(k) or 0) * 1e6, 3) for k in keys)
        PRICES.update(at=time.time(), prices=prices)
    return PRICES["prices"]


GATEWAY_CHECKED = os.path.join(DATA, "gateway-checked.json")  # model -> did it return probabilities
# The same check as shipped with the package (2026-09-22), so a fresh clone lists the working
# models before any key is set; this machine's own checks, in DATA, take precedence.
SHIPPED_CHECKED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "openrouter-checked.json")


def read_checked():
    checked = {}
    for path in (SHIPPED_CHECKED, GATEWAY_CHECKED):
        try:
            with open(path) as f:
                checked |= json.load(f)
        except (OSError, ValueError):
            pass
    return checked


CHECKED = read_checked()


def check_gateway(ids):
    """Ask each model one tiny question; keep only those whose answer carries probabilities.
    The catalog claims top_logprobs for many models whose providers then send none."""
    question = {"q": {"type": "noul", "instructions": "Is this a greeting?"}}
    for n, bid in enumerate(ids):
        PROGRESS["gateway"] = [n, len(ids), "models"]
        try:
            Remote("openrouter", model=bid.split(":", 1)[1], patient=False).ask({"text": "hello"}, question)
            CHECKED[bid] = True
        except urllib.error.HTTPError as e:
            if e.code == 429:  # rate limited (free models allow 50 a day): leave it for another day
                continue
            if e.code in (401, 402, 403):  # bad key or no credit left: says nothing about any model
                break
            CHECKED[bid] = False
        except (NoProbabilities, ValueError, KeyError, IndexError):
            CHECKED[bid] = False
        except OSError:
            break  # offline; try again next time
        os.makedirs(DATA, exist_ok=True)
        with open(GATEWAY_CHECKED, "w") as f:
            json.dump(CHECKED, f)
        time.sleep(1)
    PROGRESS.pop("gateway", None)


def gateway():
    """OpenRouter models that really return top log-probabilities, the only ones a readout can use."""
    if time.time() - GATEWAY["at"] > 6 * 3600:
        try:
            with urllib.request.urlopen("https://openrouter.ai/api/v1/models", timeout=10) as r:
                data = json.load(r)["data"]
        except (OSError, ValueError, KeyError):
            return []  # offline: the page simply shows no gateway models
        usable = [
            m
            for m in data
            if "top_logprobs" in (m.get("supported_parameters") or [])
            and m.get("architecture", {}).get("output_modalities") == ["text"]  # no image or audio models
            and not m["name"].endswith("(batch)")
        ]
        GATEWAY.update(at=time.time(), models=usable)
    var = BACKENDS["openrouter"][0]
    ready = bool(env(var))
    unchecked = ["openrouter:" + m["id"] for m in GATEWAY["models"] if "openrouter:" + m["id"] not in CHECKED]
    if ready and unchecked and "gateway" not in PROGRESS:
        PROGRESS["gateway"] = [0, len(unchecked), "models"]
        Thread(target=check_gateway, args=(unchecked,), daemon=True).start()
    return [
        {
            "id": "openrouter:" + m["id"],
            "group": "gateway",
            "provider": m["id"].lstrip("~").split("/")[0],
            "label": m["name"].split(": ", 1)[-1],
            "ready": ready,
            "key": var,
            "max": 26,
            "created": m.get("created", 0),
            "free": m["id"].endswith(":free"),  # OpenRouter marks its free variants this way
            "price": round(float(m.get("pricing", {}).get("prompt") or 0) * 1e6, 3),  # $ per 1M input tokens
            "price_out": round(float(m.get("pricing", {}).get("completion") or 0) * 1e6, 3),
        }
        for m in GATEWAY["models"]
        if CHECKED.get("openrouter:" + m["id"])
    ]
