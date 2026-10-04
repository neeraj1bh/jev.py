"""API keys and server addresses: which are set, checking one with a small request, and saving
it to .env."""

import os
import urllib.error
import urllib.parse
import urllib.request

from jev.core import ROOT
from jev.page.models import LOADED, get, laya_up, llamacpp_up
from jev.remote import ADDRESS, BACKENDS, env

OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key"

# Everything the Keys view lists: .env name -> (label, what it unlocks, where to get it)
KEYS = {
    "TYPESAFE_API_KEY": ("TypeSafe (Jev)", "Jev itself", "https://typesafe.ai"),
    "DEEPSEEK_API_KEY": ("DeepSeek", "the direct DeepSeek API", "https://platform.deepseek.com"),
    "MOONSHOT_API_KEY": ("Kimi", "the direct Kimi API", "https://platform.moonshot.ai"),
    "OPENAI_API_KEY": ("OpenAI", "the direct OpenAI API", "https://platform.openai.com"),
    "OPENROUTER_API_KEY": ("OpenRouter", "every OpenRouter model", "https://openrouter.ai/keys"),
    "AI_GATEWAY_API_KEY": ("Vercel AI Gateway", "Jev through Vercel", "https://vercel.com/ai-gateway"),
    "HF_TOKEN": (
        "Hugging Face",
        "sets behind a login, such as GPQA",
        "https://huggingface.co/settings/tokens",
    ),
    "LLAMACPP_URL": ("llama.cpp server", "a llama-server address instead of the default", ""),
    "LAYA_URL": ("Laya server", "a laya-serve address instead of the default", ""),
}
HF_WHOAMI = "https://huggingface.co/api/whoami-v2"


def keys():
    """Which keys are set; never their values."""
    backend = {v[0]: "remote:" + b for b, v in BACKENDS.items() if v[0]}
    return [
        {"var": var, "label": label, "unlocks": unlocks, "url": url, "set": bool(env(var)),
         "backend": backend.get(var)}
        for var, (label, unlocks, url) in KEYS.items()
    ]  # fmt: skip


def check_key(name, key):
    """One tiny request that fails if the key or address is wrong."""
    server = {var: backend for backend, var in ADDRESS.items()}.get(name)
    if server and urllib.parse.urlparse(key).path != urllib.parse.urlparse(BACKENDS[server][1]).path:
        raise ValueError(f"Give the whole address, such as {BACKENDS[server][1]}")
    if name == "HF_TOKEN":
        request = urllib.request.Request(HF_WHOAMI, headers={"authorization": "Bearer " + key})
        urllib.request.urlopen(request, timeout=15).close()
    elif name == "LLAMACPP_URL":
        if not llamacpp_up(key, timeout=5):
            raise ValueError("no llama-server answered at that address")
    elif name == "LAYA_URL":
        if not laya_up(key, timeout=5):
            raise ValueError("that address did not answer as a laya-serve")
    elif name == "remote:openrouter":  # its key endpoint checks the key alone, whatever a model can do
        request = urllib.request.Request(OPENROUTER_KEY_URL, headers={"Authorization": "Bearer " + key})
        urllib.request.urlopen(request, timeout=15).close()
    else:
        get(name).ask({"text": "hello"}, {"q": {"type": "noul", "instructions": "Is this a greeting?"}})


def key_target(name):
    """The backend id (or None) and .env name for a backend id or a KEYS name."""
    bid = (
        name if name.startswith("remote:") else next((k["backend"] for k in keys() if k["var"] == name), None)
    )
    if bid is None and name not in KEYS:
        raise ValueError(f"unknown key {name}")
    return bid, BACKENDS[bid.split(":", 1)[1]][0] if bid else name


def forget_address(var):
    """Drop every model that answers from this server address, pinned ones included, so the next
    request reads the address again."""
    for backend, address in ADDRESS.items():
        if var == address:
            for bid in [b for b in LOADED if b == f"remote:{backend}" or b.startswith(f"remote:{backend}:")]:
                LOADED.pop(bid, None)


def clear_key(name):
    """Forget a key: out of this session and out of .env, with the note saved above it."""
    bid, var = key_target(name)
    os.environ.pop(var, None)
    LOADED.pop(bid, None)
    forget_address(var)
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path) as f:
        lines = f.read().splitlines()
    label = KEYS.get(var, (var,))[0]
    out = []
    for line in lines:
        if line.partition("=")[0].strip() == var:
            if out and out[-1].startswith(f"# {label}:"):
                out.pop()
            continue
        out.append(line)
    with open(path, "w") as f:
        f.write("\n".join(out) + "\n")


def set_key(name, key, save):
    """Use a key typed into the page: test it with one tiny request, then keep it for this
    session and, if asked, write it to .env (git-ignored). A rejected key changes nothing.
    `name` is a backend id such as remote:deepseek, or a KEYS name such as HF_TOKEN."""
    bid, var = key_target(name)
    old = os.environ.get(var)
    os.environ[var] = key
    LOADED.pop(bid, None)
    forget_address(var)

    def undo():
        if old is None:
            os.environ.pop(var, None)
        else:
            os.environ[var] = old
        LOADED.pop(bid, None)

    try:
        check_key(bid or var, key)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):  # only these say the key is wrong; anything else is the model or the route
            undo()
            raise
    except Exception:
        undo()
        raise
    if save:
        path = os.path.join(ROOT, ".env")
        lines = []
        if os.path.exists(path):
            with open(path) as f:
                lines = f.read().splitlines()
        at = next((i for i, x in enumerate(lines) if x.partition("=")[0].strip() == var), None)
        if at is None:
            label, unlocks, url = KEYS.get(var, (var, "", ""))
            lines.append(f"# {label}: {unlocks}" + (f" — {url}" if url else ""))
            lines.append(f"{var}={key}")
        else:
            lines[at] = f"{var}={key}"
        with open(path, "w") as f:
            f.write("\n".join(lines) + "\n")
