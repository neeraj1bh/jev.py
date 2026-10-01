"""uv run dev: the server and the page's dev server together, for working on either.

Edits to the page reload it at once; edits to the server's Python restart the server. Ctrl-C stops
both. This process loads no model, so it starts and stops quickly. It needs Linux, WSL or macOS: it
stops its children by process group, which native Windows lacks; there, use WSL or uv run prod.
"""

import contextlib
import ctypes
import os
import shutil
import signal
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCE = os.path.join(ROOT, "src", "jev")
WEB = os.path.join(ROOT, "web")
# The page's package manager, first found: pnpm (its lockfile is committed), npm or bun. Each entry
# installs the packages and runs a script from package.json.
MANAGERS = {
    "pnpm": (["pnpm", "install", "--frozen-lockfile"], ["pnpm", "run"]),
    "npm": (["npm", "install"], ["npm", "run"]),
    "bun": (["bun", "install"], ["bun", "run"]),
}
NO_NODE = "the page needs Node 20.19+ and one of pnpm, npm or bun; install them, then run this again"


def page_tools():
    """The page's script command, its packages installed first; None without Node."""
    name = next((m for m in MANAGERS if shutil.which(m)), None)
    if not name:
        return None
    # the full path, since Windows cannot start pnpm.cmd or npm.cmd by their bare names
    install, script = ([shutil.which(c[0]), *c[1:]] for c in MANAGERS[name])
    if not os.path.isdir(os.path.join(WEB, "node_modules")):
        subprocess.run(install, cwd=WEB, check=True)
    return script


def newest():
    """When the server's code last changed."""
    return max(
        os.path.getmtime(os.path.join(folder, f))
        for folder, _, files in os.walk(SOURCE)
        for f in files
        if f.endswith(".py")
    )


def die_with_parent():
    """Linux asks the kernel to stop this child when the launcher dies without stopping it (killed,
    crashed, its window closed); left running, the two held their ports and the next start moved to
    3001, 3002. macOS has no such call; there Ctrl-C still stops both."""
    with contextlib.suppress(AttributeError, OSError):
        ctypes.CDLL(None).prctl(1, signal.SIGTERM)  # 1 is PR_SET_PDEATHSIG


def start(command, cwd=ROOT):
    # its own process group, so Ctrl-C reaches only this process, which then stops each child whole
    return subprocess.Popen(command, cwd=cwd, start_new_session=True, preexec_fn=die_with_parent)


def stop(process):
    with contextlib.suppress(ProcessLookupError):  # it may have exited already
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def main():
    if os.name == "nt":
        raise SystemExit("uv run dev needs Linux, WSL or macOS; on Windows use WSL, or uv run prod")
    # Ctrl-C, SIGTERM and closing the terminal (SIGHUP) all stop both children, even where the shell
    # started this with Ctrl-C ignored
    signal.signal(signal.SIGINT, signal.default_int_handler)
    for stopped in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(stopped, lambda *_: sys.exit(0))
    if not page_tools():
        raise SystemExit(NO_NODE)
    serve = [sys.executable, "-c", "from jev.page.server import cli; cli(build=False)", *sys.argv[1:]]
    # vite itself, not through the package manager, so stopping it cannot leave vite running
    page = start([os.path.join(WEB, "node_modules", ".bin", "vite")], WEB)
    server, seen = start(serve), newest()
    try:
        while True:
            time.sleep(1)
            if newest() != seen:
                seen = newest()
                print("the server's code changed; restarting it", flush=True)
                stop(server)
                server = start(serve)
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN)  # a second Ctrl-C must not cut the shutdown short
        stop(server)
        stop(page)
        print("stopped")
