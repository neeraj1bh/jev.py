"""jev.py — TypeSafe's Jev API on any local Hugging Face model, in one file.

Jev answers typed questions (noul = yes/no, choice, score) about a state with
probabilities instead of text. This file does the same with an ordinary chat model:
each option is scored by the probability the model gives its own words as the answer,
and the scores are softmaxed against each other. Nothing is generated, nothing is
parsed, and every answer is one of the options given.

The state is prefilled once and its KV cache is shared by every option of every
question, so twenty questions cost one prompt plus short tails.

    uv run jev                         # self-check (CPU is fine, ~3 GB RAM)
    uv run jev serve                   # TypeSafe-compatible server on :8080
    uv run jev request.json            # answer one request file

Point any TypeSafe client at http://localhost:8080/v1/systemone.
Request and response shapes follow https://docs.typesafe.ai/api.
"""

import copy
import json
import math
import os
import shutil
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

# The repo: results/, models/, data/, web/ and .env live there.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DEFAULT_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
CACHE_BUDGET = 16_384  # prefix tokens × option tails held at once; keeps long states under ~1 GB

SYSTEM = (
    "You are a calibrated decision engine. "
    "Read the STATE and answer the QUESTION with exactly one of the OPTIONS."
)
LETTERS = [chr(c) for c in range(65, 91)]


def _confidence(p):
    """1 - normalized entropy: 1.0 for a single peak, 0.0 for a flat spread."""
    n = len(p)
    if n < 2:
        return 1.0
    h = -sum(x * math.log(x) for x in p if x > 0)
    return round(1 - h / math.log(n), 4)


def _text(x):
    return x if isinstance(x, str) else json.dumps(x, ensure_ascii=False, indent=1)


def _options(q):
    """(labels, descriptions) for one question, in order."""
    t, c = q["type"], q.get("criteria")
    if t == "noul":
        c = c or {}
        return ["yes", "no"], [c.get("true"), c.get("false")]
    if t == "choice":
        return list(c.keys()), list(c.values())
    if t == "score":
        return [str(i) for i in range(len(c))], list(c)
    raise ValueError(f"unknown question type {t!r}")


