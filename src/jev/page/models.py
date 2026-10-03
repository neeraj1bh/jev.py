"""The models the page can pick: on this machine, behind a local server or hosted; loading one,
and asking one to write its answers as text."""

import gc
import json
import os
import urllib.error
import urllib.request
from threading import Lock, Thread

import torch
from huggingface_hub.constants import HF_HUB_CACHE
from transformers import TextIteratorStreamer

from jev.bench.datasets import DATA
from jev.core import ROOT, SYSTEM, Jev, _options, _text
from jev.local import cache, downloads, folders, hub, llamaserver
from jev.local.downloads import PROGRESS
from jev.page.catalog import live_prices
from jev.remote import BACKENDS, EXTRAS, Remote, env

MODELS = os.environ.get("JEV_MODELS") or os.path.join(ROOT, "models")
LOCAL = {  # tested models: weights on disk, GB
    "Qwen/Qwen2.5-0.5B-Instruct": 1.0,
    "Qwen/Qwen2.5-1.5B-Instruct": 3.1,
    "Qwen/Qwen2.5-3B-Instruct": 6.2,
}
HOSTED = {
    "typesafe": "Jev (TypeSafe)",
    "deepseek": "DeepSeek",
    "openai": "OpenAI",
    "openrouter": "OpenRouter",
    "moonshot": "Kimi",
    "vercel": "Jev (Vercel)",
}
ADDED_PATH = os.path.join(DATA, "added-models.json")  # Hugging Face models added in the page: id -> GB

LETTER = {
    "deepseek",
    "moonshot",
    "openrouter",
    "openai",
    "llamacpp",
}  # read the answer as a letter: 26 options at most

DEVICE = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
# jev.py loads bf16 on CUDA and on CPUs with native bf16, float32 elsewhere (twice the memory)
BF16 = DEVICE == "cuda" or getattr(torch.cpu, "_is_avx512_bf16_supported", lambda: False)()


def where(model_id):
    """(cache folder, complete?): where the whole model is, else MODELS for a new download."""
    found = on_disk().get(model_id)
    return (found[0], True) if found else (MODELS, False)


def memory_gb():
    if DEVICE == "cuda":
        return torch.cuda.get_device_properties(0).total_memory / 1e9
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1e9
    except (ValueError, OSError, AttributeError):  # Windows has no sysconf
        return None


def llamacpp_url():
    return env("LLAMACPP_URL") or BACKENDS["llamacpp"][1]


def laya_url():
    return env("LAYA_URL") or BACKENDS["laya"][1]


def laya_up(url, timeout=0.5):
    """Whether a laya-serve answers at this address. Its health reply lists the checkpoints it
    holds, which tells it from whatever else may be listening on so common a port."""
    try:
        with urllib.request.urlopen(url.split("/v1/")[0] + "/health", timeout=timeout) as r:
            reply = json.loads(r.read())
        return reply.get("status") == "ok" and "loaded" in reply
    except (OSError, ValueError, AttributeError):
        return False


