# jev.py

Typed decisions from any local language model, in one file.

Ask a yes/no, pick-one or rate-on-a-scale question about some text and get a probability
back instead of prose. No GPU needed, no API key, no text generation. About 200 lines.

```console
$ uv run jev.py
{
  "refund_requested": { "type": "noul",   "noul": 1.0 },
  "is_spam":          { "type": "noul",   "noul": 0.0 },
  "department":       { "type": "choice", "choice": "billing", "confidence": 1.0,
                        "probabilities": { "billing": 1.0, "shipping": 0.0, "returns": 0.0, "other": 0.0 } },
  "frustration":      { "type": "score",  "score": 2.0, "confidence": 0.99,
                        "probabilities": { "0": 0.0, "1": 0.0, "2": 1.0 } }
}
OK  4 questions, 257 input tokens, 1833 ms on cpu with Qwen/Qwen2.5-1.5B-Instruct
```

One support ticket, four questions, one forward pass, a laptop CPU.

## Why

Most decisions software asks a model for are small: is this spam, which queue, how urgent.
Asking a chat model to *write* the answer means waiting for tokens, parsing text, and handling
the day it replies with a paragraph. A model asked *"A, B or C?"* has already decided by its
first token. `jev.py` reads that decision straight off the logits, so the answer is always one
of your options, comes with a probability, and costs one pass.

## Run

```sh
uv run jev.py                                   # self-check; downloads Qwen2.5-1.5B (3 GB) once
uv run jev.py serve                             # HTTP on http://localhost:8080/v1/systemone
uv run jev.py serve Qwen/Qwen2.5-7B-Instruct    # any chat model on the Hub
uv run jev.py request.json                      # one request from a file
uv run demo.py                                  # side-by-side comparison page, see Demo
```

Without uv: `pip install torch transformers`, then `python` instead of `uv run`. Uses CUDA,
Apple MPS or CPU, whichever is there; on CPUs with native bf16 it uses that.

The HTTP request and response follow the
[TypeSafe System One API](https://docs.typesafe.ai/api), so a client written for it only
needs a base URL change.

## Ask

```json
{ "state": { "ticket": "I was charged twice for order #4411 and I want my money back." },
  "questions": {
    "refund":     { "type": "noul",   "instructions": "Is the customer asking for a refund?" },
    "department": { "type": "choice", "instructions": "Which team should handle this?",
                    "criteria": { "billing": "charges, refunds, invoices",
                                  "shipping": "delivery, tracking, lost parcels",
                                  "other": null } },
    "anger":      { "type": "score",  "instructions": "How frustrated is the customer?",
                    "criteria": ["calm", "annoyed but civil", "angry"] } } }
```

| type | you give | you get |
|---|---|---|
| `noul` | a yes/no question | `noul`, probability of yes |
| `choice` | up to 255 named options, descriptions optional | `choice`, `probabilities`, `confidence` |
| `score` | 2–10 ordered level descriptions | `score` on the level line, `probabilities`, `legend`, `confidence` |

State is any text or JSON. All questions in a request see the same state and are answered in
the same pass, so ask everything at once. `confidence` is 1 − normalized entropy.

**Put the content in `state`, the judgment in the question.** Small models read the state
block carefully and under-weight text tucked inside the question: the same titles scored at
chance when placed after "QUESTION:" and 7 of 8 when placed in the state. One piece of content
per call, as many questions about it as you like.

```python
from jev import Jev
Jev().ask(state, questions)["answers"]["refund"]["noul"]   # 1.0
```

## How

```
state ──prefill once──▶ KV cache ──copy──▶ [q1 tail] ─▶ logits[A B]     ─▶ noul   1.0
                                        ▶ [q2 tail] ─▶ logits[A B C D] ─▶ choice billing
                                        ▶ [q3 tail] ─▶ logits[A B C]   ─▶ score  2.0
```

The state is run through the model once. Its key/value cache is copied to every question,
each of which adds only its own short tail. At the last position, the logits for the option
letters are softmaxed against each other. Nothing is generated.

## Verify

`uv run eval.py` scores the model on public data with public labels. The model only sees the
text; the truth comes from the item itself:

| task | type | what the model sees | truth |
|---|---|---|---|
| show, ask | noul | a Hacker News title, prefix removed | the "Show HN:" / "Ask HN:" prefix |
| kind | choice, 5 | a Hacker News title | the link's domain: code / paper / video / reference / news |
| type | choice, 6 | a commit message, prefix removed | its conventional-commit prefix: fix / feat / docs / … |
| writes | noul | a shell command | 40 commands labelled by hand |

It prints accuracy, Brier score and a reliability table — how often a 0.9 was actually a yes.
Full outputs are kept in [`results/`](results/), one file per model, so runs can be compared.

| task | chance | Qwen2.5-1.5B | Qwen2.5-3B |
|---|---|---|---|
| ask | 0.50 | 0.78 | **0.90** — Brier 0.10; a yes at ≥ 0.9 is right 93% of the time |
| show | 0.50 | 0.64 | 0.72 — still overconfident: ≥ 0.9 is right 72% |
| kind | 0.20 | 0.57 | 0.69 |
| type | 0.17 | 0.31 | 0.39 — 86% of answers carry confidence ≥ 0.8 |
| writes | 0.50 | 0.68 | 0.73 — still calls 10 of 20 write commands read-only at p < 0.1 |
| ms / item, CPU | | 760 | ~1500 |

Read that as: the interface is right, every number improves with size, and small models run
hot on confidence. Judgment quality is the model's — the 0.5B fails the self-check, the 1.5B
passes it, the 3B is clearly better, larger still is better again. Do not gate anything destructive on a
small model's "no". Probabilities are softmaxed logits, not measured outcomes: treat 0.9 as a
strong lean until the reliability table for your model and your questions says otherwise.

## Demo

`uv run demo.py`, then open <http://localhost:8080>. The same model answers the same
questions two ways, side by side, with a live clock on each:

- **left** — asked to write the answers as JSON, streamed token by token, then parsed
- **right** — one forward pass, a probability bar for every option, nothing to parse

On the example ticket the 1.5B, generating text, routes the double charge to `returns`;
reading the logits it says `billing` at 1.00. Same weights. That gap is the point.

## Files

| file | what |
|---|---|
| `jev.py` | the model wrapper, the HTTP server and the self-check — the whole idea |
| `eval.py` | public evaluation, results in `results/` |
| `demo.py`, `demo.html` | the side-by-side page |

`pyproject.toml` carries the two dependencies and the ruff config; `uvx ruff format . && uvx ruff check .` keeps it clean.

MIT.
