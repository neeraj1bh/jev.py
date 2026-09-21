# jev.py

Typed decisions from any local language model, in one file.

Ask a yes/no, pick-one or rate-on-a-scale question about some text and get a probability
back instead of prose. No GPU needed, no API key, no text generation. About 270 lines.

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
OK  4 questions, 567 input tokens, 1813 ms on cpu with Qwen/Qwen2.5-1.5B-Instruct
```

One support ticket, four questions, one pass over the state, a laptop CPU. The 1.0s are a
small model's overconfidence; see Verify.

## Why

Most decisions software asks a model for are small: is this spam, which queue, how urgent.
Asking a chat model to *write* the answer means waiting for tokens, parsing text, and handling
the day it replies with a paragraph. A model shown the options has already decided before it
writes. `jev.py` asks it how likely each option's own words are as the answer and reads those
probabilities directly, so the answer is always one of your options, comes with a probability,
and costs one pass.

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
| `choice` | up to 255 named options (26 on hosted backends), descriptions optional | `choice`, `probabilities`, `confidence` |
| `score` | 2–10 ordered level descriptions | `score` on the level line, `probabilities`, `legend`, `confidence` |

State is any text or JSON. All questions in a request see the same state and are answered in
the same pass, so ask everything at once. `confidence` is 1 − normalized entropy.

**Put the content in `state`, the judgment in the question.** Small models read the state
block carefully and under-weight text tucked inside the question: the same titles scored at
chance when placed after "QUESTION:" and 7 of 8 when placed in the state. One piece of content
per call, as many questions about it as you like.

```python
from jev import Jev

Jev().ask(state, questions)["answers"]["refund"]["noul"]  # 1.0
```

## How

```
                       ┌─ "Is the customer asking for a refund?"  yes ─┐
                       │                                          no  ─┤─ softmax ─▶ noul   1.00
                       │
 state ─▶ model ─▶ cache ─┼─ "Which team should handle this?"     billing  ─┐
   (run once)          │                                          shipping ─┼─ softmax ─▶ choice billing
                       │                                          other    ─┘
                       │
                       └─ "How frustrated is the customer?"       level 0 ─┐
                                                                  level 1 ─┼─ softmax ─▶ score  2.00
                                                                  level 2 ─┘
