"""Live comparison page.

Two modes. Generate vs readout: one local model answers the same questions two ways, writing
JSON token by token on the left, reading the logits in one pass on the right. Compare: the same
request to any two backends side by side, local, a llama.cpp server or hosted.

Nothing is loaded at start. A local model is downloaded when first picked: into the Hugging
Face cache if it is already there, else into ./models (git-ignored; JEV_MODELS overrides).

    python demo.py [model_id] [port]      # then open http://localhost:8080
"""

import gc
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock, Thread

import torch
from huggingface_hub import try_to_load_from_cache
from huggingface_hub.constants import HF_HUB_CACHE
from transformers import TextIteratorStreamer

from jev import DEFAULT_MODEL, SYSTEM, Jev, _options, _text
from remote import BACKENDS, Remote, env

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "demo.html")
MODELS = os.environ.get("JEV_MODELS") or os.path.join(HERE, "models")
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
DATA = os.path.join(HERE, "data")  # dataset rows fetched for the demo, git-ignored
LOGS = os.path.join(HERE, "results", "logs", "demo")  # one .jsonl per batch, git-ignored
ROWS = "https://datasets-server.huggingface.co/rows?dataset={}&config={}&split={}&offset={}&length=100"
# name: (Hub dataset, config, split, state fields, question, label field, the label meaning yes)
DATASETS = {
    "SST-2 sentiment": (
        "stanfordnlp/sst2", "default", "validation", {"review": "sentence"},
        "Is this review positive?", "label", "positive",
    ),
    "RTE entailment": (
        "nyu-mll/glue", "rte", "validation", {"sentence A": "sentence1", "sentence B": "sentence2"},
        "Does sentence A entail sentence B?", "label", "entailment",
    ),
    "BoolQ": (
        "google/boolq", "default", "validation", {"passage": "passage", "question": "question"},
        "Is the answer to the question yes?", "answer", True,
    ),
    "SNLI": (
        "stanfordnlp/snli", "plain_text", "test", {"premise": "premise", "hypothesis": "hypothesis"},
        "How does the hypothesis relate to the premise?", "label", None,
    ),
    "AG News topic": (
        "fancyzhx/ag_news", "default", "test", {"news": "text"},
        "Which section does this news belong to?", "label", None,
    ),
    "Tweet emotion": (
        "cardiffnlp/tweet_eval", "emotion", "test", {"tweet": "text"},
        "Which emotion does this tweet express?", "label", None,
    ),
    "Banking77": (
        "legacy-datasets/banking77", "default", "test", {"message": "text"},
        "What does the customer want?", "label", None,
    ),
    "CLINC150": (
        "clinc/clinc_oos", "plus", "test", {"message": "text"},
        "What does the user want? (oos = none of these)", "intent", None,
    ),
}  # fmt: skip


ABOUT = {  # one line per set, shown when hovering it in the page
    "SST-2 sentiment": "Is this movie-review sentence positive?",
    "RTE entailment": "Does sentence A entail sentence B?",
    "BoolQ": "Given a Wikipedia passage, is the answer to the question yes?",
    "SNLI": "Premise and hypothesis: entailment, neutral or contradiction?",
    "AG News topic": "News snippet: World, Sports, Business or Sci/Tech?",
    "Tweet emotion": "Tweet: anger, joy, optimism or sadness?",
    "Banking77": "Banking customer message: which of 77 intents?",
    "CLINC150": "Assistant request: which of 150 intents, or out of scope?",
    "TypeSafe cases": "TypeSafe's published cases: a business document with several questions",
}
OPTIONS = {
    "SNLI": 3,
    "AG News topic": 4,
    "Tweet emotion": 4,
    "Banking77": 77,
    "CLINC150": 151,
}  # the rest are yes/no
LETTER = {
    "deepseek",
    "moonshot",
    "openrouter",
    "openai",
    "llamacpp",
}  # read the answer as a letter: 26 options at most
PROGRESS = {}  # downloading now: name -> [done, total, unit]; a model is measured on disk as it arrives
DECKS = {}  # dataset name -> row indices not dealt yet, so a batch never repeats an item


def dataset_path(name):
    return os.path.join(DATA, name.replace(" ", "-").lower() + ".json")


