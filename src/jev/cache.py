"""Models already on this machine, in the Hugging Face cache or jev.py's models/ folder, whichever
tool downloaded them."""

import json
import os
import shutil

from huggingface_hub import scan_cache_dir

from jev.hub import CAUSAL


def _read(path):
    with open(path) as f:
        return json.load(f)


def runnable(files):
    """A complete chat model transformers can load: known architecture, chat template, all weights."""
    try:
        config, tokenizer = _read(files["config.json"]), _read(files["tokenizer_config.json"])
    except (KeyError, OSError, ValueError):
        return False
    if not any(a in CAUSAL for a in config.get("architectures") or []):
        return False
    if not (tokenizer.get("chat_template") or "chat_template.jinja" in files):
        return False
    if "model.safetensors" in files:
        return True
    index = files.get("model.safetensors.index.json")
    return bool(index) and set(_read(index)["weight_map"].values()) <= files.keys()


def on_disk(caches):
    """{model id: (cache folder, GB)} for every complete chat model in the given cache folders."""
    found = {}
    for cache in caches:
        if not os.path.isdir(cache):
            continue
        for repo in scan_cache_dir(cache).repos:
            if repo.repo_type != "model" or repo.repo_id in found or not repo.revisions:
                continue
            latest = max(repo.revisions, key=lambda r: r.last_modified)
            if runnable({f.file_name: f.file_path for f in latest.files}):
                found[repo.repo_id] = (cache, round(repo.size_on_disk / 1e9, 1))
    return found


def delete(model_id, caches):
    """Remove every downloaded revision of the model, and any partial download; returns the bytes
    freed."""
    freed = 0
    for cache in caches:
        folder = os.path.join(cache, "models--" + model_id.replace("/", "--"))
        if not os.path.isdir(folder):
            continue
        info = scan_cache_dir(cache)
        for repo in info.repos:
            if repo.repo_type == "model" and repo.repo_id == model_id:
                strategy = info.delete_revisions(*(r.commit_hash for r in repo.revisions))
                freed += strategy.expected_freed_size
                strategy.execute()
        if os.path.isdir(folder):  # what the hub leaves: partial downloads
            freed += sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(folder) for f in fs)
            shutil.rmtree(folder)
        shutil.rmtree(os.path.join(cache, ".locks", os.path.basename(folder)), ignore_errors=True)
    return freed
