"""Reading the labelled sets from the Hugging Face Hub, and TypeSafe's published cases: fetching a
set's rows once, which rows it keeps, and how a row becomes a request with its truth."""

import json
import os
import random
import time
import urllib.error
import urllib.request

from jev.bench.sets import SETS, MultipleChoice
from jev.core import ROOT
from jev.local.downloads import PROGRESS
from jev.remote import env

DATA = os.path.join(ROOT, "data")  # rows fetched from the Hub, git-ignored
ROWS = "https://datasets-server.huggingface.co/rows?dataset={}&config={}&split={}&offset={}&length={}"
POOL = 300  # rows of a larger split kept on disk
FULL_ROWS = 3300  # a split this small is kept whole
TYPESAFE_WORKFLOWS = (
    "security_incidents",
    "agent_trace_observability",
    "invoice_processing",
    "customer_service",
)


def dataset_path(name):
    return os.path.join(DATA, name.replace(" ", "-").lower() + ".json")


def rows_page(hub, config, split, offset, length=100):
    """One page of up to 100 rows; HF_TOKEN, when set, opens sets that need a Hub login."""
    token = env("HF_TOKEN")
    req = urllib.request.Request(
        ROWS.format(hub, config, split, offset, length),
        headers={"authorization": f"Bearer {token}"} if token else {},
    )
    for attempt in range(7):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) or (e.code == 404 and token):  # the Hub hides gated sets as 404
                raise ValueError(
                    f"{hub} is behind a login: accept its terms at https://huggingface.co/datasets/{hub}"
                    + ("" if token else ", then add a Hugging Face token under Keys")
                ) from e
            if e.code not in (429, 500, 502, 503, 504) or attempt == 6:
                raise
            # The Hub rate-limits, and its rows service fails now and then under load. Fetching a
            # whole split takes hundreds of pages, so back off for up to a few minutes.
            time.sleep(float(e.headers.get("retry-after") or min(60, 5 * 2**attempt)))


REVISIONS = {}  # Hub dataset -> its current commit, read once per process