class Jev:
    def __init__(self, model_id=DEFAULT_MODEL, device=None, dtype=None, readout="text", cache_dir=None):
        """readout="letter" labels the options A, B, C… and scores the letter instead of the words.
        cache_dir: where the weights are, or are downloaded to (default: the Hugging Face cache)."""
        self.model_id, self.readout = model_id, readout
        self.device = device or (
            "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        )
        # bf16 is ~3x faster than fp32 on CPUs with native bf16 (AVX512-BF16); emulated it is slower
        cpu_bf16 = getattr(torch.cpu, "_is_avx512_bf16_supported", lambda: False)()
        dtype = dtype or (torch.bfloat16 if self.device == "cuda" or cpu_bf16 else torch.float32)
        self.tok = AutoTokenizer.from_pretrained(model_id, cache_dir=cache_dir)
        self.model = (
            AutoModelForCausalLM.from_pretrained(model_id, dtype=dtype, cache_dir=cache_dir)
            .to(self.device)
            .eval()
        )
        # one letter must be one token, or the letter readout would compare different lengths
        bad = [c for c in LETTERS if len(self.tok.encode(c, add_special_tokens=False)) != 1]
        assert readout != "letter" or not bad, f"{bad} are several tokens each in {model_id}"

    def _prompt(self, state, q, labels, descs):
        """Token ids of the prompt, and of each option's answer text."""
        names = [f"level {la}" if q["type"] == "score" else la for la in labels]
        letter = self.readout == "letter"
        if letter and len(names) > len(LETTERS):
            raise ValueError(f"the letter readout takes at most {len(LETTERS)} options, got {len(names)}")
        shown = [f"{a} = {n}" for a, n in zip(LETTERS, names, strict=False)] if letter else names
        lines = [n + (f" — {_text(d)}" if d else "") for n, d in zip(shown, descs, strict=True)]
        user = (
            f"STATE:\n{_text(state)}\n\nQUESTION: {_text(q['instructions'])}\nOPTIONS:\n- "
            + "\n- ".join(lines)
            + ("\nAnswer with the letter of one option." if letter else "\nAnswer with one of the options.")
        )
        names = LETTERS[: len(names)] if letter else names
        msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
        text = self.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        prompt = self.tok.encode(text, add_special_tokens=False)
        return prompt, [self.tok.encode(n, add_special_tokens=False) for n in names]

    @torch.no_grad()
    def _score(self, seqs):
        """Mean log-probability of the last `k` tokens of each sequence, given the rest.
        The prefix all sequences share is run once and its cache reused."""
        n = len(seqs)
        pre = 0
        cap = min(len(s) - k - 1 for s, k in seqs)  # every tail keeps its answer and one token before it
        while pre < cap and all(s[pre] == seqs[0][0][pre] for s, _ in seqs):
            pre += 1
        prefix = None
        if pre:
            prefix = self.model.model(
                torch.tensor([seqs[0][0][:pre]], device=self.device), use_cache=True
            ).past_key_values
        tails = [s[pre:] for s, _ in seqs]
        pad = self.tok.pad_token_id or 0
        # the shared cache is copied once per tail; keep the copies within a token budget
        step = max(1, CACHE_BUDGET // max(pre, 1))
        hidden = []
        for j in range(0, n, step):
            chunk = tails[j : j + step]
            width = max(map(len, chunk))
            ids = torch.full((len(chunk), width), pad, device=self.device)
            mask = torch.zeros((len(chunk), pre + width), dtype=torch.long, device=self.device)
            mask[:, :pre] = 1
            for i, t in enumerate(chunk):
                ids[i, : len(t)] = torch.tensor(t, device=self.device)
                mask[i, pre : pre + len(t)] = 1
            cache = None
            if prefix is not None:
                cache = copy.deepcopy(prefix)
                cache.batch_repeat_interleave(len(chunk))
            out = self.model.model(ids, attention_mask=mask, past_key_values=cache, use_cache=True)
            hidden.extend(out.last_hidden_state)
        scores = []
        for i, (t, k) in enumerate(zip(tails, [k for _, k in seqs], strict=True)):
            pos = torch.arange(len(t) - k - 1, len(t) - 1, device=self.device)
            logp = torch.log_softmax(self.model.lm_head(hidden[i][pos]).float(), -1)
            tok = torch.tensor(t[len(t) - k :], device=self.device)
            scores.append(logp[torch.arange(k), tok].mean().item())
        return scores, pre + sum(map(len, tails))

    def ask(self, state, questions):
        """TypeSafe request → TypeSafe response (dict)."""
        ids = list(questions)
        parsed = [_options(questions[i]) for i in ids]
        seqs, spans = [], []
        for qid, (labels, descs) in zip(ids, parsed, strict=True):
            prompt, cands = self._prompt(state, questions[qid], labels, descs)
            spans.append((len(seqs), len(seqs) + len(cands)))
            seqs += [(prompt + c, len(c)) for c in cands]
        scores, n_tokens = self._score(seqs)
        answers = {}
        for qid, (labels, descs), (a, b) in zip(ids, parsed, spans, strict=True):
            p = torch.softmax(torch.tensor(scores[a:b]), -1).tolist()
            raw = {"raw": scores[a:b]}  # each option's own log-probability, before normalising
            q = questions[qid]
            if q["type"] == "noul":
                answers[qid] = {"type": "noul", "noul": p[0]} | raw
            elif q["type"] == "choice":
                answers[qid] = {
                    "type": "choice",
                    "choice": labels[p.index(max(p))],
                    "probabilities": dict(zip(labels, p, strict=True)),
                    "confidence": _confidence(p),
                } | raw
            else:
                answers[qid] = {
                    "type": "score",
                    "score": sum(i * x for i, x in enumerate(p)),
                    "probabilities": dict(zip(labels, p, strict=True)),
                    "legend": dict(zip(labels, descs, strict=True)),
                    "confidence": _confidence(p),
                } | raw
        return {
            "model": self.model_id,
            "answers": answers,
            "usage": {"input_tokens": n_tokens, "output_tokens": 0},
        }


def serve(model_id=DEFAULT_MODEL, port=8080, jev=None):
    jev = jev or Jev(model_id)

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
            try:
                t = time.time()
                res = jev.ask(body["state"], body["questions"])
                res["latency_ms"] = round((time.time() - t) * 1000)
                code = 200
            except Exception as e:  # keep the server up; report the error like the real API
                res, code = {"error": {"message": str(e)}}, 400
            data = json.dumps(res).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, fmt, *a):
            sys.stderr.write(f"{self.command} {self.path} {a[1] if len(a) > 1 else ''}\n")

    print(f"jev.py serving {jev.model_id} on http://localhost:{port}/v1/systemone ({jev.device})")
    server = ThreadingHTTPServer((os.environ.get("JEV_HOST", "127.0.0.1"), port), H)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()


def demo(model_id=DEFAULT_MODEL, jev=None):
    """Runnable self-check: the shapes are right and the tiny model gets easy cases right."""
    jev = jev or Jev(model_id)
    state = {
        "ticket": "I was charged twice for order #4411 and I want my money back. "
        "This is the third time I've written, I'm done with you people.",
        "customer_since": "2019",
    }
    questions = {
        "refund_requested": {"type": "noul", "instructions": "Is the customer asking for a refund?"},
        "is_spam": {"type": "noul", "instructions": "Is this message spam or an advertisement?"},
        "department": {
            "type": "choice",
            "instructions": "Which team should handle this ticket?",
            "criteria": {
                "billing": "charges, refunds, invoices",
                "shipping": "delivery, tracking, lost parcels",
                "returns": "returning or exchanging an item",
                "other": None,
            },
        },
        "frustration": {
            "type": "score",
            "instructions": "How frustrated is the customer?",
            "criteria": ["calm and polite", "annoyed but civil", "angry, threatening to leave"],
        },
    }
    t = time.time()
    res = jev.ask(state, questions)
    ms = (time.time() - t) * 1000
    print(json.dumps(res, indent=1))
    a = res["answers"]
    assert a["refund_requested"]["noul"] > 0.5, "should detect the refund request"
    assert a["is_spam"]["noul"] < 0.5, "a complaint is not spam"
    assert a["department"]["choice"] == "billing", "double charge is billing"
    assert abs(sum(a["department"]["probabilities"].values()) - 1) < 1e-3
    assert a["frustration"]["score"] > 1.0, "'I'm done with you people' is not calm"
    assert set(a["frustration"]["probabilities"]) == {"0", "1", "2"}
    print(
        f"\nOK  {len(questions)} questions, {res['usage']['input_tokens']} input tokens, "
        f"{ms:.0f} ms on {jev.device} with {jev.model_id}"
    )


def gpu_hint():
    """How to use an NVIDIA GPU that the installed CPU build of PyTorch cannot reach, else ""."""
    if torch.cuda.is_available() or not shutil.which("nvidia-smi"):
        return ""
    return (
        "An NVIDIA GPU is here, but PyTorch is the CPU build. To use the GPU, run once\n"
        "  uv pip install --reinstall torch --torch-backend cu128\n"
        "then start commands with uv run --no-sync (plain uv run puts the CPU build back)."
    )


def cli():
    args = sys.argv[1:]
    if hint := gpu_hint():
        print(hint)
    if args and args[0] == "serve":
        serve(*(a for a in args[1:2]), **({"port": int(args[2])} if len(args) > 2 else {}))
    elif args and args[0].endswith(".json"):
        with open(args[0]) as f:
            req = json.load(f)
        print(
            json.dumps(
                Jev(req.get("model") if req.get("model", "").count("/") else DEFAULT_MODEL).ask(
                    req["state"], req["questions"]
                ),
                indent=1,
            )
        )
    else:
        demo(*args[:1])


if __name__ == "__main__":
    cli()
