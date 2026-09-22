# jev.py

Typed decisions from any local language model.

Ask a yes/no, pick-one or rate-on-a-scale question about some text and get a probability
back instead of prose. No GPU needed, no API key, no text generation. The whole idea is one
file, [`src/jev/core.py`](src/jev/core.py), under 300 lines.

```console
$ uv run jev
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
small model's overconfidence; see [Results](#results).

## Why

Most decisions software asks a model for are small: is this spam, which queue, how urgent.
Asking a chat model to *write* the answer means waiting for tokens, parsing text, and handling
the day it replies with a paragraph. A model shown the options has already decided before it
writes. jev.py asks how likely each option's own words are as the answer and reads those
probabilities directly, so the answer is always one of your options, comes with a probability,
and costs one pass.

## Run

```sh
uv run jev                                   # self-check; downloads Qwen2.5-1.5B (3 GB) once
uv run jev serve                             # HTTP on http://localhost:8080/v1/systemone
uv run jev serve Qwen/Qwen2.5-7B-Instruct    # any chat model on the Hub
uv run jev request.json                      # one request from a file
```

Needs [uv](https://docs.astral.sh/uv/). It uses CUDA, Apple MPS or the CPU, whichever is there,
in bf16 where the hardware has it.

On Linux without an NVIDIA GPU, skip the 2.5 GB of CUDA libraries and install once:

```sh
uv venv
uv pip install torch --index-url https://download.pytorch.org/whl/cpu
uv pip install transformers && uv pip install -e . --no-deps
uv run --no-sync jev          # --no-sync goes before the command, or uv installs CUDA again
```

On that setup, write `uv run --no-sync` wherever this README says `uv run`.

Requests and responses follow the [TypeSafe System One API](https://docs.typesafe.ai/api), so a
client written for it only needs a base URL change.

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
| `noul` | a yes/no question | `noul`, the probability of yes |
| `choice` | up to 255 named options (26 on letter backends), descriptions optional | `choice`, `probabilities`, `confidence` |
| `score` | 2–10 ordered level descriptions | `score` on the level line, `probabilities`, `legend`, `confidence` |

State is any text or JSON. All questions in a request see the same state and are answered in
the same pass, so ask everything at once. `confidence` is 1 − normalized entropy.

**Put the content in `state`, the judgment in the question.** Small models read the state block
carefully and under-weight text tucked inside the question: the same titles scored at chance
when placed after "QUESTION:" and 7 of 8 when placed in the state.

```python
from jev import Jev

