# Contributing

Issues and pull requests are welcome. jev.py is Python 3.10+ with [uv](https://docs.astral.sh/uv/),
and a React page in `web/` built with pnpm.

## Before you push

```sh
uvx ruff format . && uvx ruff check .
uv run pytest && uv run mypy
cd web && pnpm check
```

All of it is offline: no key, no model download, no cost. `pnpm install` in `web/` also sets up a
pre-commit hook that formats what you stage and a commit-msg hook that checks the message.
`AGENTS.md` has the rest: where things live, the rules and why, and how commits are written.

## The rules that matter most

- **Nothing from your machine.** No keys, `.env` values, paths, IP addresses, downloaded models,
  datasets or run logs in a commit. Placeholders only.
- **Probabilities, not parsed text.** A readout scores the options; it never reads an answer out of
  generated words. Text answers exist only to be compared against it.
- **Core v1 is frozen.** Its items, fingerprints and scoring change only as a new version, so old
  results stay comparable.

Be decent to other people in issues and reviews. That is the whole code of conduct.
