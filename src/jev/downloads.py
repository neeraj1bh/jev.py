"""Model downloads the page can follow, stop and resume.

huggingface_hub starts every interrupted download over, so the weights (.safetensors, nearly all
of a model's size) are fetched here with HTTP range requests into a .part file that the next try
continues. Each finished file is stored where the Hugging Face cache expects it, and
snapshot_download then fetches the small files and links the weights without downloading them
again."""

import os
from collections import defaultdict
from threading import Lock

import httpx
from huggingface_hub import HfApi, hf_hub_url, snapshot_download
from huggingface_hub.utils import build_hf_headers

# What transformers reads for a safetensors model: no .bin, .gguf, ONNX or remote code.
WEIGHTS = ["*.json", "*.safetensors", "*.txt", "*.model", "*.tiktoken", "*.jinja"]
CHUNK = 1 << 20
LOCKS = defaultdict(Lock)  # one download per model; different models download side by side
STOPPED = set()


class Stopped(Exception):
    pass


def fetch(model_id, cache_dir, progress):
    """Download the model into cache_dir, keeping progress[model_id] = [done, total, "bytes"]."""
    with LOCKS[model_id]:
        STOPPED.discard(model_id)
        progress[model_id] = [0, 0, "bytes"]
        try:
            info = HfApi().model_info(model_id, files_metadata=True)
            weights = [f for f in info.siblings if f.lfs and f.rfilename.endswith(".safetensors")]
            total = sum(f.lfs.size for f in weights)
            blobs = os.path.join(cache_dir, "models--" + model_id.replace("/", "--"), "blobs")
            os.makedirs(blobs, exist_ok=True)
            done = 0
            for f in weights:
                blob = os.path.join(blobs, f.lfs.sha256)  # the cache names a weights file by its hash
                if not os.path.exists(blob):
                    _resume(
                        model_id,
                        hf_hub_url(model_id, f.rfilename, revision=info.sha),
                        blob,
                        progress,
                        done,
                        total,
                    )
                if os.path.getsize(blob) != f.lfs.size:
                    raise ValueError(f"{f.rfilename} is the wrong size; delete the model and try again")
                done += f.lfs.size
            snapshot_download(model_id, revision=info.sha, cache_dir=cache_dir, allow_patterns=WEIGHTS)
        finally:
            progress.pop(model_id, None)
            STOPPED.discard(model_id)


def _resume(model_id, url, blob, progress, done, total):
    """One file, continued from its .part file when there is one."""
    part = blob + ".part"
    have = os.path.getsize(part) if os.path.exists(part) else 0
    headers = build_hf_headers() | ({"Range": f"bytes={have}-"} if have else {})
    with httpx.stream("GET", url, headers=headers, follow_redirects=True, timeout=60) as response:
        response.raise_for_status()
        if response.status_code != 206:  # the server sent the whole file: start the part over
            have = 0
        with open(part, "ab" if have else "wb") as out:
            for chunk in response.iter_bytes(CHUNK):
                if model_id in STOPPED:
                    raise Stopped(f"Stopped downloading {model_id}. It continues from there next time.")
                out.write(chunk)
                have += len(chunk)
                progress[model_id] = [done + have, total, "bytes"]
    os.replace(part, blob)


def stop(model_id):
    STOPPED.add(model_id)
