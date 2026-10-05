"""The same typed decisions from a hosted model, through its chat API's log-probabilities.

Any OpenAI-compatible endpoint that returns `top_logprobs` works: the options are lettered,
the model is asked for one token, and the probability of each letter is read from the
returned log-probabilities. `typesafe` is passed straight through to the real Jev API, and
`laya` to a laya-serve on this machine, which answers in the same shape.

Keys come from .env (see .env.example) or the environment.

    uv run jev-remote deepseek             # self-check
    uv run jev-remote deepseek serve 8080  # TypeSafe-compatible server backed by DeepSeek
    uv run jev-eval remote:deepseek        # the public eval on a hosted model
"""

import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from jev.core import LETTERS, ROOT, _confidence, _options, _text, demo, serve


class NoProbabilities(ValueError):
    """The provider answered but left out the log-probabilities a readout needs."""


BACKENDS = {
    "deepseek": ("DEEPSEEK_API_KEY", "https://api.deepseek.com/chat/completions", "deepseek-flash"),
    "moonshot": ("MOONSHOT_API_KEY", "https://api.moonshot.ai/v1/chat/completions", "kimi-k2.6"),
    "openrouter": (
        "OPENROUTER_API_KEY",
        "https://openrouter.ai/api/v1/chat/completions",
        "openai/gpt-4o-mini",  # routes to a provider that returns log-probabilities
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
    "llamacpp": ("", "http://localhost:8081/v1/chat/completions", "local"),
    # Laya's laya-serve at its own default port: an encoder that scores every option in one pass
    # and answers in TypeSafe's shape; no key, LAYA_URL overrides the address. "laya" is its
    # English checkpoint; remote:laya:typed-decisions or :multilingual pins another.
    "laya": ("", "http://localhost:8000/v1/systemone", "laya"),
}
ADDRESS = {"llamacpp": "LLAMACPP_URL", "laya": "LAYA_URL"}  # servers found by address, not by key
TYPED = ("typesafe", "laya")  # speak TypeSafe's own request and answer shapes: nothing to read by letter
PROBABILITIES_ONLY = (*TYPED, "vercel")  # never write text
LETTER_SYSTEM = "You are a calibrated decision engine. Reply with one letter."
TOP_LOGPROBS = 20  # alternatives asked for with the answer token
PROMPT_VERSION = "letter-1"  # bump whenever LETTER_SYSTEM or letter_prompt changes; fingerprints hash it
# thinking must be off (else the first token is reasoning); each provider's accepted temperature
EXTRAS = {
    "deepseek": {"thinking": {"type": "disabled"}, "temperature": 1},
    "moonshot": {"thinking": {"type": "disabled"}, "temperature": 0.6},
    # route only to providers that return top_logprobs; others would silently drop them
    "openrouter": {"temperature": 0, "provider": {"require_parameters": True}},
}
CONCURRENCY = {"moonshot": 2, "llamacpp": 4}  # llamacpp: match llama-server -np


def env(name):
    if name in os.environ:
        return os.environ[name]
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                k, _, v = line.partition("=")
                if k.strip() == name and v.split("#")[0].strip():  # skip empty template lines
                    return v.split("#")[0].strip()
    return ""


def post(url, key, body, headers=None, patient=True):
    """A request that waits out slow replies and rate limits; patient=False gives up on the first."""
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"authorization": f"Bearer {key}", "content-type": "application/json", **(headers or {})},
    )
    for attempt in range(40):
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError) as e:
            rate_limited = isinstance(e, urllib.error.HTTPError) and e.code == 429
            last = 39 if rate_limited else 5
            if not patient or (isinstance(e, urllib.error.HTTPError) and not rate_limited) or attempt == last:
                raise
            wait = e.headers.get("retry-after", "") if rate_limited else ""
            # slow or rate limited: honour retry-after, else 1, 2, 4 … s, capped at a minute
            time.sleep(float(wait) if wait.replace(".", "", 1).isdigit() else min(60, 2**attempt))


