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
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from jev import _confidence, _options, _text, demo, serve

BACKENDS = {
    "deepseek": ("DEEPSEEK_API_KEY", "https://api.deepseek.com/chat/completions", "deepseek-chat"),
    "moonshot": ("MOONSHOT_API_KEY", "https://api.moonshot.ai/v1/chat/completions", "kimi-latest"),
    "openrouter": (
        "OPENROUTER_API_KEY",
        "https://openrouter.ai/api/v1/chat/completions",
        "deepseek/deepseek-chat",
    ),
    "openai": ("OPENAI_API_KEY", "https://api.openai.com/v1/chat/completions", "gpt-4o-mini"),
    "typesafe": ("TYPESAFE_API_KEY", "https://api.typesafe.ai/v1/systemone", "jev-latest"),
}
LETTERS = [chr(c) for c in range(65, 91)]


def env(name):
    if name in os.environ:
        return os.environ[name]
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(path):
        for line in open(path):
            k, _, v = line.partition("=")
            if k.strip() == name:
                return v.split("#")[0].strip()
    return ""


def post(url, key, body):
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"authorization": f"Bearer {key}", "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


class Remote:
    def __init__(self, backend="deepseek", model=None):
        var, self.url, default = BACKENDS[backend]
        self.backend, self.model_id, self.key = backend, model or default, env(var)
        self.device = backend
        if not self.key:
            raise SystemExit(f"{var} is not set: copy .env.example to .env and fill it in")

    def ask(self, state, questions):
        if self.backend == "typesafe":
            return post(self.url, self.key, {"model": self.model_id, "state": state, "questions": questions})
        with ThreadPoolExecutor(8) as pool:
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

    def _one(self, state, q):
        labels, descs = _options(q)
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
                "temperature": 0,
                "logprobs": True,
                "top_logprobs": 20,
            },
        )
        top = res["choices"][0]["logprobs"]["content"][0]["top_logprobs"]
        seen = {t["token"].strip().upper(): t["logprob"] for t in top}
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
