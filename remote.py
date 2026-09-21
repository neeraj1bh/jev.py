"""The same typed decisions from a hosted model, through its chat API's log-probabilities.

Any OpenAI-compatible endpoint that returns `top_logprobs` works: the options are lettered,
the model is asked for one token, and the probability of each letter is read from the
returned log-probabilities. `typesafe` is passed straight through to the real Jev API.

Keys come from .env (see .env.example) or the environment.

    python remote.py deepseek              # self-check
    python remote.py deepseek serve 8080   # TypeSafe-compatible server backed by DeepSeek
    python eval.py remote:deepseek         # the public eval on a hosted model
"""

import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from jev import LETTERS, _confidence, _options, _text, demo, serve

BACKENDS = {
    "deepseek": ("DEEPSEEK_API_KEY", "https://api.deepseek.com/chat/completions", "deepseek-flash"),
    "moonshot": ("MOONSHOT_API_KEY", "https://api.moonshot.ai/v1/chat/completions", "kimi-k2.6"),
    "openrouter": (
        "OPENROUTER_API_KEY",
        "https://openrouter.ai/api/v1/chat/completions",
        "deepseek/deepseek-chat",
    ),
    "openai": ("OPENAI_API_KEY", "https://api.openai.com/v1/chat/completions", "gpt-4o-mini"),
    "typesafe": ("TYPESAFE_API_KEY", "https://api.typesafe.ai/v1/systemone", "jev-latest"),
    # Jev through Vercel's AI Gateway: same questions, "boolean" for noul, P(true) as "probability"
    "vercel": (
        "AI_GATEWAY_API_KEY",
        "https://ai-gateway.vercel.sh/v4/ai/evaluation-model",
        "typesafe-ai/jev",
    ),
    # llama.cpp's llama-server on this machine or the LAN; no key, LLAMACPP_URL overrides the address
    "llamacpp": ("", "http://localhost:8080/v1/chat/completions", "local"),
}
# thinking must be off (else the first token is reasoning); each provider's accepted temperature
EXTRAS = {
    "deepseek": {"thinking": {"type": "disabled"}, "temperature": 1},
    "moonshot": {"thinking": {"type": "disabled"}, "temperature": 0.6},
}
CONCURRENCY = {"moonshot": 2, "llamacpp": 4}  # llamacpp: match llama-server -np


def env(name):
    if name in os.environ:
        return os.environ[name]
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(path):
        for line in open(path):
            k, _, v = line.partition("=")
            if k.strip() == name and v.split("#")[0].strip():  # skip empty template lines
                return v.split("#")[0].strip()
    return ""


def post(url, key, body, headers=None):
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"authorization": f"Bearer {key}", "content-type": "application/json", **(headers or {})},
    )
    for attempt in range(40):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except (urllib.error.URLError, TimeoutError) as e:
            rate_limited = isinstance(e, urllib.error.HTTPError) and e.code == 429
            if (isinstance(e, urllib.error.HTTPError) and not rate_limited) or attempt == (
                39 if rate_limited else 5
            ):
                raise
            wait = e.headers.get("retry-after", "") if rate_limited else ""
            # slow or rate limited: honour retry-after, else 1, 2, 4 … s, capped at a minute
            time.sleep(float(wait) if wait.replace(".", "", 1).isdigit() else min(60, 2**attempt))


class Remote:
    def __init__(self, backend="deepseek", model=None):
        var, self.url, default = BACKENDS[backend]
        self.backend, self.model_id, self.key = backend, model or default, env(var) if var else "none"
        self.url = env("LLAMACPP_URL") or self.url if backend == "llamacpp" else self.url
        self.device = backend
        if not self.key:
            raise SystemExit(f"{var} is not set: copy .env.example to .env and fill it in")

    def ask(self, state, questions):
        if self.backend == "typesafe":
            return post(self.url, self.key, {"model": self.model_id, "state": state, "questions": questions})
        if self.backend == "vercel":
            return self._vercel(state, questions)
        with ThreadPoolExecutor(CONCURRENCY.get(self.backend, 8)) as pool:
            probs = list(pool.map(lambda q: self._one(state, q), questions.values()))
        answers, tokens = {}, 0
        for qid, (labels, descs), (p, used) in zip(
            questions, map(_options, questions.values()), probs, strict=True
        ):
            tokens += used
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
            "usage": {"input_tokens": tokens, "output_tokens": 0},
        }

    def _vercel(self, state, questions):
        qs = {k: {**q, "type": "boolean"} if q["type"] == "noul" else q for k, q in questions.items()}
        headers = {
            "ai-model-id": self.model_id,
            "ai-evaluation-model-specification-version": "4",
            "ai-gateway-protocol-version": "0.0.1",
        }
        res = post(self.url, self.key, {"state": state, "questions": qs}, headers)
        answers = {}
        for qid, a in res["answers"].items():
            if a["type"] == "boolean":
                answers[qid] = {"type": "noul", "noul": a["probability"]}
            else:
                p = a.get("probabilities") or {}
                answers[qid] = {**a, "confidence": _confidence(list(p.values())) if p else None}
        return {"model": self.model_id, "answers": answers, "usage": res.get("usage", {})}

    def _one(self, state, q):
        labels, descs = _options(q)
        if len(labels) > len(LETTERS):
            raise ValueError(f"hosted backends take at most {len(LETTERS)} options, got {len(labels)}")
        lines = []
        for letter, la, d in zip(LETTERS, labels, descs, strict=False):
            name = f"level {la}" if q["type"] == "score" else la
            lines.append(f"{letter}. {name}" + (f" — {_text(d)}" if d else ""))
        user = (
            f"STATE:\n{_text(state)}\n\nQUESTION: {_text(q['instructions'])}\nOPTIONS:\n"
            + "\n".join(lines)
            + "\nAnswer with the letter only."
        )
        res = post(
            self.url,
            self.key,
            {
                "model": self.model_id,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a calibrated decision engine. Reply with one letter.",
                    },
                    {"role": "user", "content": user},
                ],
                "max_tokens": 1,
                "logprobs": True,
                "top_logprobs": 20,
                **EXTRAS.get(self.backend, {"temperature": 0}),
            },
        )
        top = res["choices"][0]["logprobs"]["content"][0]["top_logprobs"]
        seen = {}
        for t in top:  # "A", " A" and "a" all mean A; keep the most likely spelling
            key = t["token"].strip().upper()
            seen[key] = max(seen.get(key, -1e9), t["logprob"])
        lp = [seen.get(letter, -30.0) for letter in LETTERS[: len(labels)]]
        z = max(lp)
        w = [math.exp(x - z) for x in lp]
        return [round(x / sum(w), 4) for x in w], res.get("usage", {}).get("prompt_tokens", 0)


if __name__ == "__main__":
    a = sys.argv[1:]
    backend = a[0] if a and a[0] in BACKENDS else "deepseek"
    rest = a[1:] if a and a[0] in BACKENDS else a
    if rest and rest[0] == "serve":
        serve(jev=Remote(backend), **({"port": int(rest[1])} if len(rest) > 1 else {}))
    else:
        demo(jev=Remote(backend))