def sample(name):
    """One random labelled item as a request, plus its truth. The first call per dataset
    downloads 300 rows (three random pages) into DATA; later calls deal from them."""
    if name == "TypeSafe cases":  # several questions per document, each with its consensus label
        import eval  # only this dataset needs it

        cases = eval.typesafe_rows()
        if not DECKS.get(name):
            DECKS[name] = random.sample(range(len(cases)), len(cases))
        case, node, doc, qs, truth = cases[DECKS[name].pop()]
        truth = {k: {"true": "yes", "false": "no"}.get(v, v) for k, v in truth.items()}
        src = "TypeSafe · " + case
        pool = len(cases)
        return {"state": doc, "questions": qs, "truth": truth, "source": src, "options": None, "pool": pool}
    hub, config, split, fields, question, label, yes = DATASETS[name]
    path = dataset_path(name)
    if not os.path.exists(path):
        PROGRESS[name] = [0, 3, "pages"]
        try:
            with urllib.request.urlopen(ROWS.format(hub, config, split, 0), timeout=30) as r:
                first = json.load(r)
            total, rows = first["num_rows_total"], first["rows"]
            starts = range(100, max(101, total - 100), 100)
            picked = random.sample(starts, min(2, len(starts)))
            PROGRESS[name] = [1, 1 + len(picked), "pages"]
            for o in picked:
                with urllib.request.urlopen(ROWS.format(hub, config, split, o), timeout=30) as r:
                    rows += json.load(r)["rows"]
                PROGRESS[name][0] += 1
        finally:
            PROGRESS.pop(name, None)
        os.makedirs(DATA, exist_ok=True)
        with open(path, "w") as f:
            json.dump({"features": first["features"], "rows": rows}, f)
    with open(path) as f:
        page = json.load(f)
    names = next(x["type"].get("names") for x in page["features"] if x["name"] == label)
    rows = [r for r in page["rows"] if r["row"][label] != -1]  # SNLI marks unlabelled pairs -1
    if not DECKS.get(name):
        DECKS[name] = random.sample(range(len(rows)), len(rows))
    r = rows[DECKS[name].pop()]
    row, value = r["row"], r["row"][label]
    value = names[value] if names else value
    state = {k: row[v] for k, v in fields.items()}
    if yes is not None:
        q = {"type": "noul", "instructions": question}
        truth = "yes" if value == yes else "no"
    else:
        q = {"type": "choice", "instructions": question, "criteria": dict.fromkeys(names)}
        truth = value
    return {
        "state": state,
        "questions": {"answer": q},
        "truth": {"answer": truth},
        "source": f"{hub} · {split} row {r['row_idx']}",
        "options": 2 if yes is not None else len(names),
        "pool": len(rows),
    }


DEVICE = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
# jev.py loads bf16 on CUDA and on CPUs with native bf16, float32 elsewhere (twice the memory)
BF16 = DEVICE == "cuda" or getattr(torch.cpu, "_is_avx512_bf16_supported", lambda: False)()


def where(model_id):
    """(cache folder, downloaded?): the Hugging Face cache if the model is there, else MODELS."""
    for cache in (HF_HUB_CACHE, MODELS):
        found = [
            try_to_load_from_cache(model_id, f, cache_dir=cache)
            for f in ("config.json", "model.safetensors", "model.safetensors.index.json")
        ]
        if isinstance(found[0], str) and any(isinstance(x, str) for x in found[1:]):
            return cache, True
    return MODELS, False


def folder_bytes(path):
    return sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs)


def progress():
    """Everything downloading now; a model's progress is the size of its folder so far."""
    out = {}
    for k, (done, total, unit) in list(PROGRESS.items()):
        if unit == "bytes":
            done = folder_bytes(done) if os.path.isdir(done) else 0
        out[k] = {"done": done, "total": total, "unit": unit}
    return out


def memory_gb():
    if DEVICE == "cuda":
        return torch.cuda.get_device_properties(0).total_memory / 1e9
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1e9
    except (ValueError, OSError, AttributeError):  # Windows has no sysconf
        return None


def llamacpp_url():
    return env("LLAMACPP_URL") or BACKENDS["llamacpp"][1]


