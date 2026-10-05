"""Core v1: a frozen pick of items from every set in the page, stored as pointers.

Each set gives 50 items, or one per topic when it has more topics than that. The picks take turns
across the set's own topics (MMLU's subjects, RewardBench's subsets) and keep its answers even, so
no subject, label or answer position dominates.

The file keeps each item's dataset, split, row number and a fingerprint, never its text, so the
repo redistributes nothing and anyone can rebuild the same items from the Hub. Sets whose
questions have more than 26 options form a separate "wide" part: letter-reading backends cannot
answer them, and keeping them apart keeps the main comparison paired across every model.

    uv run jev-bench freeze                        # add sets not in benchmarks/core-v1.json yet
    uv run jev-bench run remote:deepseek           # one model; letter readers skip wide
    uv run jev-bench run Qwen/Qwen2.5-1.5B-Instruct  # local models answer every item
    uv run jev-bench export                        # every item as text, for reviewers
    uv run jev-bench tokens                        # input tokens per item, for cost estimates
    uv run jev-bench score <run.jsonl> ...         # Core v1 scores of saved runs, by track

Each run is saved like a batch from the page, so Past runs lists it and can compare runs side by side.
"""

import hashlib
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

from jev import remote
from jev.bench import datasets
from jev.bench.picks import FIRST, PER_SET, pick, usable
from jev.bench.sets import SETS
from jev.core import ROOT
from jev.local.downloads import PROGRESS
from jev.page import models, runs
from jev.remote import PROMPT_VERSION

NAME = "core-v1"
PATH = os.path.join(ROOT, "benchmarks", f"{NAME}.json")
TOKENS_PATH = os.path.join(ROOT, "benchmarks", f"{NAME}-tokens.json")
ROWS_PATH = os.path.join(datasets.DATA, f"{NAME}-rows.json")  # picked rows fetched from the Hub, git-ignored
STOP = Event()  # set by the page's Stop: the download ends before its next page
TOKENIZER = "Qwen/Qwen2.5-0.5B-Instruct"
LETTER_LIMIT = 26
DATASET = "Core v1"
HOSTED_WORKERS = 8
# TypeSafe questions review found unanswerable from their step (a needed fact is missing, or the
# rubric allows two answers); each step keeps its other questions
TYPESAFE_OMIT = {
    ("agent_trace_observability/trace_e2ab80ce644dc6a4d4ea02cfcffcccee", "safety_1"): ["within_grant"],
    ("invoice_processing/ap_00074", "semantic"): ["line_3_scope", "line_3_completion"],
    ("invoice_processing/ap_00246", "semantic"): ["price_basis", "billed_above_basis"],
    ("customer_service/retention-sarcastic-sure-whatever/t0", "triage"): ["desired_outcome"],
    ("customer_service/billing-overdraft-no-food/t1", "money"): ["refund_reason"],
}
AUXILIARY = {  # reported beside the headline, not in it
    "IMDB", "AG News topic", "DBpedia-14", "Arena votes", "MuSR murder mysteries",
    "Global-MMLU-Lite English",
}  # fmt: skip
REWARDBENCH_FAMILIES = {  # its score is the mean of these, each the mean of its items
    "Chat": ["alpacaeval-easy", "alpacaeval-length", "alpacaeval-hard", "mt-bench-easy", "mt-bench-med"],
    "Chat Hard": [
        "mt-bench-hard", "llmbar-natural", "llmbar-adver-neighbor", "llmbar-adver-GPTInst",
        "llmbar-adver-GPTOut", "llmbar-adver-manual",
    ],
    "Safety": [
        "refusals-dangerous", "refusals-offensive", "xstest-should-refuse", "xstest-should-respond",
        "donotanswer",
    ],
    "Reasoning": ["math-prm", "hep-cpp", "hep-go", "hep-java", "hep-js", "hep-python", "hep-rust"],
}  # fmt: skip


