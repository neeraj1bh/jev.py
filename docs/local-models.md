# Local models

jev.py runs local models in two ways. Both appear in the page's model menu.

| | Hugging Face model | llama.cpp server |
|---|---|---|
| Runs in | PyTorch, inside jev.py | `llama-server`, a separate process |
| Hardware | CPU, NVIDIA (CUDA), Apple Silicon (MPS) | CPU, NVIDIA (CUDA), Apple (Metal), AMD and Intel (Vulkan) |
| Weights | 16-bit, downloaded by jev.py | a GGUF file, usually 4-bit, downloaded by llama.cpp |
| Readout | each option's full text, up to 255 options | one letter per option, up to 26 options |
| Use it for | the default | an AMD GPU, or a model too large to load at 16-bit |

## Hugging Face models

The page lists three Qwen2.5 models (0.5B, 1.5B, 3B). Each downloads the first time it is picked.

To add any other chat model, choose **Add a model from Hugging Face** in the model menu and enter
its id, such as `Qwen/Qwen2.5-7B-Instruct`. The id is checked on the Hub first. These are refused,
with the reason:

- repositories with GGUF files only (use llama.cpp, below);
- models transformers cannot load as text generators (speech, vision-only, embeddings);
- base models without a chat template;
- gated models while no Hugging Face token is set.

Added models are remembered in `data/added-models.json`. The same id works from the terminal:

```sh
uv run jev serve Qwen/Qwen2.5-7B-Instruct   # API on :8080
uv run jev-eval Qwen/Qwen2.5-7B-Instruct    # public eval
```

Weights already in the Hugging Face cache are used in place. Everything else downloads to
`models/`; set `JEV_MODELS` to use another directory.

Gated models (Llama, Gemma) require accepting the licence on the model's Hub page, then a token:
`HF_TOKEN` under Keys in the page, or `hf auth login` for the terminal.

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
all interfaces:

```powershell
.\llama-server.exe -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M --port 8081 --host 0.0.0.0
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

## Models in the published results

The llama.cpp results in the README used Q4_K_M quantizations of
[Qwen2.5-7B](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF),
[Qwen2.5-14B](https://huggingface.co/Qwen/Qwen2.5-14B-Instruct-GGUF) and
[Qwen3-30B-A3B](https://huggingface.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF).