def added():
    try:
        with open(ADDED_PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def add_model(model_id):
    """Check a Hugging Face id and remember it; nothing downloads until it is picked."""
    gb = hub.check(model_id, env("HF_TOKEN"))
    models = added() | {model_id: gb}
    os.makedirs(DATA, exist_ok=True)
    with open(ADDED_PATH, "w") as f:
        json.dump(models, f, indent=1)


def model_gb(model_id):
    return LOCAL.get(model_id) or added().get(model_id)


def caches():
    """The Hugging Face cache, models/, and any other cache folder added in the page."""
    return list(dict.fromkeys([HF_HUB_CACHE, MODELS, *filter(folders.is_hf_cache, model_dirs())]))


def on_disk():
    return cache.on_disk(caches())


def model_places():
    """Folders known to hold models: each usable model's folder in the caches, and the folders
    added in the page."""
    return [
        os.path.join(c, "models--" + m.replace("/", "--")) for m, (c, _) in on_disk().items()
    ] + model_dirs()


def model_dirs():
    """Folders added in the page and the known llama.cpp and LM Studio ones; a folder inside a
    Hugging Face cache is left out, since the cache itself is read by model name."""
    added = [*folders.settings()["folders"], *folders.KNOWN]
    return [d for d in dict.fromkeys(added) if not in_cache(d)]


def in_cache(folder):
    return any(folder.startswith(c.rstrip(os.sep) + os.sep) for c in (HF_HUB_CACHE, MODELS))


def folder_models():
    return folders.scan(model_dirs())


def folder_state():
    """The folders added in the page, how many models each holds, and the llama-server in use."""

    def count(d):
        return len(folders.scan([d])) + (len(cache.on_disk([d])) if folders.is_hf_cache(d) else 0)

    listed = [{"path": d, "models": count(d)} for d in model_dirs()]
    gguf = any(k.startswith("gguf:") for k in folders.scan(model_dirs()))
    return {"folders": listed, "llama_server": folders.llama_server(), "has_gguf": gguf}


def local_ids(extra):
    """Chat models already on this machine, the ones added in the page, and the built-in starters
    until three models are on disk."""
    disk = on_disk()
    starters = list(LOCAL) if len(disk) < 3 else []
    in_folders = folders.scan(model_dirs())
    return list(dict.fromkeys([*disk, *added(), *starters, *in_folders, *extra])), disk


def backends(extra):
    """Everything the page can pick, with what it needs before it can run."""
    out, mem = [], memory_gb()
    ids, disk = local_ids(extra)
    in_folders = folders.scan(model_dirs())
    for m in ids:
        if m.startswith("remote:") or m in in_folders:
            continue
        found = disk.get(m)
        folder = found[0] if found else MODELS
        gb = model_gb(m) or (found and found[1])
        out.append(
            {
                "id": m,
                "group": "local",
                "label": m.split("/")[-1].removesuffix("-Instruct"),
                "ready": bool(found),
                "path": os.path.join(folder, "models--" + m.replace("/", "--")),
                "gb": gb,
                "need_gb": gb and round(gb * (1 if BF16 else 2) * 1.3, 1),
                "have_gb": mem and round(mem, 1),
                "device": DEVICE,
                "tested": m in LOCAL,
            }
        )
    for fid, found in in_folders.items():
        gguf = found["kind"] == "gguf"
        entry = {"id": fid, "label": found["label"], "gb": found["gb"], "path": fid.removeprefix("gguf:")}
        if gguf:  # read by letter through a llama-server started for it
            running = llamaserver.running(entry["path"])
            out.append(
                entry
                | {
                    "group": "gguf",
                    "ready": bool(folders.llama_server()),
                    "max": 26,
                    "running": running,
                    "budget_gb": llamaserver.budget_gb(folders.llama_server()),
                }
            )
        else:
            need = round(found["gb"] * (1 if BF16 else 2) * 1.3, 1)
            out.append(entry | {"group": "local", "ready": True, "device": DEVICE, "need_gb": need})
    url = llamacpp_url()
    try:
        with urllib.request.urlopen(url.split("/v1/")[0] + "/health", timeout=0.5) as r:
            up = (
                json.loads(r.read()).get("status") == "ok"
            )  # llama-server's reply, not a page that mentions "ok"
    except (OSError, ValueError, AttributeError):
        up = False
    # Listed only when a llama-server answers or its address was set under Keys; most machines have none.
    if up or env("LLAMACPP_URL"):
        out.append(
            {
                "id": "remote:llamacpp",
                "group": "server",
                "label": "llama.cpp server",
                "ready": up,
                "url": url,
                "max": 26,
            }
        )
    laya, laya_answers = laya_url(), laya_up(laya_url())
    # Like the llama-server above: listed only when one answers or its address was set under Keys.
    if laya_answers or env("LAYA_URL"):
        out.append(
            {"id": "remote:laya", "group": "server", "label": "Laya", "ready": laya_answers, "url": laya}
        )
    prices = live_prices()
    for b, label in HOSTED.items():
        var = BACKENDS[b][0]
        ready, most = bool(env(var)), 26 if b in LETTER else None
        price = prices.get(b)
        out.append(
            {
                "id": "remote:" + b,
                "group": "hosted",
                "label": label,
                "ready": ready,
                "key": var,
                "max": most,
                "model": BACKENDS[b][2],  # the one model this direct API is pinned to
            }
            | ({"price": price[0], "price_out": price[1]} if price else {})
        )
    return out


LOADED, LOCK = {}, Lock()  # backend id -> Jev or Remote; at most two local models stay in memory


def download_model(bid):
    """Fetch a Hugging Face model's files when they are not on disk yet; loads nothing."""
    if bid.startswith(("remote:", "openrouter:", "gguf:")) or os.path.isdir(bid):
        return
    folder, have = where(bid)
    if not have:
        if env("HF_TOKEN"):  # a gated model downloads with the token saved under Keys
            os.environ["HF_TOKEN"] = env("HF_TOKEN")
        downloads.fetch(bid, folder, PROGRESS)


def get(bid):
    if bid.startswith("gguf:"):
        if not folders.llama_server():
            raise ValueError("Set the llama-server program in Add a model to run GGUF models")
        path = bid.removeprefix("gguf:")
        size = folder_models().get(bid, {}).get("gb")
        url = llamaserver.serve(path, folders.llama_server(), size)
        remote = LOADED.get(bid) or Remote("llamacpp", model=os.path.basename(bid))
        remote.url = url + "/v1/chat/completions"
        LOADED[bid] = remote
        return remote
    backend = LOADED.get(bid)
    if backend:
        return backend
    if bid.startswith(("remote:", "openrouter:")):
        kind, _, name = bid.partition(":")
        try:  # remote:llamacpp:<name> names the model loaded in llama-server
            backend = Remote(*name.split(":", 1)) if kind == "remote" else Remote("openrouter", model=name)
        except SystemExit as e:  # no key
            raise ValueError(str(e)) from None
        return LOADED.setdefault(bid, backend)
    download_model(bid)  # outside LOCK, so other models keep answering while this one downloads
    with LOCK:
        backend = LOADED.get(bid)
        if not backend:
            for old in [k for k in LOADED if not k.startswith("remote:")][:-1]:
                del LOADED[old]
            gc.collect()
            if DEVICE == "cuda":
                torch.cuda.empty_cache()
            backend = LOADED[bid] = Jev(bid, cache_dir=where(bid)[0])
        return backend


def messages(state, questions):
    """The usual way: ask for every answer written out as one JSON object."""
    lines = []
    for qid, q in questions.items():
        labels, descs = _options(q)
        opts = ", ".join(f"{la} ({_text(d)})" if d else la for la, d in zip(labels, descs, strict=True))
        lines.append(f'"{qid}": {_text(q["instructions"])} — one of: {opts}')
    user = (
        f"STATE:\n{_text(state)}\n\nAnswer every question as one JSON object, "
        f"keys exactly as given, values from the allowed options:\n" + "\n".join(lines)
    )
    return [{"role": "system", "content": SYSTEM.split(" Read")[0]}, {"role": "user", "content": user}]


def generate_remote(r, state, questions):
    """The same request written out by a hosted model, streamed as it arrives."""
    body = {"model": r.model_id, "messages": messages(state, questions), "stream": True}
    body |= {"max_tokens": 24 * len(questions), **EXTRAS.get(r.backend, {})}
    headers = {"authorization": f"Bearer {r.key}", "content-type": "application/json"}
    req = urllib.request.Request(r.url, data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp:
        for raw in resp:
            line = raw.decode().strip()
            if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                continue
            choices = json.loads(line[5:])["choices"]
            if choices and choices[0].get("delta", {}).get("content"):
                yield choices[0]["delta"]["content"]


@torch.no_grad()
def generate(jev, state, questions):
    """Ask the model to write all answers as one JSON object; yield text as it comes."""
    msgs = messages(state, questions)
    text = jev.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    enc = jev.tok(text, return_tensors="pt").to(jev.device)
    streamer = TextIteratorStreamer(jev.tok, skip_prompt=True, skip_special_tokens=True)
    Thread(
        target=jev.model.generate,
        kwargs=dict(
            **enc,
            streamer=streamer,
            do_sample=False,
            temperature=None,
            top_p=None,
            top_k=None,
            max_new_tokens=24 * len(questions),
        ),
    ).start()
    yield from streamer