def fingerprint(item, prompt_version=PROMPT_VERSION):
    """A short hash of what the model is asked, in order, and the answer it is scored against. The
    prompt version counts too: a new prompt asks the same item differently."""
    text = json.dumps([item["state"], item["questions"], item["truth"], prompt_version], ensure_ascii=False)
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def typesafe_step(case, node, doc, questions, truth, omit=()):
    """One TypeSafe step as Core v1 asks it, without its omitted questions."""
    unknown = set(omit) - set(questions)
    if unknown:
        raise ValueError(f"TypeSafe {case} {node} has no question {', '.join(sorted(unknown))}")
    item = datasets.typesafe_item(case, node, doc, questions, truth)
    return item | {
        "questions": {k: v for k, v in item["questions"].items() if k not in omit},
        "truth": {k: v for k, v in item["truth"].items() if k not in omit},
    }


def manifest(name, options):
    """How a set is reported: its track, group, provenance and whether it needs outside knowledge."""
    if options > LETTER_LIMIT:
        track = "wide"
    elif SETS[name].scored:
        track = "ordinal"
    else:
        track = "auxiliary" if name in AUXILIARY else "headline"
    record = SETS[name]
    out = {
        "track": track,
        "group": record.group,
        "knowledge": record.knowledge,
        "provenance": record.provenance,
    }
    return out | ({"families": REWARDBENCH_FAMILIES} if name == "RewardBench" else {})


def freeze():
    """Pick items for every set not in the file yet; sets already frozen keep their items."""
    frozen = {}
    if os.path.exists(PATH):
        with open(PATH) as f:
            frozen = json.load(f)["sets"]
    names = list(SETS)
    names = [*FIRST, *(n for n in names if n not in FIRST)]
    sets, before = {}, {}
    for name in [*(n for n in frozen if n in names), *(n for n in names if n not in frozen)]:
        pool = datasets.download(name) if name not in frozen or name in FIRST else None
        if name in frozen:
            sets[name] = frozen[name]
            if name in FIRST:  # the sets that depend on it read its rows
                rows = {i["row"] for i in frozen[name]["items"]}
                before[name] = [(r, None) for r in pool["rows"] if r["row_idx"] in rows]
            continue
        pairs = usable(
            name, [(r, datasets.row_item(name, pool, r)) for r in datasets.labelled_rows(name, pool)]
        )
        picked, extra = pick(name, pairs, before, f"{NAME}:{name}")
        before[name] = picked
        options = SETS[name].options
        record = {k: pool[k] for k in ("rule", "seed", "total", "revision", "starts", "size")}
        sets[name] = {
            "hub": SETS[name].hub,
            "config": SETS[name].config,
            "split": SETS[name].split,
            "part": "wide" if options > LETTER_LIMIT else "main",
            "options": options,
            "pool": record,
            **manifest(name, options),
            **({"pick": extra} if extra else {}),
            "items": sorted(
                ({"row": r["row_idx"], "sha": fingerprint(item)} for r, item in picked),
                key=lambda x: x["row"],
            ),
        }
        print(f"{name}: {len(picked)} items", flush=True)
    steps = []
    for case, node, doc, questions, truth in datasets.typesafe_rows():
        omit = TYPESAFE_OMIT.get((case, node), [])
        sha = fingerprint(typesafe_step(case, node, doc, questions, truth, omit))
        steps.append({"case": case, "node": node, "sha": sha} | ({"omit": omit} if omit else {}))
    if missing := set(TYPESAFE_OMIT) - {(s["case"], s["node"]) for s in steps}:
        raise ValueError(f"TypeSafe has no step {sorted(missing)}")
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    with open(PATH, "w") as f:
        json.dump(
            {
                "name": NAME,
                "status": "Review 2's replacements and omissions applied; the changed questions await "
                "their review (see README)",
                "frozen": time.strftime("%Y-%m-%d"),
                "prompt_version": PROMPT_VERSION,
                "per_set": PER_SET,
                "sets": sets,
                "typesafe": steps,
            },
            f,
            indent=1,
        )
    main = sum(len(s["items"]) for s in sets.values() if s["part"] == "main")
    wide = sum(len(s["items"]) for s in sets.values() if s["part"] == "wide")
    print(f"{os.path.relpath(PATH, ROOT)}: {main} main items and {len(steps)} TypeSafe steps, {wide} wide")


