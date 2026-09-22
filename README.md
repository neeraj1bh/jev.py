# jev.py

Typed decisions from any local language model, in one file.

Ask a yes/no, pick-one or rate-on-a-scale question about some text and get a probability
back instead of prose. No GPU needed, no API key, no text generation. About 270 lines.

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
uv run jev                                   # self-check; downloads Qwen2.5-1.5B (3 GB) once
uv run jev serve                             # HTTP on http://localhost:8080/v1/systemone
uv run jev serve Qwen/Qwen2.5-7B-Instruct    # any chat model on the Hub
uv run jev request.json                      # one request from a file
uv run jev-demo                                  # side-by-side comparison page, see Demo
```

Without uv: `pip install torch transformers`, then `python` instead of `uv run`. Uses CUDA,
Apple MPS or CPU, whichever is there; on CPUs with native bf16 it uses that.

On Linux without an NVIDIA GPU, skip the 2.5 GB of CUDA libraries: `uv venv && uv pip install
torch --index-url https://download.pytorch.org/whl/cpu && uv pip install transformers && uv pip install -e .
--no-deps`, then
`uv run --no-sync` instead of `uv run`, e.g. `uv run --no-sync jev-demo`.

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

`uv run jev-eval` scores the model on public data with public labels. The model only sees the
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

The seven from sentiment to toxicity are 300 items each from the Hugging Face Hub; the 354
TypeSafe questions come from TypeSafe's public eval page. No items are in this repo: `jev-eval`
downloads the items on first run and saves the set, so every model is scored on the same items.
It prints accuracy, Brier score and a reliability table (how often a 0.9 was actually a yes), and
logs every answer to `results/logs/<model>.jsonl`. A yes/no is correct when its probability is
above 0.5. Per-model summaries are in [`results/`](results/).

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
through llama.cpp's Vulkan server (`remote:llamacpp`), which also ran 3B f16 and 7B Q8 (in
`results/`; 7B Q8 is within a few points of Q4). The 30B run was resumed after driver crashes, so it has no
latency figure. DeepSeek is V4.1-Flash, hosted.

- Quality grows with the model: on the TypeSafe questions .51 (1.5B) → .75 (14B) → .77 (30B) →
  .88 (DeepSeek).
- Small models are overconfident and none of the local ones grades toxicity well. Use them for
  triage, not for gating destructive actions.
- The probabilities are softmaxed log-probs, not measured frequencies. Check the reliability
  table for your model before picking a threshold.

| hardware | how | measured |
|---|---|---|
| x86 CPU | PyTorch | 1.5B, 3B |
| AMD GPU | llama.cpp server | 3B to 30B |
| NVIDIA GPU | PyTorch CUDA | not yet |
| Apple Silicon | PyTorch MPS | not yet |

## Demo

Build the page once, then serve it with the backends:

```bash
cd web && pnpm install && pnpm build && cd ..   # Node 20.19+ and pnpm
uv run jev-demo                                   # http://localhost:8080
```

While changing the page, `pnpm dev` in `web/` serves it on <http://localhost:3000> with live
reload and passes API calls to `jev-demo`. `pnpm check` runs Biome, the type check and the build.
Two modes:

- **Generate vs readout.** One local model answers the same questions two ways: writing JSON
  token by token on the left, reading the logits in one pass on the right.
- **Compare two.** The same request to any two backends: a local model, a llama.cpp server or a
  hosted API. Each runs alone so its time is honest; **Replay together** plays both back at the
  recorded speed.

Four examples are built in (a support ticket, a shell command, an email, a pull request) and
both boxes are editable. Under **Dataset** the input is a labelled item from a public set (SST-2,
RTE, BoolQ, SNLI, AG News, tweet emotion, Banking77, CLINC150, MMLU, MMLU-Pro, ARC-Challenge,
HellaSwag, TruthfulQA, or TypeSafe's cases): each answer
is marked against the label and a running score is kept. A batch runs any number of items, or all
of them; two hosted backends run eight items at a time. Items are downloaded on first use into
`data/`, and every batch answer is logged to `results/logs/demo/`; both are git-ignored.

| dataset | asks | answers |
|---|---|---|
| [SST-2](https://huggingface.co/datasets/stanfordnlp/sst2) | is this movie-review sentence positive? | yes / no |
| [RTE](https://huggingface.co/datasets/nyu-mll/glue) | does sentence A entail sentence B? | yes / no |
| [BoolQ](https://huggingface.co/datasets/google/boolq) | given a passage, is the answer yes? | yes / no |
| [SNLI](https://huggingface.co/datasets/stanfordnlp/snli) | premise vs hypothesis | 3 labels |
| [AG News](https://huggingface.co/datasets/fancyzhx/ag_news) | news section | 4 labels |
| [Tweet emotion](https://huggingface.co/datasets/cardiffnlp/tweet_eval) | emotion of a tweet | 4 labels |
| [Banking77](https://huggingface.co/datasets/legacy-datasets/banking77) | intent of a banking message | 77 labels |
| [CLINC150](https://huggingface.co/datasets/clinc/clinc_oos) | intent of an assistant request | 151 labels |
| TypeSafe's published cases | several questions about one business document | mixed |
| [MMLU](https://huggingface.co/datasets/cais/mmlu) | exam question, 57 subjects | 4 choices |
| [MMLU-Pro](https://huggingface.co/datasets/TIGER-Lab/MMLU-Pro) | harder exam question | 10 choices |
| [ARC-Challenge](https://huggingface.co/datasets/allenai/ai2_arc) | grade-school science | 4 choices |
| [HellaSwag](https://huggingface.co/datasets/Rowan/hellaswag) | most plausible ending | 4 choices |
| [TruthfulQA](https://huggingface.co/datasets/truthfulqa/truthful_qa) | the true answer among misconceptions | 4 to 13 choices |

Backends that read the answer as a letter (DeepSeek, Kimi, OpenAI, OpenRouter, llama.cpp) take at
most 26 labels, so the menu greys out Banking77 and CLINC150 for them.

On the example ticket the 1.5B, generating text, routes the double charge to `returns`;
reading the logits it says `billing` at 1.00. Same weights. That gap is the point.

The menu lists Qwen2.5 0.5B, 1.5B and 3B, the hosted backends whose key is in `.env`, and a
llama.cpp server if one is running. Nothing downloads until you pick it. A model already in the
Hugging Face cache is used from there; anything else goes to `models/` (git-ignored, or set
`JEV_MODELS`). A hosted backend without a key takes one in the page: it is checked with one tiny
request, then used for the session and, if you tick the box, saved to `.env`. A rejected key shows
up as a message and changes nothing.

llama.cpp is optional. On NVIDIA, a Mac or a CPU the demo runs models through PyTorch as it is.
Use llama.cpp for an AMD GPU, which PyTorch cannot use on Windows or WSL, or to run a 4-bit model
too large to load otherwise. The GGUFs measured above (Q4_K_M):
[Qwen2.5-7B](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF),
[Qwen2.5-14B](https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF),
[Qwen3-30B-A3B](https://huggingface.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF).

```sh
llama-server -m qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf --port 8081
echo "LLAMACPP_URL=http://localhost:8081/v1/chat/completions" >> .env
```

## Hosted models

`src/jev/remote.py` answers the same requests from a hosted model through its chat API's
log-probabilities — DeepSeek, Kimi, OpenRouter, OpenAI, or a llama.cpp `llama-server` on your own
GPU — and passes straight through to the TypeSafe API when that key is present. The options are
labelled A, B, C… and the model's probability for each letter is the answer, so these backends
take at most 26 options. Keys go in `.env` (copy `.env.example`).

```sh
uv run jev-remote deepseek            # self-check
uv run jev-remote deepseek serve      # the same server, backed by DeepSeek
uv run jev-eval remote:deepseek       # the same eval on a hosted model
uv run jev-eval remote:llamacpp:qwen2.5-7b-q4   # a model in llama-server (LLAMACPP_URL, default :8080)
```

Thinking is turned off per provider (otherwise the first token is reasoning, not the answer)
and the temperature set to what each accepts. A provider must return log-probabilities to be
usable this way; Anthropic's API does not, and Kimi K3 cannot stop reasoning first. Which
providers return probabilities, and how many, is in [docs/providers.md](docs/providers.md).

## Files

| file | what |
|---|---|
| `src/jev/core.py` | the model wrapper, the HTTP server and the self-check — the whole idea |
| `src/jev/eval.py` | public evaluation, results in `results/` |
| `src/jev/readout.py` | letter vs option-text readout, and how often answers flip when the options are reversed |
| `src/jev/demo.py`, `web/` | the demo server and its React page |
| `src/jev/remote.py`, `.env.example` | hosted backends and where their keys go |
| `docs/providers.md` | which hosted providers return probabilities |

`pyproject.toml` carries the two dependencies and the ruff config; `uvx ruff format . && uvx ruff check .` keeps it clean.

MIT.
