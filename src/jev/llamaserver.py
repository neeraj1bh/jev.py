"""A llama-server that jev.py starts for a GGUF model picked in the page, and stops when another one
is picked or jev.py exits. One GGUF model runs at a time.

From WSL it can start the Windows build (llama-server.exe), which is how an AMD GPU is used: the
model path is given in Windows form, the server listens on every interface, and jev.py reaches
it at the Windows address."""

import atexit
import json
import os
import platform
import subprocess
import tempfile
import time
import urllib.request
from threading import Lock

PORT = 8082  # 8081 stays free for a llama-server started by hand
READY_SECONDS = 600  # a 30B model can take minutes to load from a slow disk
LOG = os.path.join(tempfile.gettempdir(), "jev-llama-server.log")
LOCK = Lock()
STATE = {"gguf": None, "process": None, "url": None}


def _wsl_to_windows():
    return "microsoft" in platform.release().lower()


def _windows_address():
    """The Windows host as WSL sees it: the default route."""
    routes = subprocess.run(["ip", "route"], capture_output=True, text=True, check=True).stdout
    return next(line.split()[2] for line in routes.splitlines() if line.startswith("default"))


def _ready(url):
    try:
        with urllib.request.urlopen(url + "/health", timeout=2) as r:
            return json.loads(r.read()).get("status") == "ok"
    except (OSError, ValueError):  # refused while starting, 503 while loading
        return False


def serve(gguf, binary):
    """The base URL of a llama-server running gguf, starting it (and stopping the last one) first."""
    with LOCK:
        running = STATE["process"]
        if STATE["gguf"] == gguf and running and running.poll() is None:
            return STATE["url"]
        stop()
        windows = _wsl_to_windows() and binary.lower().endswith(".exe")
        model = gguf
        if windows:
            model = subprocess.run(["wslpath", "-w", gguf], capture_output=True, text=True, check=True).stdout
        host = "0.0.0.0" if windows else "127.0.0.1"
        with open(LOG, "w") as log:
            process = subprocess.Popen(
                [
                    binary,
                    "-m",
                    model.strip(),
                    "--host",
                    host,
                    "--port",
                    str(PORT),
                    "-ngl",
                    "99",
                    "-c",
                    "8192",
                ],
                stdout=log,
                stderr=subprocess.STDOUT,
            )
        url = f"http://{_windows_address() if windows else '127.0.0.1'}:{PORT}"
        STATE.update(gguf=gguf, process=process, url=url)
        deadline = time.time() + READY_SECONDS
        while time.time() < deadline:
            if process.poll() is not None:
                stop()
                raise ValueError(f"llama-server stopped while loading {os.path.basename(gguf)}; see {LOG}")
            if _ready(url):
                return url
            time.sleep(1)
        stop()
        raise ValueError(f"llama-server was not ready after {READY_SECONDS // 60} minutes; see {LOG}")


def stop():
    process = STATE["process"]
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(10)
        except subprocess.TimeoutExpired:
            process.kill()
    STATE.update(gguf=None, process=None, url=None)


atexit.register(stop)
