# Local models

jev.py runs local models in two ways. Both appear in the page's model menu. A third kind of
local model, [Laya](#laya), is its own server.

| | Hugging Face model | llama.cpp server |
|---|---|---|
| Runs in | PyTorch, inside jev.py | `llama-server`, a separate process |
| Hardware | CPU, NVIDIA (CUDA), Apple Silicon (MPS) | CPU, NVIDIA (CUDA), Apple (Metal), AMD and Intel (Vulkan) |
| Weights | 16-bit, downloaded by jev.py | a GGUF file, usually 4-bit, downloaded by llama.cpp |
| Readout | each option's full text, up to 255 options | one letter per option, up to 26 options |
| Use it for | the default | an AMD GPU, or a model too large to load at 16-bit |

## Hugging Face models

### What the menu lists

- **Models already on this machine.** Every complete chat model in the Hugging Face cache
  (`~/.cache/huggingface/hub`, or `HF_HUB_CACHE`) and in `models/` (or `JEV_MODELS`), whichever
  tool downloaded it. Partial downloads, embedding, speech and vision-only models are skipped.
- **Models added in the page,** remembered in `data/added-models.json`.
- **Three starters** (Qwen2.5 0.5B, 1.5B and 3B), until three models are on disk.

### Adding one

**Add a model from Hugging Face** in the model menu opens a dialog with a few small starter models
and a field for any model id, such as `Qwen/Qwen2.5-7B-Instruct`. Each starter shows the memory it
needs on this machine: about 1.3× its download size at 16 bits (NVIDIA, most recent CPUs), 2.6× at
32 bits (Apple Silicon, older CPUs). The id is checked on the Hub first. These are refused, with the
reason:

- repositories with GGUF files only (use llama.cpp, below);
- models transformers cannot load as text generators (speech, vision-only, embeddings);
- base models without a chat template;
- gated models while no Hugging Face token is set.

Gated models (Llama, Gemma) require accepting the licence on the model's Hub page, then a token:
`HF_TOKEN` under Keys in the page, or `hf auth login` for the terminal.

### Downloading, stopping, deleting

A model downloads the first time it runs, into `models/`. The bar at the bottom right shows the
progress, also after a reload. **Stop** keeps the partial file, and the next try continues from
there. The bin beside a downloaded model deletes its files; one in the shared Hugging Face cache is
gone for other tools too.

The same ids work from the terminal:

```sh
uv run jev serve Qwen/Qwen2.5-7B-Instruct   # API on :8080
uv run jev-eval Qwen/Qwen2.5-7B-Instruct    # public eval
```

## Models in other folders

Models already somewhere else on the machine can be listed without copying them: in **Add a
model**, under *From a folder on this machine*, choose **Choose a folder…** and click through to it.
The browser starts at the home folder and lists the drives (`/mnt/c`, `/mnt/d` in WSL, `/Volumes`
on a Mac, `/media` on Linux, `C:\` on Windows). A folder is marked when it holds a model within
two levels, or leads to one the page already knows about, however deep (such as `.cache` on the way
to the Hugging Face cache); hidden folders show on request, or when they lead to models. The
folders are remembered in `data/model-folders.json`, and the menu lists what they hold:

- **Hugging Face model folders** (a `config.json` and `.safetensors` weights) under *On this
  machine*; they run through PyTorch like any other.
- **GGUF files** under *GGUF files · llama.cpp*. Split files (`-00001-of-00003.gguf`) count as one
  model. They need llama.cpp's `llama-server`: one on the PATH is found by itself, otherwise
  **Choose llama-server…** picks the program the same way. Picking a GGUF model starts llama-server
  with it, sized to fit the GPU's memory. The ■ beside a running model, in the header or the menu,
  stops it and frees its memory; it also stops after 15 minutes unused, and when jev.py exits.

Each GGUF model gets its own llama-server, so two of them answer without taking turns; the second
is sized to the memory the first leaves free. Models running together may take about 70% of the
machine's memory, after which the one used longest ago is stopped to make room. From WSL, the Windows `llama-server.exe` works:
jev.py passes it Windows paths and reaches it at the Windows address, as below.

## llama.cpp

The page detects a `llama-server` on `localhost:8081` and lists it as **llama.cpp server**. A
server holds one model; restart it to switch. The `-hf` flag downloads the GGUF from the Hub on
first use and caches it.

### macOS and Linux

```sh
brew install llama.cpp
llama-server -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M --port 8081
```

Without Homebrew, download a build from the
[llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases): CUDA for NVIDIA, Vulkan for
AMD or Intel.

### Windows

Download the Vulkan or CUDA build from the releases, then in PowerShell:

```powershell
.\llama-server.exe -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M --port 8081
```

### WSL with llama-server on Windows

Use this setup for an AMD GPU: PyTorch in WSL cannot reach it, but the Vulkan build on Windows can.

Under WSL's default (NAT) networking, `localhost` inside WSL is not Windows. Start the server on
the Windows side of the WSL link, at the address found below (`--host 0.0.0.0` works too, but also
opens it to the local network):

```powershell
.\llama-server.exe -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M --port 8081 --host <windows-address>
```

Find the Windows address from WSL:

```sh
ip route | awk '/default/ {print $3}'   # e.g. <windows-address>
```

Set `http://<address>:8081/v1/chat/completions` as the llama.cpp address under Keys, or as
`LLAMACPP_URL` in `.env`. Allow `llama-server.exe` through the Windows firewall when prompted.
The address can change after Windows restarts.

Alternatively, enable mirrored networking so that `localhost:8081` reaches Windows directly. Add
this to `%UserProfile%\.wslconfig`, then run `wsl --shutdown`:

```ini
[wsl2]
networkingMode=mirrored
```

## Verify

```sh
curl localhost:8081/health     # {"status":"ok"}
uv run jev-remote llamacpp     # self-check through llama.cpp
```

## Laya

[Laya](https://github.com/NandhaKishorM/laya) is an open encoder that answers the same typed
questions in one pass, with no text generated. It runs as its own server and speaks TypeSafe's
request and answer shapes, so jev.py passes each item straight through and reads nothing by letter.

```sh
pip install "laya[serve]"
LAYA_HOST=127.0.0.1 laya-serve     # port 8000; downloads a checkpoint on first use
curl localhost:8000/health         # {"status":"ok","loaded":[...], ...}
uv run jev-remote laya             # self-check through Laya
```

The page lists **Laya** under Local server while a `laya-serve` answers on port 8000. For another
address, set it under Keys or as `LAYA_URL` in `.env`. The model is Laya's English checkpoint;
`remote:laya:typed-decisions` and `remote:laya:multilingual` pin its other two. Two things to know
when comparing it with the other models:

- Its `confidence` is one minus the normalised entropy of the answer, not the margin jev.py and Jev
  report, so a confidence threshold does not carry over. The probabilities do.
- Its makers list spam, phishing and news-topic sets as training data, so its score on those says
  less than on sets it has not seen.

## Models in the published results

The llama.cpp results in [benchmark.md](benchmark.md) used Q4_K_M quantizations of
[Qwen2.5-7B](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF),
[Qwen2.5-14B](https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF) and
[Qwen3-30B-A3B](https://huggingface.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF).
