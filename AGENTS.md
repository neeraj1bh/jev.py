# AGENTS.md

jev.py reads typed answers (yes/no, pick one, a score) from a language model's probabilities in one
pass, behind the same API as TypeSafe's Jev. It runs local models (PyTorch, llama.cpp) and hosted
ones that return log-probabilities, and ships a local comparison page and a frozen benchmark.
Read `README.md` before changing anything; its commands are the release test.

## Public repository: nothing from your machine

This repository is public. Write nothing into it that comes from the machine you work on:

- no IP addresses, host names or ports other than the documented defaults (8080, 8081);
- no real paths, drive letters, user names or folder layouts. Examples use placeholders:
  `/path/to/models`, `<windows-address>`, `C:\models`;
- no keys, tokens, `.env` contents, downloaded models, datasets, run logs or screenshots.

This covers code, comments, docs, test fixtures and commit messages. Test with real local values,
but commit only placeholders, and delete what a test wrote under `data/`. Before every commit, run
the check in [Before committing](#before-committing).

Also keep out: references to other projects or private repositories. Cite only the TypeSafe API
and the public datasets and models the code uses.

## Where things live

| Path | What |
|---|---|
| `src/jev/core.py` | the readout, the HTTP server and the self-check |
| `src/jev/remote.py` | hosted and llama.cpp backends, the letter readout |
| `src/jev/demo.py`, `web/` | the comparison page's server and its React page |
| `src/jev/bench.py`, `benchmarks/` | Core v1: frozen item pointers, models, token sizes |
| `src/jev/downloads.py`, `cache.py`, `folders.py`, `llamaserver.py` | local models: download, find, run |
| `src/jev/eval.py`, `readout.py`, `results/` | the older public eval and its committed summaries |
| `data/`, `models/`, `results/logs/`, `local/` | per-machine state, git-ignored; never commit |

## Rules and why

- **Answers come from probabilities, never from parsing generated text.** That is the product;
  a fallback to text parsing hides a broken readout.
- **Hosted backends are read by letter and take at most 26 options.** Do not raise the limit or
  guess missing letters; a backend that returns no log-probabilities fails loudly.
- **Core v1 stores pointers, not text.** Items are rebuilt from the Hugging Face Hub and checked
  against their fingerprints. Never commit item text. Once a model has run v1, its items never
  change; new items make a v2.
- **Jev is measured, never learned from.** Its Core v1 scores may be published like any model's;
  its answers never tune, select or build anything here, and no page serves Jev on the owner's key.
- **Compare like with like.** The same items, labels and scoring for every model; report
  latency with its conditions (device, load, parallel requests).
- **Local only by default.** Servers bind 127.0.0.1; `JEV_HOST` opens them on purpose. Anything
  that browses or changes files answers this machine only.
- **Nothing silently downloads or spends money.** Downloads and paid runs are confirmed first, and
  every download can be stopped and resumed.
- **Dependencies:** standard library and what is already installed first. A new one needs a
  reason stated in the commit.

## Checks

```sh
uv run jev                                # self-check against the example ticket
uvx ruff format . && uvx ruff check .
cd web && pnpm check                      # Biome, the type check and the build
```

A change to the page is checked in a browser at 390 and 1440 px wide: no console errors, no
horizontal scroll. Report what was run and what it printed; never claim a check that was not run.

## Before committing

```sh
git diff --cached | grep -nE '([0-9]{1,3}\.){3}[0-9]{1,3}|/home/|/Users/|/mnt/[a-z]/|[A-Z]:\\'
```

Anything it prints must be a documented default or a placeholder. Also read the commit message.

## Commits

One logical change per commit, staged by path. The subject says what, the body says why. No
AI-attribution trailers, and nothing pushed unless the maintainer asks.

## Writing

Plain, specific, and true today: a comment explains why, not what; docs describe behaviour that
exists. Markdown that an agent reads is code: say why a rule exists, or it gets simplified away.
