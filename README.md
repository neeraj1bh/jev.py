# jev.py

Ask a language model a small question about some text (yes or no, which one, how much) and get
back a probability for every answer, instead of a paragraph to parse.

```console
$ uv run jev
{
  "refund_requested": { "type": "noul", "noul": 1.0 },
  "is_spam": { "type": "noul", "noul": 0.0 },
  "department": {
    "type": "choice",
    "choice": "billing",
    "confidence": 1.0,
    "probabilities": { "billing": 1.0, "shipping": 0.0, "returns": 0.0, "other": 0.0 }
  },
  "frustration": {
    "type": "score",
    "score": 2.0,
    "confidence": 0.99,
    "probabilities": { "0": 0.0, "1": 0.0, "2": 1.0 }
  }
}
OK  4 questions, 567 input tokens, 1813 ms on cpu with Qwen/Qwen2.5-1.5B-Instruct
```

One support ticket, four questions, answered at once by a small model on a laptop CPU. No GPU,
no API key, nothing generated. The whole idea fits in one file,
[`src/jev/core.py`](src/jev/core.py).

## Why

Most questions software asks a model are small: is this spam, which team gets it, how urgent is
it. Asking a chat model to *write* the answer means waiting for text, parsing it, and handling
the day it replies with a paragraph. jev.py reads how likely the model finds each of your answers
instead. So the answer is always one of your options, it comes with a probability you can set a
threshold on, and it takes one pass through the model.

The same model can do both, and they disagree: asked to *write* which team a double charge goes
to, Qwen2.5-1.5B writes `returns`; asked to *read*, it picks `billing` at 0.98. The page shows this
side by side.

## Results

Core v1 is 2,630 fixed questions from 48 public datasets: safety, sentiment, contracts, reasoning,
other languages and more. The first run, on 2026-09-26 (still in review, so these may move
slightly):

| model | right | 95% range | cost of the run |
|---|---:|---:|---:|
| TypeSafe's Jev | 84.7% | 82.7–86.7 | about $0.07 |
| Gemma 4 31B | 83.8% | 81.7–85.8 | $0.20 |
| DeepSeek V4.1 Flash | 83.4% | 81.4–85.4 | about $0.11 |
| Qwen3-Next 80B | 78.2% | 75.9–80.3 | $0.21 |
| GPT-4o-mini | 75.8% | 73.3–78.1 | $0.23 |
| Llama 3.1 8B | 63.6% | 60.8–66.3 | $0.10 |
| Laya (typed-decisions) | 52.0% | 49.2–54.9 | free, on this machine |

On the 2,478 questions all seven answered. The top three are within each other's ranges. Jev's
probabilities are the only ones worth a threshold: the five chat models are overconfident, and on
the questions where they gave a probability for every option, each scored worse than spreading its
answer evenly across the options would have. Costs are what the provider billed, cached input
included; DeepSeek's is read from its balance, Jev's worked out from its reported tokens.