Jev().ask(state, questions)["answers"]["refund"]["noul"]  # 1.0
```

## How it works

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
2. For every option of every question, the question and the option's own words are appended and
   scored: the model's log-probability for those words, given everything before them.
3. The scores of one question are softmaxed against each other. That is the answer.

Nothing is generated, so nothing needs parsing and no answer can fall outside the options.

## Results

`uv run jev-eval` scores a model on public data with public labels. The model only sees the
text; the truth comes from the item itself.

| task | type | what the model sees | truth |
|---|---|---|---|
| show, ask | noul | a Hacker News title, prefix removed | the "Show HN:" / "Ask HN:" prefix |
| kind | choice, 5 | a Hacker News title | the link's domain: code / paper / video / reference / news |
| type | choice, 6 | a commit message, prefix removed | its conventional-commit prefix: fix / feat / docs / … |
| writes | noul | a shell command | 40 commands labelled by hand, too few to separate the local models |
| fields | choice, 4 | an exam question with four answers | the exam key, 40 questions from each of ten MMLU subjects |
| sentiment | noul | a movie review sentence | SST-2 label |
| phishing | noul | an email | a public phishing-email set |
| entails | noul | two sentences: does A entail B | GLUE RTE |
| snli | choice, 3 | premise and hypothesis | SNLI: entailment / neutral / contradiction |
| topic | choice, 4 | a news snippet | AG News section |
| intent | choice, 26 | a customer message | Bitext customer-support intent |
| toxicity | score, 4 levels | a comment | Civil Comments human toxicity score, binned |
| typesafe | noul, choice | a business document: security incident, agent trace, invoice, support ticket | TypeSafe's published eval cases, the consensus of its two reference label sets |

| task | chance | 1.5B CPU | 3B CPU | 7B Q4 | 14B Q4 | 30B-A3B Q4 | DeepSeek |
|---|---|---|---|---|---|---|---|
| show | .50 | .608 | .767 | .767 | **.775** | **.775** | **.775** |
| ask | .50 | .900 | .917 | .933 | .942 | .942 | **.950** |
| kind | .20 | .650 | .650 | .717 | .775 | .758 | **.842** |
| type | .17 | .260 | .402 | .429 | .422 | .466 | **.598** |
| writes | .50 | .650 | .700 | .875 | .925 | .925 | **.975** |
| fields | .25 | .495 | .565 | .640 | .695 | .777 | **.868** |
| sentiment | .50 | .940 | .930 | .947 | .947 | .950 | **.970** |
| phishing | .50 | .821 | .808 | .849 | .869 | **.945** | .924 |
| entails | .50 | .736 | .690 | .758 | .819 | **.856** | **.856** |
| snli | .33 | .761 | **.906** | .731 | .889 | .845 | .828 |
| topic | .25 | .827 | .747 | **.837** | .787 | .780 | .813 |
| intent | .04 | .693 | .690 | .813 | .837 | .843 | **.927** |
| toxicity, exact level | .25 | .377 | .157 | .337 | .447 | .327 | **.520** |
| toxicity, mean level error |  | 1.140 | 1.320 | 1.050 | .790 | 1.120 | **.670** |
| **typesafe** |  | .511 | .593 | .675 | .751 | .774 | **.876** |
| ms / item | | 1,804 | 3,405 | 1,916 | 4,715 | — | 725 |

Qwen2.5 1.5B–14B and Qwen3-30B-A3B. CPU: Ryzen 7 7700X, PyTorch bf16. The rest: AMD RX 6700 XT
through llama.cpp's Vulkan server, which also ran 3B f16 and 7B Q8 (in [`results/`](results/);
7B Q8 is within a few points of Q4). The 30B run was resumed after driver crashes, so it has no
latency figure. DeepSeek is V4.1-Flash, hosted.

- Quality grows with the model: on the TypeSafe questions .51 (1.5B) → .75 (14B) → .77 (30B) →
  .88 (DeepSeek).
- Small models are overconfident, and none of the local ones grades toxicity well. Use them for
  triage, not for gating destructive actions.

| hardware | how | measured |
|---|---|---|
| x86 CPU | PyTorch | 1.5B, 3B |
| AMD GPU | llama.cpp server | 3B to 30B |
| NVIDIA GPU | PyTorch CUDA | not yet |
| Apple Silicon | PyTorch MPS | not yet |

### Reproducing them

- **The same items for every model.** The first run downloads the items (300 per Hub task, plus
  the 354 TypeSafe questions from TypeSafe's public eval page) and freezes them in
  `results/eval-set.json`. Every later run, on any model, reads that file.
- **No items in this repo.** The frozen set and the TypeSafe cases are git-ignored; only the
  summaries in `results/` are committed.
- **Every answer is kept.** Each answer, with its probabilities and latency, goes to
  `results/logs/<model>.jsonl`.
- **What is printed.** Accuracy, Brier score and a reliability table: how often a 0.9 was
  actually a yes. A yes/no counts as correct when its probability is above 0.5.
- **The same text for every backend.** Each question's wording lives in one place,
  `items()` in `src/jev/eval.py`, and local and hosted models get identical text.

### Core v1, the frozen benchmark

`benchmarks/core-v1.json` fixes one set of items for every model. It is a **draft**, a balanced
random pick made on 2026-09-22; the final list is the one that survives review (below).
- **Items:** 50 from each of the 45 labelled sets in the demo, plus every TypeSafe step, for
  2,295 items in all.
- **Balance:** equal yes and no, equal counts per label, and the right answer spread evenly across
  positions.
- **Pointers, not text:** the file stores each item's dataset, split, row and a fingerprint.
  Anyone rebuilds the same items from the Hub, and a changed item is reported, not silently used.

Banking77, CLINC150 and LEDGAR have more than 26 options, and letter-reading backends answer 26 at
most. So these three sets' 150 items run only for models that read every option, Jev and local
models. Everyone else answers the other 2,145, and every comparison stays paired.

```sh
uv run jev-bench run remote:deepseek              # one model, saved to Past runs
uv run jev-bench run Qwen/Qwen2.5-1.5B-Instruct   # a local model, wide items included
uv run jev-bench run remote:llamacpp:qwen2.5-7b-q4  # whatever GGUF llama-server has loaded
uv run jev-bench export                           # every item with its text, into local/review/
```

Run each model separately, then open the runs together in Past runs. The models to run are in
`benchmarks/core-v1-models.json`, with the GGUF to load for each llama.cpp one. Before the list is final, two strong models check every label
and people settle where they disagree. After that v1 never changes; new items make a v2.

## Demo

```sh
cd web && pnpm install && pnpm build && cd ..   # Node 20.19+ and pnpm; again after a pull
uv run prod                                      # http://localhost:8080
```

If the page's source changed since the last build, as after a pull, the server says so and shows
the build command instead of an old page. Models already on this machine are listed on their own;
others can be added from the model menu. Downloads can be stopped and resume where they stopped.
Details, and llama.cpp: [docs/local-models.md](docs/local-models.md).

- **Compare.** The same request to several models at once (up to 6 picked by hand, any number from
  Benchmark): local, a llama.cpp server, a direct API or any OpenRouter model that returns
  probabilities.
- **Generate vs readout.** One model answers the same questions two ways: writing JSON token by
  token, and reading the probabilities in one pass. On the example ticket the 1.5B, writing,
  routes the double charge to `returns`; reading, it says `billing` at 1.00. Same weights.
- **Benchmark.** Pick many models (every model of one maker in a click), a set and an item count.
  It shows the estimated cost before anything is sent, then sets the run up in Compare. Its
  leaderboard ranks every model from the saved runs.
- **Past runs.** Every batch is saved to `results/logs/demo/` (git-ignored) and reopens without a
  request. You can search, filter by kind and set, and compare runs that share items side by side.
  Replay plays a run back at its recorded times, at 1×–100× or fitted into 30 seconds.

The input is a built-in example, your own JSON, or an item from one of 45 labelled public sets on
the Hugging Face Hub (listed in the page, defined in `src/jev/demo.py`) or TypeSafe's published
cases. With a set, each answer is marked against the label. GPQA Diamond is behind a login: accept
its terms on the Hub and add `HF_TOKEN` under Keys.

Nothing downloads until you pick it; sets go to `data/`. A model already in the Hugging Face cache is used from there;
anything else goes to `models/` (git-ignored; `JEV_MODELS` moves it). A backend without a key asks
for one in the page, checks it with one tiny request, and saves it to `.env` only if you tick the
box.

## Backends

| backend | how it answers | keys |
|---|---|---|
| a Hugging Face model | the option readout above, full probabilities | none |
| llama.cpp `llama-server` | the letter readout below | none; `LLAMACPP_URL` |
| DeepSeek, Kimi, OpenAI | the letter readout, one pinned model each (`src/jev/remote.py`) | in `.env` |
| OpenRouter | the letter readout, on the models that return probabilities | `OPENROUTER_API_KEY` |
| TypeSafe (Jev) | passed straight through, any number of options | `TYPESAFE_API_KEY` |

Letter backends label the options A, B, C… and read each letter's probability from the API's
`top_logprobs`, so they take at most 26 options. The demo greys out the sets with more (Banking77,
CLINC150, LEDGAR) for them. Thinking is turned off per provider, since otherwise the first token is reasoning, not the
answer.

OpenRouter's model list overstates which models return probabilities: 44 of the 139 checked
actually did. The demo sends each model one small request and lists only those that answered with
probabilities. Which providers work, and why Anthropic, Groq and Kimi K3 do not, is in
[docs/providers.md](docs/providers.md). Keys go in `.env`; copy `.env.example`.

```sh
uv run jev-remote deepseek                     # self-check
uv run jev-remote deepseek serve               # the same server, backed by DeepSeek
uv run jev-eval remote:deepseek                # the eval on a hosted model
uv run jev-eval remote:llamacpp:qwen2.5-7b-q4  # a model in llama-server
```

llama.cpp is optional: use it for an AMD GPU, which PyTorch cannot use on Windows or WSL, or for a
4-bit model too large to load otherwise. The GGUFs measured above are Q4_K_M. Installing it and
running it on macOS, Linux, Windows and WSL: [docs/local-models.md](docs/local-models.md).

## Limitations

- **The probabilities are softmaxed log-probabilities, not measured frequencies.** Check the
  reliability table for your model before you pick a threshold.
- **Letter backends see only the top 20 tokens.** An option outside them reads as 0, so hosted
  answers have 26 options at most and are less smooth than a local model's.
- **Hosted latency is not a model's speed.** A letter readout sends one request per question, in
  parallel; provider load moves the times from day to day. Past runs keep the date they were
  recorded.
- **A few tasks are small.** `writes` has 40 items, and the TypeSafe set has 354 questions from
  20 cases.

## Development

```sh
uvx ruff format . && uvx ruff check .
cd web && pnpm check               # Biome, the type check and the build
cd web && pnpm dev                 # the page on :3000, reloading as you edit; keep uv run prod running
```

| path | what |
|---|---|
| `src/jev/core.py` | the model wrapper, the HTTP server and the self-check: the whole idea |
| `src/jev/eval.py` | the frozen evaluation set and the eval |
| `src/jev/readout.py` | letter vs option-text readout, and how often answers flip when the options are reversed |
| `src/jev/remote.py` | hosted and llama.cpp backends |
| `src/jev/bench.py` | Core v1: freeze, run, export |
| `src/jev/demo.py`, `web/` | the demo server and its React page |
| `results/` | one summary per model run |
| `docs/providers.md` | which hosted providers return probabilities |
| `docs/local-models.md` | Hugging Face models and llama.cpp on each platform |

MIT.
