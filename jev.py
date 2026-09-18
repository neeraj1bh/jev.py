"""jev.py — TypeSafe's Jev API on any local Hugging Face model, in one file.

Jev answers typed questions (noul = yes/no, choice, score) about a state with
probabilities instead of text. This file does the same with an ordinary chat model:
one forward pass reads the next-token logits at the answer letters and softmaxes over
just those. No generation, no JSON parsing, every answer is guaranteed in-schema.

The shared state is prefilled once and its KV cache is broadcast to every question,
so 20 questions cost about one prompt plus 20 short suffixes.

    python jev.py                      # self-check (CPU is fine, ~3 GB RAM)
    python jev.py serve                # TypeSafe-compatible server on :8080
    python jev.py request.json         # answer one request file

Point any TypeSafe client at http://localhost:8080/v1/systemone.
Request and response shapes follow https://docs.typesafe.ai/api.
"""

import json
import math
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

DEFAULT_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
SYSTEM = (
    "You are a calibrated decision engine. Read the STATE, then answer the "
    "QUESTION by choosing exactly one option. Reply with the option letter only."
)
LETTERS = [chr(c) for c in range(65, 91)]  # A..Z


def _slots(count):
    """Answer labels: A..Z, then AA, AB, ... (TypeSafe allows up to 255 options)."""
    out = list(LETTERS)
    for a in LETTERS:
        out += [a + b for b in LETTERS]
    return out[:count]


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
    def __init__(self, model_id=DEFAULT_MODEL, device=None, dtype=None):
        self.model_id = model_id
        self.device = device or (
            "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
        )
        # bf16 is ~3x faster than fp32 on CPUs with native bf16 (AVX512-BF16); emulated it is slower
        cpu_bf16 = getattr(torch.cpu, "_is_avx512_bf16_supported", lambda: False)()
        dtype = dtype or (torch.bfloat16 if self.device == "cuda" or cpu_bf16 else torch.float32)
        self.tok = AutoTokenizer.from_pretrained(model_id)
        self.model = AutoModelForCausalLM.from_pretrained(model_id, dtype=dtype).to(self.device).eval()
        # every slot label must be exactly one token so one logit row answers the question
        self.slot_id = {}
        for s in _slots(255):
            ids = self.tok.encode(s, add_special_tokens=False)
            if len(ids) == 1:
                self.slot_id[s] = ids[0]
        assert all(letter in self.slot_id for letter in LETTERS), "tokenizer splits single letters"

    def _prompt(self, state, q, labels, descs):
        slots = [s for s in _slots(len(labels)) if s in self.slot_id][: len(labels)]
        if len(slots) < len(labels):
            raise ValueError(f"model tokenizer supports at most {len(slots)} options")
        lines = []
        for s, label, d in zip(slots, labels, descs, strict=True):
            name = label if q["type"] != "score" else f"level {label}"
            lines.append(f"{s}. {name}" + (f" — {_text(d)}" if d else ""))
        user = (
            f"STATE:\n{_text(state)}\n\nQUESTION: {_text(q['instructions'])}\n"
            f"OPTIONS:\n" + "\n".join(lines) + "\nAnswer with the letter only."
        )
        msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
        text = self.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        return self.tok.encode(text, add_special_tokens=False), [self.slot_id[s] for s in slots]

    @torch.no_grad()
    def _last_logits(self, prompts):
        """Last-position logits for each prompt. Shared prefix is prefilled once."""
        n = len(prompts)
        pre = 0
        while all(len(p) > pre and p[pre] == prompts[0][pre] for p in prompts):
            pre += 1
        pre = max(pre - 1, 0)  # keep at least one token in every suffix
        prefix = torch.tensor([prompts[0][:pre]], device=self.device)
        cache = None
        if pre:
            cache = self.model(prefix, use_cache=True).past_key_values
            cache.batch_repeat_interleave(n)
        suffixes = [p[pre:] for p in prompts]
        width = max(map(len, suffixes))
        pad = self.tok.pad_token_id or 0
        ids = torch.full((n, width), pad, device=self.device)
        mask = torch.zeros((n, pre + width), dtype=torch.long, device=self.device)
        mask[:, :pre] = 1
        for i, s in enumerate(suffixes):
            ids[i, : len(s)] = torch.tensor(s, device=self.device)
            mask[i, pre : pre + len(s)] = 1
        out = self.model(ids, attention_mask=mask, past_key_values=cache, use_cache=True).logits
        last = torch.tensor([len(s) - 1 for s in suffixes], device=self.device)
        return out[torch.arange(n), last], pre + sum(map(len, suffixes))

    def ask(self, state, questions):
        """TypeSafe request → TypeSafe response (dict)."""
        ids = list(questions)
        parsed = [_options(questions[i]) for i in ids]
        built = [self._prompt(state, questions[i], *p) for i, p in zip(ids, parsed, strict=True)]
        logits, n_tokens = self._last_logits([b[0] for b in built])
        answers = {}
        for k, (qid, (labels, descs), (_, slot_ids)) in enumerate(zip(ids, parsed, built, strict=True)):
            p = torch.softmax(logits[k, slot_ids].float(), -1).tolist()
            p = [round(x, 4) for x in p]
            q = questions[qid]
            if q["type"] == "noul":
                answers[qid] = {"type": "noul", "noul": p[0]}
            elif q["type"] == "choice":
                answers[qid] = {
                    "type": "choice",
                    "choice": labels[p.index(max(p))],
                    "probabilities": dict(zip(labels, p, strict=True)),
                    "confidence": _confidence(p),
                }
            else:
                answers[qid] = {
                    "type": "score",
                    "score": round(sum(i * x for i, x in enumerate(p)), 4),
                    "probabilities": dict(zip(labels, p, strict=True)),
                    "legend": dict(zip(labels, descs, strict=True)),
                    "confidence": _confidence(p),
                }
        return {
            "model": self.model_id,
            "answers": answers,
            "usage": {"input_tokens": n_tokens, "output_tokens": 0},
        }


def serve(model_id=DEFAULT_MODEL, port=8080):
    jev = Jev(model_id)

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

    print(f"jev.py serving {model_id} on http://localhost:{port}/v1/systemone ({jev.device})")
    ThreadingHTTPServer(("", port), H).serve_forever()


def demo(model_id=DEFAULT_MODEL):
    """Runnable self-check: the shapes are right and the tiny model gets easy cases right."""
    jev = Jev(model_id)
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
        f"{ms:.0f} ms on {jev.device} with {model_id}"
    )


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "serve":
        serve(*(a for a in args[1:2]), **({"port": int(args[2])} if len(args) > 2 else {}))
    elif args and args[0].endswith(".json"):
        req = json.load(open(args[0]))
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