[Laya](docs/local-models.md#laya) is an open encoder built for these questions, run on 2026-09-30
on an Apple Silicon Mac, one request at a time. It is the fastest here by far, a median of 60 ms
an item against Jev's 379 ms over the network with eight requests at a time, and the least
accurate; its probabilities score about the same as an even spread. Two things shape its number:
its makers list news-topic and spam sets as training data (it scores 92% and 86% there), and its
server refuses a question with more than 100 options, so it answered none of CLINC150.

How the questions were picked, how to run it, and earlier results: [docs/benchmark.md](docs/benchmark.md).

## Start

You need [uv](https://docs.astral.sh/uv/getting-started/installation/). For the web page, also
[Node.js](https://nodejs.org) 20.19 or newer with pnpm, npm or bun.

```sh
git clone <this repository> && cd jev.py
uv run jev          # the self-check above; downloads a small model (3 GB) the first time
uv run prod         # the web page: http://localhost:8080
```

The first run installs everything it needs; stop with Ctrl-C. A Mac uses its GPU as is. With an
NVIDIA GPU, swap in the CUDA build of PyTorch once (`jev` prints this when it sees one):

```sh
uv pip install --reinstall torch --torch-backend cu128
uv run --no-sync jev    # --no-sync keeps uv from putting the CPU build back
```

## The web page

`uv run prod` opens a page, on this machine only, to:

- **Compare** up to six models on the same questions, answers and times side by side.
- **Generate vs readout:** one model, asked both ways.
- **Benchmark** many models on one of 48 labelled datasets, with the cost shown before anything
  is sent.
- **Replay past runs**, saved on this machine, at their real speed or faster.

## Asking a question

Send the text as `state` and your questions beside it:

```json
{
  "state": { "ticket": "I was charged twice for order #4411 and I want my money back." },
  "questions": {
    "refund": { "type": "noul", "instructions": "Is the customer asking for a refund?" },
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": {
        "billing": "charges, refunds, invoices",
        "shipping": "delivery, tracking, lost parcels",
        "other": null
      }
    },
    "anger": {
      "type": "score",
      "instructions": "How frustrated is the customer?",
      "criteria": ["calm", "annoyed but civil", "angry"]
    }
  }
}
```

| type | you ask | you get |
|---|---|---|
| `noul` | a yes/no question | `noul`: the probability of yes |
| `choice` | pick one of up to 255 named options | `choice`, and a probability for each option |
| `score` | pick a level on a scale of 2 to 10 | `score` on that scale, and a probability for each level |

`confidence` is how sure the model is overall, from 0 to 1. All questions about one text are
answered together, so ask them in one request. Put the material in `state` and only the question
in `instructions`: small models read the state carefully and skim text tucked into a question.

```sh
uv run jev serve                             # a server: http://localhost:8080/v1/systemone
uv run jev serve Qwen/Qwen2.5-7B-Instruct    # with any chat model on Hugging Face
uv run jev request.json                      # one request from a file
```

With a server running, from another terminal:

```sh
curl -s localhost:8080/v1/systemone -H 'content-type: application/json' -d '{
  "state": { "ticket": "I was charged twice for order #4411 and I want my money back." },
  "questions": {
    "refund": { "type": "noul", "instructions": "Is the customer asking for a refund?" }
  }
}' | python3 -m json.tool --indent 2
```

```json
{
  "model": "deepseek-flash",
  "answers": {
    "refund": { "type": "noul", "noul": 1.0, ... }
  },
  "latency_ms": 961
}
```

Full requests and answers, local and hosted: [docs/api.md](docs/api.md).

```python
from jev import Jev

Jev().ask(state, questions)["answers"]["refund"]["noul"]  # 1.0
```

Requests and answers follow the [TypeSafe System One API](https://docs.typesafe.ai/api), so a
client written for it only needs its base URL changed.

## How it works

```
                       ┌─ "Is the customer asking for a refund?"  yes ─┐
                       │                                          no  ─┤─ softmax ─▶ noul   1.00
                       │
 state ─▶ model ─▶ cache ─┼─ "Which team should handle this?"     billing  ─┐
   (read once)         │                                          shipping ─┼─ softmax ─▶ choice billing
                       │                                          other    ─┘
                       │
                       └─ "How frustrated is the customer?"       level 0 ─┐
                                                                  level 1 ─┼─ softmax ─▶ score  2.00
                                                                  level 2 ─┘
```

1. The model reads the text once and keeps what it computed.
2. For each option of each question, it scores how likely the question followed by that option's
   own words is.
3. Each question's scores are turned into probabilities that add up to 1. That is the answer.

Nothing is written, so nothing needs parsing and no answer can fall outside your options.

## Hosted models

Hosted models that return token probabilities work too: DeepSeek, Kimi, OpenAI and OpenRouter.
They see the options as letters A, B, C…, so they take at most 26 options. Put keys in `.env`
(copy `.env.example`) or add them in the page, which checks each key before saving it.

```sh
uv run jev-remote deepseek          # the self-check on a hosted model
uv run jev-remote deepseek serve    # the same server, answered by DeepSeek
```

Which providers work and why Anthropic and Groq cannot: [docs/providers.md](docs/providers.md).
Local models and llama.cpp on each system, AMD GPUs included:
[docs/local-models.md](docs/local-models.md).

## Limits

- **A probability here is the model's, not a measured rate.** Check how often a 0.9 is really
  right on your own data before you pick a threshold.
- **Hosted models see only the top 20 tokens,** so an option outside them reads as 0, and they
  take at most 26 options.
- **Hosted times are not a model's speed.** They include the network and the provider's load, which
  changes by the hour; each saved run keeps when it ran.
- **A 50-question set is a sample.** 40 of 50 right is 80%, give or take about 11 points. Trust the
  groups and the headline over any single set.
- **Core v1 measures judging, not doing.** Spotting an unsupported claim is not the same as never
  making one. Labels are balanced by design, which real traffic is not.

## Development

Checks, the dev server and where the code lives: [docs/development.md](docs/development.md).
Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).
Reporting a vulnerability: [SECURITY.md](SECURITY.md).

## Tests

```sh
uv run pytest           # the letter readout, written answers, fingerprints, picking and scoring
uv run mypy             # strict types of core.py and remote.py
cd web && pnpm test     # the page's scoring and merging of saved runs
```

All offline: no key, no model download, no cost.

## Licence

MIT.