```

1. The state goes through the model once; its key/value cache is kept.
2. For every option of every question, the question and the option's own words are appended
   and scored: the model's log-probability for those words, given everything before them.
3. The scores of one question are softmaxed against each other. That is the answer.

Nothing is generated, so nothing needs parsing and no answer can fall outside the options.

## Verify

`uv run eval.py` scores the model on public data with public labels. The model only sees the
text; the truth comes from the item itself:

| task | type | what the model sees | truth |
|---|---|---|---|
| show, ask | noul | a Hacker News title, prefix removed | the "Show HN:" / "Ask HN:" prefix |
| kind | choice, 5 | a Hacker News title | the link's domain: code / paper / video / reference / news |
| type | choice, 6 | a commit message, prefix removed | its conventional-commit prefix: fix / feat / docs / … |
| writes | noul | a shell command | 40 commands labelled by hand — too few to separate the local models |
| fields | choice, 4 | an exam question with four answers | the exam key, 40 questions from each of ten MMLU subjects |
| sentiment | noul | a movie review sentence | SST-2 label |
| phishing | noul | an email | a public phishing-email set |
| entails | noul | two sentences: does A entail B | GLUE RTE |
| snli | choice, 3 | premise and hypothesis | SNLI: entailment / neutral / contradiction |
| topic | choice, 4 | a news snippet | AG News section |
| intent | choice, 26 | a customer message | Bitext customer-support intent |
| toxicity | score, 4 levels | a comment | Civil Comments human toxicity score, binned |
| typesafe | noul, choice | a business document: security incident, agent trace, invoice, support ticket | TypeSafe's published eval cases, the consensus of its two reference label sets |

The seven from sentiment to toxicity are 300 items each, fetched from the Hugging Face Hub's JSON
rows endpoint. The TypeSafe cases (354 questions) are downloaded from TypeSafe's public eval page
at run time into the git-ignored `results/typesafe/`.

It prints accuracy, Brier score and a reliability table — how often a 0.9 was actually a yes —
and writes every answer with its probabilities and latency to `results/logs/<model>.jsonl`. The item
set is saved on first run and reused, so every model is scored on the same items. Summaries
are kept in [`results/`](results/), one file per model; they call the `fields` task `answer`.
A yes/no counts as correct when its probability is above 0.5. Each Hacker News item carries
three questions, so two of its three `.jsonl` rows have no truth. The item set contains
samples of third-party text: HN titles, commit messages from three public repos, and rows from
six public datasets, including toxic comments and phishing emails.

| task | n | chance | Qwen2.5-1.5B<br>CPU | Qwen2.5-3B<br>CPU | Qwen2.5-3B f16<br>GPU | Qwen2.5-7B Q4<br>GPU | Qwen2.5-7B Q8<br>GPU | Qwen2.5-14B Q4<br>GPU | Qwen3-30B-A3B Q4<br>GPU | DeepSeek V4.1-Flash<br>hosted |
|---|---|---|---|---|---|---|---|---|---|---|
| show | 120 | .50 | .608 | .767 | .725 | .767 | **.775** | **.775** | **.775** | **.775** |
| ask | 120 | .50 | .900 | .917 | .908 | .933 | .925 | .942 | .942 | **.950** |
| kind | 120 | .20 | .650 | .650 | .675 | .717 | .742 | .775 | .758 | **.842** |
| type | 296 | .17 | .260 | .402 | .355 | .429 | .426 | .422 | .466 | **.598** |
| writes | 40 | .50 | .650 | .700 | .775 | .875 | .925 | .925 | .925 | **.975** |
| fields | 400 | .25 | .495 | .565 | .585 | .640 | .655 | .695 | .777 | **.868** |
| sentiment | 300 | .50 | .940 | .930 | .907 | .947 | .933 | .947 | .950 | **.970** |
| phishing | 291 | .50 | .821 | .808 | .893 | .849 | .832 | .869 | **.945** | .924 |
| entails | 277 | .50 | .736 | .690 | .516 | .758 | .769 | .819 | **.856** | **.856** |
| snli | 297 | .33 | .761 | **.906** | .747 | .731 | .721 | .889 | .845 | .828 |
| topic | 300 | .25 | .827 | .747 | .750 | **.837** | **.837** | .787 | .780 | .813 |
| intent | 300 | .04 | .693 | .690 | .480 | .813 | .790 | .837 | .843 | **.927** |
| toxicity (exact level) | 300 | .25 | .377 | .157 | .180 | .337 | .313 | .447 | .327 | **.520** |
| toxicity, mean level error (0–3) | 300 |  | 1.140 | 1.320 | 1.460 | 1.050 | 1.110 | .790 | 1.120 | **.670** |
| **TypeSafe cases** (vs consensus) | 354 |  | .511 | .593 | .630 | .675 | .675 | .751 | .774 | **.876** |
| ms / item | | | 1,804 | 3,405 | 1,249 | 1,916 | 2,403 | 4,715 | — | 725 |

GPU = AMD Radeon RX 6700 XT through llama.cpp's Vulkan backend (`uv run eval.py remote:llamacpp:<name>`);
CPU = Ryzen 7 7700X, PyTorch bf16. The 30B run was resumed after GPU driver crashes, so its wall
time is not a latency figure.

Read that as:

- the readout works on every model tried — 3,146 items, three question types, thirteen tasks,
  eight models on CPU, an AMD GPU and a hosted API;
- judgment scales with the model: on TypeSafe's cases 1.5B → 14B → 30B MoE → hosted goes
  .51 → .75 → .77 → .88, and on the shell `writes` gate .65 → .925 → .925 → .975;
- 4-bit costs nothing measurable at 7B: Q4 and Q8 both score .675 on the TypeSafe cases;
- small models run hot — they say 0.9 far more often than they are right, and none of the local
  models grades toxicity well — so use them for demos and bulk triage, not for gating
  destructive actions;
- probabilities are softmaxed log-probs, not measured outcomes: read the reliability table for
  your model and your questions before choosing a threshold.

| hardware | how | status |
|---|---|---|
| x86 CPU | PyTorch, bf16 where the CPU has it | measured: 1.5B, 3B |
| AMD GPU | llama.cpp (Vulkan) server, `remote.py llamacpp` | measured: 3B to 30B |
| NVIDIA GPU | PyTorch CUDA, picked automatically | supported, not yet measured |
| Apple Silicon | PyTorch MPS, picked automatically | supported, not yet measured |
| hosted APIs | `remote.py` | measured: DeepSeek |

## Demo

`uv run demo.py`, then open <http://localhost:8080>. The same model answers the same
questions two ways, timed one after the other, then replayed side by side:

- **left** — asked to write the answers as JSON, streamed token by token, then parsed
- **right** — one pass over the state, a probability bar for every option, nothing to parse

Four examples are built in — a support ticket, a shell command, an inbox email, a pull
request — and both boxes are editable. The line above the columns states the speed ratio and
where the two answers differed, computed from the run.

On the example ticket the 1.5B, generating text, routes the double charge to `returns`;
reading the logits it says `billing` at 1.00. Same weights. That gap is the point.

## Hosted models

`remote.py` answers the same requests from a hosted model through its chat API's
log-probabilities — DeepSeek, Kimi, OpenRouter, OpenAI, or a llama.cpp `llama-server` on your own
GPU — and passes straight through to the TypeSafe API when that key is present. The options are
labelled A, B, C… and the model's probability for each letter is the answer, so these backends
take at most 26 options. Keys go in `.env` (copy `.env.example`).

```sh
uv run remote.py deepseek            # self-check
uv run remote.py deepseek serve      # the same server, backed by DeepSeek
uv run eval.py remote:deepseek       # the same eval on a hosted model
uv run eval.py remote:llamacpp:qwen2.5-7b-q4   # a model in llama-server (LLAMACPP_URL, default :8080)
```

Thinking is turned off per provider (otherwise the first token is reasoning, not the answer)
and the temperature set to what each accepts. A provider must return log-probabilities to be
usable this way; Anthropic's API does not, and Kimi K3 cannot stop reasoning first.

## Files

| file | what |
|---|---|
| `jev.py` | the model wrapper, the HTTP server and the self-check — the whole idea |
| `eval.py` | public evaluation, results in `results/` |
| `readout.py` | letter vs option-text readout, and how often answers flip when the options are reversed |
| `demo.py`, `demo.html` | the side-by-side page |
| `remote.py`, `.env.example` | hosted backends and where their keys go |

`pyproject.toml` carries the two dependencies and the ruff config; `uvx ruff format . && uvx ruff check .` keeps it clean.

MIT.
