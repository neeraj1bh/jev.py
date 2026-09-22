"""Checks a Hugging Face model id before the page adds it, so a model that cannot work is refused
with a reason instead of failing after a multi-gigabyte download."""

import json
import urllib.error
import urllib.parse
import urllib.request

from transformers.models.auto.modeling_auto import MODEL_FOR_CAUSAL_LM_MAPPING_NAMES

API = "https://huggingface.co/api/models/{}"
CAUSAL = set(MODEL_FOR_CAUSAL_LM_MAPPING_NAMES.values())


def fetch(model_id, token=None):
    request = urllib.request.Request(
        API.format(urllib.parse.quote(model_id, safe="/")),
        headers={"authorization": f"Bearer {token}"} if token else {},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (401, 404):  # the Hub answers 401 for ids that do not exist, and for private ones
            raise ValueError(f"No model called {model_id} on the Hugging Face Hub.") from None
        raise


def check(model_id, token=None):
    """The model's size in GB at 16 bits, or ValueError saying why jev.py cannot run it."""
    info = fetch(model_id, token)
    config = info.get("config") or {}
    architectures = config.get("architectures") or []
    if "gguf" in info.get("tags", []) and not info.get("safetensors"):
        raise ValueError(f"{model_id} holds GGUF files only: run it with llama.cpp (docs/local-models.md).")
    if not any(a in CAUSAL for a in architectures):
        kind = info.get("pipeline_tag") or "not a text model"
        raise ValueError(f"{model_id} is not a text-generation model transformers can load ({kind}).")
    if not (config.get("tokenizer_config") or {}).get("chat_template"):
        raise ValueError(
            f"{model_id} has no chat template, so it is a base model: pick its instruct version."
        )
    if info.get("gated") and not token:
        raise ValueError(
            f"{model_id} is gated: accept its terms at https://huggingface.co/{model_id}, "
            "then add a Hugging Face token under Keys."
        )
    params = (info.get("safetensors") or {}).get("total")
    return params and round(params * 2 / 1e9, 1)