class Remote:
    def __init__(self, backend="deepseek", model=None, patient=True):
        var, self.url, default = BACKENDS[backend]
        self.patient = patient
        self.backend, self.model_id, self.key = backend, model or default, env(var) if var else "none"
        self.url = (backend in ADDRESS and env(ADDRESS[backend])) or self.url
        self.device = backend
        if not self.key:
            raise SystemExit(f"{var} is not set: copy .env.example to .env and fill it in")

    def ask(self, state, questions):
        if self.backend in TYPED:
            body = {"model": self.model_id, "state": state, "questions": questions}
            return post(self.url, self.key, body, patient=self.patient)
        if self.backend == "vercel":
            return self._vercel(state, questions)
        with ThreadPoolExecutor(CONCURRENCY.get(self.backend, 8)) as pool:
            probs = list(pool.map(lambda question: self._one(state, question), questions.values()))
        answers, invalid, usage = {}, {}, {}
        for qid, (labels, descs), (probabilities, coverage, top, used) in zip(
            questions, map(_options, questions.values()), probs, strict=True
        ):
            usage[qid] = used
            if probabilities is None:  # no option letter among the top tokens: no answer, scored as wrong
                invalid[qid] = coverage | {"raw": top}
                continue
            question = questions[qid]
            read = {"coverage": coverage, "raw": top}
            if question["type"] == "noul":
                answers[qid] = {"type": "noul", "noul": probabilities[0]} | read
            elif question["type"] == "choice":
                answers[qid] = {
                    "type": "choice",
                    "choice": labels[probabilities.index(max(probabilities))],
                    "probabilities": dict(zip(labels, probabilities, strict=True)),
                    "confidence": _confidence(probabilities),
                } | read
            else:
                answers[qid] = {
                    "type": "score",
                    "score": sum(i * x for i, x in enumerate(probabilities)),
                    "probabilities": dict(zip(labels, probabilities, strict=True)),
                    "legend": dict(zip(labels, descs, strict=True)),
                    "confidence": _confidence(probabilities),
                } | read
        return {
            "model": self.model_id,
            "answers": answers,
            "invalid": invalid,
            "usage": {
                "input_tokens": total(usage.values(), "prompt_tokens"),
                "output_tokens": total(usage.values(), "completion_tokens"),
                "cost": total(usage.values(), "cost"),  # dollars billed, where the provider says (OpenRouter)
                "per_question": usage,  # as each provider reported it, cached tokens included
            },
        }

    def _vercel(self, state, questions):
        vercel_questions = {
            k: {**q, "type": "boolean"} if q["type"] == "noul" else q for k, q in questions.items()
        }
        headers = {
            "ai-model-id": self.model_id,
            "ai-evaluation-model-specification-version": "4",
            "ai-gateway-protocol-version": "0.0.1",
        }
        res = post(
            self.url, self.key, {"state": state, "questions": vercel_questions}, headers, patient=self.patient
        )
        answers = {}
        for qid, answer in res["answers"].items():
            if answer["type"] == "boolean":
                answers[qid] = {"type": "noul", "noul": answer["probability"]}
            else:
                probabilities = answer.get("probabilities") or {}
                answers[qid] = {
                    **answer,
                    "confidence": _confidence(list(probabilities.values())) if probabilities else None,
                }
        return {"model": self.model_id, "answers": answers, "usage": res.get("usage", {})}

    def _one(self, state, question):
        labels, user = letter_prompt(state, question)
        res = post(
            self.url,
            self.key,
            {
                "model": self.model_id,
                "messages": [
                    {"role": "system", "content": LETTER_SYSTEM},
                    {"role": "user", "content": user},
                ],
                "max_tokens": 1,
                "logprobs": True,
                "top_logprobs": TOP_LOGPROBS,
                **EXTRAS.get(self.backend, {"temperature": 0}),
            },
            patient=self.patient,
        )
        content = (res["choices"][0].get("logprobs") or {}).get("content")
        if not content:  # some providers accept the parameter and send nothing back
            raise NoProbabilities(f"{self.model_id} returned no probabilities")
        top = content[0]["top_logprobs"]
        probs, coverage = letter_probs(top, len(labels))
        raw = [[t["token"], t["logprob"]] for t in top]
        return probs, coverage, raw, res.get("usage")


def total(usages, field):
    """One usage field summed over the questions, or None when a provider left it out: unknown,
    not zero."""
    values = [(u or {}).get(field) for u in usages]
    return None if None in values else sum(values)


def letter_probs(top, option_count):
    """Option probabilities from one token's top log-probabilities: each letter's spellings
    ("A", " A", "a") added together. Returns (probs or None, coverage)."""
    mass = {}
    for token in top:
        key = token["token"].strip().upper()
        if key in LETTERS[:option_count]:
            mass[key] = mass.get(key, 0.0) + math.exp(token["logprob"])
    observed = sum(mass.values())
    missing = [letter for letter in LETTERS[:option_count] if letter not in mass]
    status = "none" if not mass else "partial" if missing else "complete"
    probs = (
        None if status == "none" else [mass.get(letter, 0.0) / observed for letter in LETTERS[:option_count]]
    )
    return probs, {"status": status, "observed": observed, "missing": missing}


def letter_prompt(state, question):
    """The option labels and the user message for one question, its options lettered A, B, C…"""
    labels, descs = _options(question)
    if len(labels) > len(LETTERS):
        raise ValueError(f"hosted backends take at most {len(LETTERS)} options, got {len(labels)}")
    lines = []
    for letter, label, description in zip(LETTERS, labels, descs, strict=False):
        name = f"level {label}" if question["type"] == "score" else label
        lines.append(f"{letter}. {name}" + (f" — {_text(description)}" if description else ""))
    user = (
        f"STATE:\n{_text(state)}\n\nQUESTION: {_text(question['instructions'])}\nOPTIONS:\n"
        + "\n".join(lines)
        + "\nAnswer with the letter only."
    )
    return labels, user


def cli():
    args = sys.argv[1:]
    backend = args[0] if args and args[0] in BACKENDS else "deepseek"
    rest = args[1:] if args and args[0] in BACKENDS else args
    if rest and rest[0] == "serve":
        serve(jev=Remote(backend), **({"port": int(rest[1])} if len(rest) > 1 else {}))
    else:
        demo(jev=Remote(backend))


if __name__ == "__main__":
    cli()