def cached_rows():
    """Picked rows fetched before, by set: {revision, features, rows}."""
    try:
        with open(ROWS_PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def pool_revision(path):
    """A pool file's revision, read from its last bytes (a pool ends with it) so the whole file is
    not parsed; "" for a missing file or one written before revisions were recorded."""
    try:
        with open(path, "rb") as f:
            f.seek(max(0, os.path.getsize(path) - 200))
            tail = f.read().decode(errors="ignore")
    except OSError:
        return ""
    found = re.search(r'"revision": "([0-9a-f]+)"}\s*$', tail)
    return found.group(1) if found else ""


def on_disk(name, spec, cache):
    """Whether a set's rows are already here at the recorded revision: its picked rows, or its full
    pool. Offline and cheap, for telling the page what a first use will fetch: load reads exactly
    these sets from disk, without asking the Hub, and fetches the others."""
    recorded = spec["pool"]["revision"]
    return (
        cache.get(name, {}).get("revision") == recorded
        or pool_revision(datasets.dataset_path(name)) == recorded
    )


def size(part="main"):
    """Items in one part of Core v1; the main part includes the TypeSafe steps."""
    with open(PATH) as f:
        frozen = json.load(f)
    items = sum(len(s["items"]) for s in frozen["sets"].values() if s["part"] == part)
    return items + (len(frozen["typesafe"]) if part == "main" else 0)


def pages_to_fetch(part="main"):
    """The Hub pages Core v1 still needs on this machine, and from how many datasets."""
    with open(PATH) as f:
        sets = json.load(f)["sets"]
    cache = cached_rows()
    need = [spec for name, spec in sets.items() if spec["part"] == part and not on_disk(name, spec, cache)]
    pages = sum(len({i["row"] // 100 for i in spec["items"]}) for spec in need)
    return {"datasets": len({spec["hub"] for spec in need}), "pages": pages}


def local_rows(name, spec, cache):
    """A set's rows from this machine at the recorded revision (the rows cache, else the pool), found
    by the same test as on_disk so the page's download notice matches what load reads."""
    recorded = spec["pool"]["revision"]
    entry = cache.get(name)
    if entry and entry.get("revision") == recorded:
        return entry
    path = datasets.dataset_path(name)
    if pool_revision(path) != recorded:
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except ValueError as e:
        raise ValueError(f"{path} cannot be read ({e}); delete it to fetch {name} again") from None


def local_items(name, spec, local, path):
    """A set's items from its copy on this machine; every picked row must be there, unchanged."""
    rows = {r["row_idx"]: r for r in local.get("rows", [])}
    items = []
    for pointer in spec["items"]:
        row = rows.get(pointer["row"])
        item = datasets.row_item(name, local, row) if row else None
        if not item or fingerprint(item) != pointer["sha"]:
            raise ValueError(
                f"{name} row {pointer['row']} is missing or changed in the copy on this machine "
                f"({path}); delete that file to fetch the set again"
            )
        items.append(item | {"set": name})
    return items


def load(part="main"):
    """The frozen items of one part, rebuilt and checked against their fingerprints. A set on this
    machine at the recorded revision is read from disk without asking the Hub, as the page's
    download notice counts it; a row missing or changed there stops the load. The other sets come
    from the Hub, a page of 100 rows at a time shown as progress, each row checked, and are kept for
    next time only if the Hub stayed at the recorded revision, so a kept copy is what it claims."""
    with open(PATH) as f:
        frozen = json.load(f)
    cache = cached_rows()
    STOP.clear()
    PROGRESS[DATASET] = [0, pages_to_fetch(part)["pages"], "pages"]
    items = []
    try:
        for name, spec in frozen["sets"].items():
            if spec["part"] != part:
                continue
            local = local_rows(name, spec, cache)
            if local:
                path = ROWS_PATH if local is cache.get(name) else datasets.dataset_path(name)
                items += local_items(name, spec, local, path)
                continue
            recorded, now = spec["pool"]["revision"], datasets.revision(spec["hub"])
            pages, rows = {}, []
            for pointer in spec["items"]:
                start = pointer["row"] - pointer["row"] % 100
                if start not in pages:
                    if STOP.is_set():
                        raise ValueError(
                            "download stopped; the rows so far are kept, and it resumes next time"
                        )
                    pages[start] = datasets.rows_page(spec["hub"], spec["config"], spec["split"], start)
                    PROGRESS[DATASET][0] += 1
                page = pages[start]
                row = next(r for r in page["rows"] if r["row_idx"] == pointer["row"])
                rows.append(row)
                item = datasets.row_item(name, page, row)
                if fingerprint(item) != pointer["sha"]:
                    raise ValueError(
                        f"{name} row {pointer['row']} changed on the Hub since {frozen['frozen']}"
                    )
                items.append(item | {"set": name})
            if now != recorded or datasets.revision(spec["hub"], fresh=True) != recorded:
                print(f"{name}: the Hub revision moved since {frozen['frozen']}; every item still matches")
            else:  # kept after each set, so a stopped download resumes where it stopped
                features = next(iter(pages.values()))["features"]
                cache[name] = {"revision": recorded, "features": features, "rows": rows}
                os.makedirs(datasets.DATA, exist_ok=True)
                with open(ROWS_PATH, "w") as f:
                    json.dump(cache, f)
    finally:
        PROGRESS.pop(DATASET, None)
    if part == "main":
        steps = {
            (case, node): (case, node, doc, qs, truth)
            for case, node, doc, qs, truth in datasets.typesafe_rows()
        }
        for pointer in frozen["typesafe"]:
            item = typesafe_step(*steps[(pointer["case"], pointer["node"])], pointer.get("omit", ()))
            if fingerprint(item) != pointer["sha"]:
                raise ValueError(
                    f"TypeSafe {pointer['case']} {pointer['node']} changed since {frozen['frozen']}"
                )
            items.append(item | {"set": "TypeSafe cases"})
    return items


def reads_wide(model):
    """Letter-reading backends answer 26 options at most; Jev, Laya and local models read more."""
    if model.startswith(("openrouter:", "gguf:")):
        return False
    kind, _, name = model.partition(":")
    return kind != "remote" or name.split(":")[0] not in models.LETTER


def system(model, backend):
    """What answers a run, stored with each of its rows so results say which system produced them."""
    about = {"id": model, "model": backend.model_id, "device": getattr(backend, "device", None)}
    if isinstance(backend, remote.Remote) and backend.backend in remote.PROBABILITIES_ONLY:
        return about | {"readout": "the provider's own typed API"}  # no letter prompt is sent
    if isinstance(backend, remote.Remote):
        request = remote.EXTRAS.get(backend.backend, {"temperature": 0})
        return about | {
            "readout": "letter",
            "prompt_version": remote.PROMPT_VERSION,
            "request": request | {"max_tokens": 1, "top_logprobs": remote.TOP_LOGPROBS},
        }
    model_dtype = getattr(getattr(backend, "model", None), "dtype", None)
    return about | {
        "readout": getattr(backend, "readout", None),
        "dtype": str(model_dtype) if model_dtype else None,
    }


def run(model):
    items = load("main") + (load("wide") if reads_wide(model) else [])
    backend = models.get(model)
    stamp = time.strftime("%Y-%m-%d-%H-%M-%S", time.gmtime())
    log = f"{stamp}-{NAME}-{model.split(':')[-1].split('/')[-1]}"
    dataset = DATASET

    about = system(model, backend)

    def ask(item):
        started = time.time()
        try:
            response = backend.ask(item["state"], item["questions"])
        except Exception as e:  # still logged: a failed item counts as wrong
            print(f"  {item['source']}: {e}")
            response = {"answers": {}, "error": str(e)}
        ms = round((time.time() - started) * 1000)
        runs.log_row(
            {"log": log, "dataset": dataset, "sides": [model], "system": about}
            | {k: item[k] for k in ("set", "source", "state", "questions", "truth")},
            model,
            response["answers"],
            ms,
            response,
        )

    # A hosted API answers many requests at once. A model on this machine answers one at a time,
    # llama-server and laya-serve included, and its times must not count a wait in its own queue.
    hosted = isinstance(backend, remote.Remote) and backend.backend not in remote.ADDRESS
    workers = HOSTED_WORKERS if hosted else 1
    with ThreadPoolExecutor(workers) as pool:
        for k, _ in enumerate(pool.map(ask, items), 1):
            if k % 100 == 0 or k == len(items):
                print(f"{k}/{len(items)}", flush=True)
    print(f"saved to results/logs/demo/{log}.jsonl; open it in Past runs")


def export():
    """Every item with its text and label, one JSON line each, into local/ (git-ignored)."""
    path = os.path.join(ROOT, "local", "review", f"{NAME}-items.jsonl")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for part in ("main", "wide"):
            for item in load(part):
                keep = ("set", "source", "state", "questions", "truth")
                f.write(
                    json.dumps(
                        {"part": part, "sha": fingerprint(item)} | {k: item[k] for k in keep},
                        ensure_ascii=False,
                    )
                    + "\n"
                )
    print(os.path.relpath(path, ROOT))


def tokens():
    """Input tokens per item as a letter-reading API receives them: one request per question, each
    with the whole state. The wide sets, which only Jev and local models answer, are measured as the
    request Jev receives: the state and questions as JSON. A Qwen tokenizer; others will differ."""
    from transformers import AutoTokenizer

    from jev.remote import LETTER_SYSTEM, letter_prompt

    tok = AutoTokenizer.from_pretrained(TOKENIZER)
    per_set = {}
    for item in load("main"):
        size = 0
        for question in item["questions"].values():
            _, user = letter_prompt(item["state"], question)
            messages = [{"role": "system", "content": LETTER_SYSTEM}, {"role": "user", "content": user}]
            prompt = tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
            size += len(tok(prompt)["input_ids"])
        total, questions, count = per_set.get(item["set"], (0, 0, 0))
        per_set[item["set"]] = (total + size, questions + len(item["questions"]), count + 1)
    sets = {
        name: {"tokens": round(total / count), "questions": round(questions / count, 2)}
        for name, (total, questions, count) in per_set.items()
    }
    items = sum(count for _, _, count in per_set.values())
    sets[DATASET] = {
        "tokens": round(sum(total for total, _, _ in per_set.values()) / items),
        "questions": round(sum(q for _, q, _ in per_set.values()) / items, 2),
    }
    wide = {}
    for item in load("wide"):
        body = json.dumps({"state": item["state"], "questions": item["questions"]}, ensure_ascii=False)
        wide.setdefault(item["set"], []).append(len(tok(body)["input_ids"]))
    for name, sizes in wide.items():
        sets[name] = {"tokens": round(sum(sizes) / len(sizes)), "questions": 1.0, "as": "request body"}
    with open(TOKENS_PATH, "w") as f:
        json.dump(
            {"measured": time.strftime("%Y-%m-%d"), "tokenizer": TOKENIZER, "per_item": sets}, f, indent=1
        )
    average = sets[DATASET]["tokens"]
    print(f"{os.path.relpath(TOKENS_PATH, ROOT)}: {DATASET} averages {average} tokens an item")


def cli():
    args = sys.argv[1:]
    if args[:1] == ["freeze"]:
        freeze()
    elif args[:1] == ["export"]:
        export()
    elif args[:1] == ["score"] and len(args) > 1:
        from jev.bench.score import score

        score(args[1:])
    elif args[:1] == ["tokens"]:
        tokens()
    elif args[:1] == ["run"] and len(args) == 2:
        run(args[1])
    else:
        print(__doc__)


if __name__ == "__main__":
    cli()
