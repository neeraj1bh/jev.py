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
import mimetypes
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock, Thread

import torch
from huggingface_hub import try_to_load_from_cache
from huggingface_hub.constants import HF_HUB_CACHE
from transformers import TextIteratorStreamer

from jev import DEFAULT_MODEL, SYSTEM, Jev, _options, _text
from remote import BACKENDS, EXTRAS, Remote, env

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "demo.html")
WEB = os.path.join(HERE, "web", "dist")  # the built page; see web/
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


MC = {  # benchmarks whose options differ per question: (Hub dataset, config, split, state, question, options)
    "MMLU": (
        "cais/mmlu", "all", "test",
        lambda r: {"subject": r["subject"].replace("_", " "), "question": r["question"]},
        "Which answer is correct?",
        lambda r: (r["choices"], int(r["answer"])),
    ),
    "MMLU-Pro": (
        "TIGER-Lab/MMLU-Pro", "default", "test",
        lambda r: {"subject": r["category"], "question": r["question"]},
        "Which answer is correct?",
        lambda r: (r["options"], int(r["answer_index"])),
    ),
    "ARC-Challenge": (
        "allenai/ai2_arc", "ARC-Challenge", "test",
        lambda r: {"question": r["question"]},
        "Which answer is correct?",
        lambda r: (r["choices"]["text"], r["choices"]["label"].index(r["answerKey"])),
    ),
    "HellaSwag": (
        "Rowan/hellaswag", "default", "validation",
        lambda r: {"activity": r["activity_label"], "context": r["ctx"]},
        "Which ending is the most likely continuation?",
        lambda r: (r["endings"], int(r["label"])),
    ),
    "TruthfulQA": (
        "truthfulqa/truthful_qa", "multiple_choice", "validation",
        lambda r: {"question": r["question"]},
        "Which answer is true?",
        lambda r: (r["mc1_targets"]["choices"], r["mc1_targets"]["labels"].index(1)),
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
    "MMLU": "Exam question from 57 subjects, four choices",
    "MMLU-Pro": "Harder exam question, ten choices",
    "ARC-Challenge": "Grade-school science question that simple methods get wrong",
    "HellaSwag": "Which ending continues the scene most plausibly?",
    "TruthfulQA": "Which answer is true, where a common misconception is also offered?",
}
OPTIONS = {
    "MMLU": 4,
    "MMLU-Pro": 10,
    "ARC-Challenge": 5,
    "HellaSwag": 4,
    "TruthfulQA": 13,
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


class Exhausted(Exception):
    pass


def deal(name, n, fresh):
    """The next unseen row index; a fresh deck on request, never a silent reshuffle."""
    if fresh or name not in DECKS:
        DECKS[name] = random.sample(range(n), n)
    if not DECKS[name]:
        raise Exhausted(f"all {n} items of {name} are done")
    return DECKS[name].pop()


def download(name, hub, config, split):
    """300 rows of a set (three random pages), fetched once into DATA."""
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
        return json.load(f)


def sample(name, fresh=False):
    """One random labelled item as a request, plus its truth. The first call per dataset
    downloads 300 rows (three random pages) into DATA; later calls deal from them."""
    if name == "TypeSafe cases":  # several questions per document, each with its consensus label
        import eval  # only this dataset needs it

        cases = eval.typesafe_rows()
        case, node, doc, qs, truth = cases[deal(name, len(cases), fresh)]
        truth = {k: {"true": "yes", "false": "no"}.get(v, v) for k, v in truth.items()}
        src = "TypeSafe · " + case
        pool = len(cases)
        left = len(DECKS[name])
        return {
            "state": doc,
            "questions": qs,
            "truth": truth,
            "source": src,
            "options": None,
            "pool": pool,
            "left": left,
        }
    if name in MC:
        hub, config, split, state_of, question, options_of = MC[name]
        rows = download(name, hub, config, split)["rows"]
        r = rows[deal(name, len(rows), fresh)]
        options, answer = options_of(r["row"])
        q = {"type": "choice", "instructions": question, "criteria": dict.fromkeys(options)}
        return {
            "state": state_of(r["row"]),
            "questions": {"answer": q},
            "truth": {"answer": options[answer]},
            "source": f"{hub} · {split} row {r['row_idx']}",
            "options": len(options),
            "pool": len(rows),
            "left": len(DECKS[name]),
        }
    hub, config, split, fields, question, label, yes = DATASETS[name]
    page = download(name, hub, config, split)
    names = next(x["type"].get("names") for x in page["features"] if x["name"] == label)
    rows = [r for r in page["rows"] if r["row"][label] != -1]  # SNLI marks unlabelled pairs -1
    r = rows[deal(name, len(rows), fresh)]
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
        "left": len(DECKS[name]),
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


def text_answers(text, questions):
    """A written JSON reply in the shape of a probability reply, each answer counted as certain."""
    try:
        got = json.loads(text.replace("```json", "").replace("```", "").strip())
    except ValueError:
        return {}
    out = {}
    for qid, q in questions.items():
        if not isinstance(got, dict) or qid not in got:
            continue
        v = str(got[qid]).strip().lower()
        first = (v.replace(",", " ").split() or [""])[0]
        if q["type"] == "noul":
            out[qid] = {"type": "noul", "noul": 1.0 if first in ("yes", "true") else 0.0}
        elif q["type"] == "choice":
            hit = next((la for la in _options(q)[0] if v == la.lower() or v.startswith(la.lower())), None)
            if hit is not None:
                out[qid] = {"type": "choice", "choice": hit, "probabilities": {hit: 1.0}}
        else:
            try:
                out[qid] = {"type": "score", "score": float(first)}
            except ValueError:
                pass
    return out


def log_row(body, backend, answers, ms):
    """One answer of a run, appended to its session's file."""
    name = "".join(c if c.isalnum() or c in "._-" else "-" for c in body["log"])[:120]
    os.makedirs(LOGS, exist_ok=True)
    row = {k: body.get(k) for k in ("dataset", "source", "state", "questions", "truth", "mode", "sides")}
    row |= {"backend": backend, "answers": answers, "ms": ms}
    with LOCK, open(os.path.join(LOGS, name + ".jsonl"), "a") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def answer(a):
    """The answer a probability reply amounts to, in the label set's words."""
    if a["type"] == "noul":
        return "yes" if a["noul"] >= 0.5 else "no"
    return a["choice"] if a["type"] == "choice" else str(round(a["score"]))


def right(a, truth):
    norm = {"true": "yes", "false": "no"}
    return answer(a).lower().strip() == norm.get(str(truth).lower(), str(truth).lower().strip())


def runs():
    """The saved batches, newest first: set, the two backends, items and each side's score."""
    out = []
    if os.path.isdir(LOGS):
        for f in sorted(os.listdir(LOGS), reverse=True):
            if not f.endswith(".jsonl"):
                continue
            with open(os.path.join(LOGS, f)) as fh:
                lines = [json.loads(x) for x in fh if x.strip()]
            sides = sorted(
                dict.fromkeys(x["backend"] for x in lines), key=lambda b: not b.endswith("#text")
            )  # written side first
            order = next((x["sides"] for x in lines if x.get("sides")), None)
            if order and lines[0].get("mode") != "gen":  # compare: the order the models were picked in
                sides.sort(key=lambda b: order.index(b) if b in order else len(order))
            items = len({(x["source"], json.dumps(x["state"], sort_keys=True)) for x in lines})
            score = {b: [0, 0] for b in sides}
            for x in lines:
                for qid, t in x["truth"].items():
                    score[x["backend"]][1] += 1
                    score[x["backend"]][0] += qid in x["answers"] and right(x["answers"][qid], t)
            ds, kind = (lines[0]["dataset"], lines[0].get("mode") or "cmp") if lines else ("", "cmp")
            out.append(
                {
                    "name": f[:-6],
                    "dataset": ds,
                    "backends": sides,
                    "items": items,
                    "score": score,
                    "mode": kind,
                }
            )
    return out


def run_rows(name):
    """One saved batch as items, each with both sides' answers, in the order they ran."""
    path = os.path.join(LOGS, os.path.basename(name) + ".jsonl")
    items = {}
    with open(path) as fh:
        for x in map(json.loads, filter(str.strip, fh)):
            key = (x["source"], json.dumps(x["state"], sort_keys=True))
            it = items.setdefault(
                key, {"it": {k: x[k] for k in ("state", "questions", "truth", "source")}, "sides": {}}
            )
            it["sides"][x["backend"]] = {"ms": x["ms"], "res": {"answers": x["answers"]}}
    return list(items.values())


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


TEXTLESS = {"remote:typesafe", "remote:vercel"}  # Jev returns probabilities only; it never writes text


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
            if self.path.endswith("/runs"):
                return self._send(200, json.dumps(runs()).encode())
            if "/run?" in self.path:
                name = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)["name"][0]
                return self._send(200, json.dumps(run_rows(name)).encode())
            if self.path.endswith("/progress"):
                return self._send(200, json.dumps(progress()).encode())
            if self.path.endswith("/datasets"):
                sets = [
                    {"name": n, "options": OPTIONS.get(n, 2), "local": os.path.exists(dataset_path(n))}
                    for n in [*DATASETS, *MC]
                ]
                ts = os.path.isdir(os.path.join(HERE, "results", "typesafe"))
                sets.append({"name": "TypeSafe cases", "options": None, "local": ts})
                for x in sets:
                    x["about"] = ABOUT[x["name"]]
                return self._send(200, json.dumps(sets).encode())
            path = urllib.parse.urlparse(self.path).path
            file = os.path.normpath(os.path.join(WEB, path.lstrip("/")))
            if path != "/" and file.startswith(WEB + os.sep) and os.path.isfile(file):
                with open(file, "rb") as f:
                    return self._send(200, f.read(), mimetypes.guess_type(file)[0] or "application/octet-stream")
            index = os.path.join(WEB, "index.html")
            page = PAGE if path == "/old" or not os.path.exists(index) else index
            with open(page, encoding="utf-8") as f:
                html = f.read().replace("{{model}}", model_id)
            self._send(200, html.encode(), "text/html; charset=utf-8")

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
            try:
                if self.path.endswith("/sample"):
                    with SAMPLE_LOCK:  # batches ask in parallel; one download and one deck per set
                        try:
                            item = sample(body["dataset"], body.get("fresh", False))
                        except Exhausted as e:
                            return self._send(409, json.dumps({"error": {"message": str(e)}}).encode())
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
                    if (body.get("backend") or model_id) in TEXTLESS:
                        raise ValueError("Jev returns probabilities only; it does not write text")
                    make = generate if isinstance(jev, Jev) else generate_remote
                    t = time.time()
                    pieces = make(jev, body["state"], body["questions"])
                    head = next(pieces, "")  # errors surface here, before the stream starts
                    self.send_response(200)
                    self.send_header("content-type", "text/plain; charset=utf-8")
                    self.send_header("transfer-encoding", "chunked")
                    self.end_headers()
                    text = []
                    for piece in [head, *pieces] if head else pieces:
                        text.append(piece)
                        chunk = piece.encode()
                        if not chunk:  # a zero-length chunk would end the stream
                            continue
                        self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                        self.wfile.flush()
                    self.wfile.write(b"0\r\n\r\n")
                    if body.get("log"):  # the written side of generate vs readout
                        answers = text_answers("".join(text), body["questions"])
                        log_row(
                            body,
                            (body.get("backend") or model_id) + "#text",
                            answers,
                            round((time.time() - t) * 1000),
                        )
                    return
                t = time.time()
                res = jev.ask(body["state"], body["questions"])
                res["latency_ms"] = round((time.time() - t) * 1000)
                if body.get("log"):  # every run is kept, with its input and label
                    log_row(body, body.get("backend") or model_id, res["answers"], res["latency_ms"])
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
