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
| `src/jev/bench/`, `benchmarks/` | the labelled sets, Core v1 and its scoring |
| `src/jev/local/` | local models: downloading, finding and running them |
| `src/jev/page/`, `web/` | the web page's server and its React front end |
| `src/jev/bench/eval.py`, `results/` | the earlier evaluation and its summaries |
| `docs/` | the API by example, hosted providers, and local models on each system |

Saved runs, downloaded models and datasets stay on your machine and out of git.