def revision(hub, fresh=False):
    """The dataset's current commit on the Hub, recorded with every pool and pick."""
    if fresh or hub not in REVISIONS:
        token = env("HF_TOKEN")
        req = urllib.request.Request(
            f"https://huggingface.co/api/datasets/{hub}",
            headers={"authorization": f"Bearer {token}"} if token else {},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            REVISIONS[hub] = json.load(r)["sha"]
    return REVISIONS[hub]


def download(name):
    """A set's pool, fetched once into DATA with the Hub revision it came from. A split of up to
    FULL_ROWS rows, or a full set, is kept whole. A larger one is read as seeded windows: a short
    run of rows from each equal stretch of the split, since some splits are sorted by label."""
    path = dataset_path(name)
    if not os.path.exists(path):
        hub = SETS[name].hub
        for _ in range(2):  # a pool read while the dataset changed is read again, once
            before = revision(hub, fresh=True)
            pool = read_pool(name)
            if revision(hub, fresh=True) == before:
                break
        else:
            raise ValueError(f"{hub} changed on the Hub twice while {name} was downloading; try later")
        os.makedirs(DATA, exist_ok=True)
        with open(path, "w") as f:
            json.dump(pool | {"revision": before}, f)
    with open(path) as f:
        return json.load(f)


def read_pool(name):
    s = SETS[name]
    first = rows_page(s.hub, s.config, s.split, 0, 1)
    total = first["num_rows_total"]
    if total <= FULL_ROWS or s.full:
        rule, seed, size = "full", None, 100
        starts = list(range(0, total, size))
    else:
        rule, seed, size, stretch = (
            f"{s.windows} seeded windows",
            f"pool:{name}",
            POOL // s.windows,
            total / s.windows,
        )
        rng = random.Random(seed)
        starts = [int(k * stretch + rng.random() * (stretch - size)) for k in range(s.windows)]
    PROGRESS[name] = [0, len(starts), "pages"]
    rows = []
    try:
        for start in starts:
            rows += rows_page(s.hub, s.config, s.split, start, size)["rows"]
            PROGRESS[name][0] += 1
    finally:
        PROGRESS.pop(name, None)
    return {
        "features": first["features"], "rows": rows, "rule": rule, "seed": seed, "total": total,
        "starts": starts, "size": size,
    }  # fmt: skip


def labelled_rows(name, page):
    """The rows of a downloaded page that carry a label (SNLI marks unlabelled pairs -1) and that
    the set keeps."""
    s = SETS[name]
    rows = [r for r in page["rows"] if s.keep(r["row"])] if s.keep else page["rows"]
    if isinstance(s, MultipleChoice) or callable(s.label):
        return rows
    return [r for r in rows if r["row"][s.label] != -1]


def _criteria(s, options):
    return {o: (s.describe or {}).get(o) for o in options}


def row_item(name, page, r):
    """One downloaded row as a request with its truth."""
    s = SETS[name]
    row = r["row"]
    source = f"{s.hub} · {s.split} row {r['row_idx']}"
    if isinstance(s, MultipleChoice):
        options, answer = s.options_of(row)
        if s.scored:
            q, truth = {"type": "score", "instructions": s.question, "criteria": options}, str(answer)
        else:
            q = {"type": "choice", "instructions": s.question, "criteria": _criteria(s, options)}
            truth = options[answer]
        state, count = s.state(row), len(options)
    else:
        if callable(s.label):
            names, value = None, s.label(row)
        else:
            names = next(x["type"].get("names") for x in page["features"] if x["name"] == s.label)
            value = names[row[s.label]] if names else row[s.label]
        if s.yes is not None:
            q = {"type": "noul", "instructions": s.question}
            truth = "yes" if value == s.yes else "no"
        else:
            q = {"type": "choice", "instructions": s.question, "criteria": _criteria(s, names)}
            truth = value
        state, count = {k: row[v] for k, v in s.fields.items()}, 2 if s.yes is not None else len(names)
    return {
        "state": state,
        "questions": {"answer": q},
        "truth": {"answer": truth},
        "source": source,
        "options": count,
    }


def typesafe_rows():
    """TypeSafe's published eval cases: document, questions and consensus label.

    Fetched from evals.typesafe.ai on first use into results/typesafe/ (git-ignored). Only the
    case id and our answers reach the log. The consensus is the mean of the two reference sets.
    """
    cache = os.path.join(ROOT, "results", "typesafe")
    os.makedirs(cache, exist_ok=True)
    rows = []
    for wf in TYPESAFE_WORKFLOWS:
        path = os.path.join(cache, wf + ".js")
        if not os.path.exists(path):
            req = urllib.request.Request(
                f"https://evals.typesafe.ai/{wf}-cases.js", headers={"User-Agent": "Mozilla/5.0"}
            )
            with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
                f.write(r.read())
        with open(path) as f:
            raw = f.read()
        ev = json.loads(raw[raw.index("(") + 1 : raw.rindex(")")])["eval"]
        for cid, case in ev["cases"].items():
            refs = case["reference_answers"]
            for node in case["models"]["typesafe"]["nodes"]:
                if node["doc"] is None or node["node"] not in refs:
                    continue
                qs = {
                    qid: ev["questions"][i]
                    for qid, i in node["questions"].items()
                    if qid in refs[node["node"]]
                }
                truth = {}
                for qid in qs:
                    sets = refs[node["node"]][qid]["sets"]
                    if all(x.get("probabilities") for x in sets):
                        keys = {k for x in sets for k in x["probabilities"]}
                        mean = {k: sum(x["probabilities"].get(k, 0) for x in sets) / len(sets) for k in keys}
                        truth[qid] = max(mean, key=mean.get)
                    else:  # a value without a distribution
                        truth[qid] = str(sets[0]["value"]).lower()
                rows.append((f"{wf}/{cid}", node["node"], ev["documents"][node["doc"]], qs, truth))
    return rows


def typesafe_item(case, node, doc, qs, truth):
    """One TypeSafe step: its document and every question on it, each with its consensus label."""
    return {
        "state": doc,
        "questions": qs,
        "truth": {k: {"true": "yes", "false": "no"}.get(v, v) for k, v in truth.items()},
        "source": f"TypeSafe · {case} · {node}",
        "options": None,
    }