def backends(extra):
    """Everything the page can pick, with what it needs before it can run."""
    out, mem = [], memory_gb()
    for m in dict.fromkeys([*LOCAL, *extra]):
        if m.startswith("remote:"):
            continue
        cache, have = where(m)
        gb = LOCAL.get(m)
        out.append(
            {
                "id": m,
                "group": "local",
                "label": m.split("/")[-1].removesuffix("-Instruct"),
                "ready": have,
                "path": os.path.join(cache, "models--" + m.replace("/", "--")),
                "gb": gb,
                "need_gb": gb and round(gb * (1 if BF16 else 2) * 1.3, 1),
                "have_gb": mem and round(mem, 1),
                "device": DEVICE,
                "tested": m in LOCAL,
            }
        )
    url = llamacpp_url()
    try:
        with urllib.request.urlopen(url.split("/v1/")[0] + "/health", timeout=0.5) as r:
            up = (
                json.loads(r.read()).get("status") == "ok"
            )  # llama-server's reply, not a page that mentions "ok"
    except (OSError, ValueError, AttributeError):
        up = False
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
    for b, label in HOSTED.items():
        var = BACKENDS[b][0]
        ready, most = bool(env(var)), 26 if b in LETTER else None
        out.append(
            {"id": "remote:" + b, "group": "hosted", "label": label, "ready": ready, "key": var, "max": most}
        )
    return out


SAMPLE_LOCK = Lock()
LOADED, LOCK = {}, Lock()  # backend id -> Jev or Remote; at most two local models stay in memory


def get(bid):
    with LOCK:
        if bid not in LOADED:
            if bid.startswith("remote:"):
                try:
                    LOADED[bid] = Remote(bid.split(":", 1)[1])
                except SystemExit as e:  # no key
                    raise ValueError(str(e)) from None
            else:
                for old in [k for k in LOADED if not k.startswith("remote:")][:-1]:
                    del LOADED[old]
                gc.collect()
                if DEVICE == "cuda":
                    torch.cuda.empty_cache()
                cache, have = where(bid)
                if not have:
                    gb = LOCAL.get(bid)
                    PROGRESS[bid] = [
                        os.path.join(cache, "models--" + bid.replace("/", "--")),
                        gb and gb * 1e9,
                        "bytes",
                    ]
                try:
                    LOADED[bid] = Jev(bid, cache_dir=cache)
                finally:
                    PROGRESS.pop(bid, None)
        return LOADED[bid]


def set_key(bid, key, save):
    """Use a key typed into the page: test it with one tiny request, then keep it for this
    session and, if asked, write it to .env (git-ignored). A rejected key changes nothing."""
    var = BACKENDS[bid.split(":", 1)[1]][0]
    old = os.environ.get(var)
    os.environ[var] = key
    LOADED.pop(bid, None)
    try:
        get(bid).ask({"text": "hello"}, {"q": {"type": "noul", "instructions": "Is this a greeting?"}})
    except Exception:
        if old is None:
            os.environ.pop(var, None)
        else:
            os.environ[var] = old
        LOADED.pop(bid, None)
        raise
    if save:
        path = os.path.join(HERE, ".env")
        lines = open(path).read().splitlines() if os.path.exists(path) else []
        at = next((i for i, x in enumerate(lines) if x.partition("=")[0].strip() == var), None)
        if at is None:
            lines.append(f"{var}={key}")
        else:
            lines[at] = f"{var}={key}"
        with open(path, "w") as f:
            f.write("\n".join(lines) + "\n")


@torch.no_grad()
def generate(jev, state, questions):
    """Ask the model to write all answers as one JSON object; yield text as it comes."""
    lines = []
    for qid, q in questions.items():
        labels, descs = _options(q)
        opts = ", ".join(f"{la} ({_text(d)})" if d else la for la, d in zip(labels, descs, strict=True))
        lines.append(f'"{qid}": {_text(q["instructions"])} — one of: {opts}')
    user = (
        f"STATE:\n{_text(state)}\n\nAnswer every question as one JSON object, "
        f"keys exactly as given, values from the allowed options:\n" + "\n".join(lines)
    )
    msgs = [{"role": "system", "content": SYSTEM.split(" Read")[0]}, {"role": "user", "content": user}]
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


