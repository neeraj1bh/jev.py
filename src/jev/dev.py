"""uv run dev: the server and the page's dev server together, for working on either.

Edits to the page reload it at once; edits to the server's Python restart the server. Ctrl-C stops
both. This process loads no model, so it starts and stops quickly.
"""

import contextlib
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
# installs the packages, runs a script from package.json, and runs a package's own command.
MANAGERS = {
    "pnpm": (["pnpm", "install", "--frozen-lockfile"], ["pnpm", "run"], ["pnpm", "exec"]),
    "npm": (["npm", "install"], ["npm", "run"], ["npx"]),
    "bun": (["bun", "install"], ["bun", "run"], ["bunx"]),
}
NO_NODE = "the page needs Node 20.19+ and one of pnpm, npm or bun; install them, then run this again"


def page_tools():
    """The page's install, script and exec commands, its packages installed first; None without Node."""
    name = next((m for m in MANAGERS if shutil.which(m)), None)
    if not name:
        return None
    install, script, run = MANAGERS[name]
    if not os.path.isdir(os.path.join(WEB, "node_modules")):
        subprocess.run(install, cwd=WEB, check=True)
    return script, run


def newest():
    """When the server's code last changed."""
    return max(os.path.getmtime(os.path.join(SOURCE, f)) for f in os.listdir(SOURCE) if f.endswith(".py"))


def start(command, cwd=ROOT):
    # its own process group, so Ctrl-C reaches only this process, which then stops each child whole
    return subprocess.Popen(command, cwd=cwd, start_new_session=True)


def stop(process):
    with contextlib.suppress(ProcessLookupError):  # it may have exited already
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def main():
    # Ctrl-C, SIGTERM and closing the terminal (SIGHUP) all stop both children, even where the shell
    # started this with Ctrl-C ignored
    signal.signal(signal.SIGINT, signal.default_int_handler)
    for stopped in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(stopped, lambda *_: sys.exit(0))
    tools = page_tools()
    if not tools:
        raise SystemExit(NO_NODE)
    serve = [sys.executable, "-c", "from jev.demo import cli; cli(build=False)", *sys.argv[1:]]
    page = start([*tools[1], "vite"], WEB)
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
