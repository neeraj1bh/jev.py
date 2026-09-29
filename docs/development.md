# Development

```sh
uvx ruff format . && uvx ruff check .   # Python
cd web && pnpm check                    # the page: Biome, types and the build
uv run dev                              # the server and the page, reloading as you edit
```

`uv run dev` serves the page on port 3000 (or the next free one) and the server on 8080; `prod` uses
8080 alone. Both answer this machine only; `JEV_HOST=0.0.0.0` opens them to the local network.
`dev` runs on Linux, WSL and macOS.

| path | what |
|---|---|
| `src/jev/core.py` | the readout, the HTTP server and the self-check |
| `src/jev/remote.py` | hosted models and llama.cpp, read by letter |
| `src/jev/bench.py`, `benchmarks/` | Core v1: the frozen questions, models and token sizes |
| `src/jev/demo.py`, `web/` | the web page's server and its React front end |
| `src/jev/eval.py`, `results/` | the earlier evaluation and its summaries |
| `docs/` | the API by example, hosted providers, and local models on each system |

Saved runs, downloaded models and datasets stay on your machine and out of git.