def main(model_id=DEFAULT_MODEL, port=8080):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"  # chunked streaming needs 1.1; 1.0 clients would see the size markers

        def _send(self, code, data, ctype="application/json"):
            self.send_response(code)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path.endswith("/backends"):
                return self._send(200, json.dumps(backends([model_id])).encode())
            if self.path.endswith("/progress"):
                return self._send(200, json.dumps(progress()).encode())
            if self.path.endswith("/datasets"):
                sets = [
                    {"name": n, "options": OPTIONS.get(n, 2), "local": os.path.exists(dataset_path(n))}
                    for n in DATASETS
                ]
                ts = os.path.isdir(os.path.join(HERE, "results", "typesafe"))
                sets.append({"name": "TypeSafe cases", "options": None, "local": ts})
                for x in sets:
                    x["about"] = ABOUT[x["name"]]
                return self._send(200, json.dumps(sets).encode())
            with open(PAGE, encoding="utf-8") as f:
                page = f.read().replace("{{model}}", model_id)
            self._send(200, page.encode(), "text/html; charset=utf-8")

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
            try:
                if self.path.endswith("/sample"):
                    with SAMPLE_LOCK:  # batches ask in parallel; one download and one deck per set
                        item = sample(body["dataset"])
                    return self._send(200, json.dumps(item).encode())
                if self.path.endswith("/key"):
                    if self.client_address[0] not in ("127.0.0.1", "::1"):
                        raise ValueError("keys can only be set from this machine")
                    set_key(body["backend"], body["key"].strip(), body.get("save", False))
                    return self._send(200, b"{}")
                jev = get(body.get("backend") or model_id)
                if self.path.endswith("/load"):  # downloads a local model the first time
                    return self._send(200, json.dumps({"device": jev.device}).encode())
                if self.path.endswith("/generate"):
                    if not isinstance(jev, Jev):
                        raise ValueError("writing the answers as text needs a local model")
                    self.send_response(200)
                    self.send_header("content-type", "text/plain; charset=utf-8")
                    self.send_header("transfer-encoding", "chunked")
                    self.end_headers()
                    for piece in generate(jev, body["state"], body["questions"]):
                        chunk = piece.encode()
                        if not chunk:  # a zero-length chunk would end the stream
                            continue
                        self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                        self.wfile.flush()
                    self.wfile.write(b"0\r\n\r\n")
                    return
                t = time.time()
                res = jev.ask(body["state"], body["questions"])
                res["latency_ms"] = round((time.time() - t) * 1000)
                if body.get("log"):  # a batch: keep every answer with its input and label
                    name = "".join(c if c.isalnum() or c in "._-" else "-" for c in body["log"])[:120]
                    os.makedirs(LOGS, exist_ok=True)
                    row = {k: body.get(k) for k in ("dataset", "source", "state", "questions", "truth")}
                    row |= {
                        "backend": body.get("backend") or model_id,
                        "answers": res["answers"],
                        "ms": res["latency_ms"],
                    }
                    with LOCK, open(os.path.join(LOGS, name + ".jsonl"), "a") as f:
                        f.write(json.dumps(row, ensure_ascii=False) + "\n")
                self._send(200, json.dumps(res).encode())
            except Exception as e:
                bid = body.get("backend") or model_id
                msg = str(e)
                if isinstance(e, urllib.error.HTTPError) and bid.startswith("remote:"):
                    LOADED.pop(bid, None)  # the next try re-reads .env
                    name = next((x["label"] for x in backends([]) if x["id"] == bid), bid)
                    var = BACKENDS[bid.split(":", 1)[1]][0]
                    fix = "That key was rejected." if self.path.endswith("/key") else f"Check {var} in .env."
                    msg = f"{name} answered HTTP {e.code} ({e.reason})" + (
                        f". {fix}" if e.code in (401, 403) else "."
                    )
                elif isinstance(e, urllib.error.URLError):
                    LOADED.pop(bid, None)
                    msg = f"Could not reach {bid.split(':', 1)[-1]}: {e.reason}"
                self._send(400, json.dumps({"error": {"message": msg}}).encode())

        def log_message(self, fmt, *a):
            sys.stderr.write(f"{self.command} {self.path} {a[1] if len(a) > 1 else ''}\n")

    print(f"open http://localhost:{port}  ({DEVICE}; models in {HF_HUB_CACHE} or {MODELS})")
    server = ThreadingHTTPServer(("", port), H)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()


if __name__ == "__main__":
    a = sys.argv[1:]
    main(*a[:1], **({"port": int(a[1])} if len(a) > 1 else {}))
