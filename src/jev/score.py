"""Core v1 scores from saved runs, by the scoring contract fixed before any scored run.

    uv run jev-bench score results/logs/demo/<run>.jsonl [<run>.jsonl ...]

Each set's track, group and provenance come from benchmarks/core-v1.json. The headline averages
the headline sets equally within each group, then the groups equally; RewardBench counts as the
mean of its four families. Auxiliary, ordinal (HelpSteer2), wide and TypeSafe results are reported
beside it, never in it. A missing or invalid answer is wrong. Probability scores use only answers
whose every option was observed, and say how many that is. Intervals come from a bootstrap that
resamples whole source clusters (SQuAD articles, RAGTruth sources, one question in three languages,
TypeSafe documents) within each set; with two or more runs, differences are paired on shared items.
"""

import hashlib
import json
import math
import random
import re
from collections import Counter, defaultdict

from jev import bench, demo
from jev.bench import PATH
from jev.core import _options

RESAMPLES, SEED = 2000, 0
CLIP = 1e-6  # log loss clips probabilities here; how often is reported
ECE_BINS = 5
LANGUAGES = {"Global-MMLU-Lite Hindi", "Global-MMLU-Lite Chinese", "Global-MMLU-Lite English"}
ROW_FIELDS = {  # sets whose clusters or families need a field of the source row
    "SQuAD v2": "title",
    "RewardBench": "subset",
    **dict.fromkeys(LANGUAGES, "sample_id"),
}


def read_runs(paths):
    """Saved rows by the system that answered them. Two runs of one backend with different settings
    (prompt version, request settings) stay apart, named with a short hash of their settings."""
    runs = defaultdict(list)
    for path in paths:
        with open(path) as f:
            for line in f.read().split("\n"):
                if line.strip():
                    row = json.loads(line)
                    runs[(row["backend"], json.dumps(row.get("system"), sort_keys=True))].append(row)
    backends = Counter(backend for backend, _ in runs)
    return {
        backend
        if backends[backend] == 1
        else f"{backend} [{hashlib.sha1(config.encode()).hexdigest()[:6]}]": rows
        for (backend, config), rows in runs.items()
    }


def check_run(system, rows, frozen):
    """Every row must be a Core v1 item as frozen (its fingerprint in the manifest), and none twice:
    a changed item or a repeated one would silently change what is scored. Returns the item count."""
    allowed = {i["sha"] for spec in frozen["sets"].values() for i in spec.get("items", [])}
    allowed |= {step["sha"] for step in frozen["typesafe"]}
    seen = set()
    for row in rows:
        sha = bench.fingerprint(row)
        if sha not in allowed:
            raise ValueError(f"{system}: {row['source']} is not a Core v1 item as frozen")
        if sha in seen:
            raise ValueError(f"{system}: {row['source']} is there twice; score one run per system")
        seen.add(sha)
    return len(seen)


def row_fields(sets):
    """For the sets in ROW_FIELDS, each picked row's field (article, subset, question id), from the
    rows Core v1 keeps on this machine; nothing is downloaded just to score."""
    cache, fields = bench.cached_rows(), {}
    for name, field in ROW_FIELDS.items():
        rows = bench.local_rows(name, sets[name], cache)
        if rows is None:
            raise ValueError(
                f"{name}'s rows are not on this machine: open Core v1 once, or run jev-bench export"
            )
        picked = {i["row"] for i in sets[name]["items"]}
        fields[name] = {r["row_idx"]: r["row"][field] for r in rows["rows"] if r["row_idx"] in picked}
    return fields


def outcomes(row, fields, families):
    """One saved item as scored questions: right or not, the distribution when complete, the
    truth's position, and the cluster and stratum the bootstrap draws it with."""
    name = row["set"]
    if name == "TypeSafe cases":
        case = row["source"].split(" · ")[1]
        cluster, stratum, unit = case, name, case.split("/")[0]
    else:
        number = int(row["source"].rsplit(" row ", 1)[1])
        value = fields.get(name, {}).get(number)
        stratum = "Global-MMLU-Lite" if name in LANGUAGES else name
        cluster = value if name in ("SQuAD v2", *LANGUAGES) else row["state"].get("context", row["source"])
        unit = families.get(value) if name == "RewardBench" else None
    for qid, truth in row["truth"].items():
        q = row["questions"][qid]
        labels = _options(q)[0]
        truth = {"true": "yes", "false": "no"}.get(str(truth).lower(), str(truth))
        if truth not in labels:
            raise ValueError(f"{row['source']} {qid}: label {truth!r} is not an option")
        answer = row["answers"].get(qid)
        yield {
            "set": name,
            "key": (row["source"], qid),
            "family": re.sub(r"\d+", "N", qid),
            "answered": bool(answer),
            "right": bool(answer) and demo.right(answer, truth),
            "p": distribution(answer, labels),
            "score": answer.get("score") if answer else None,
            "y": labels.index(truth),
            "k": len(labels),
            "cluster": (stratum, cluster),
            "unit": (name, unit),
        }


def distribution(answer, labels):
    """The answer's probabilities over the options in order, or None unless every option was seen."""
    if not answer or answer.get("coverage", {"status": "complete"})["status"] != "complete":
        return None
    if answer["type"] == "noul":
        return [answer["noul"], 1 - answer["noul"]]
    probabilities = answer.get("probabilities") or {}
    return [probabilities[label] for label in labels] if set(probabilities) == set(labels) else None


def set_scores(counts):
    """Each set's accuracy from (set, unit) counts; RewardBench's is the mean of its families."""
    by_set = defaultdict(list)
    for (name, unit), (right, total) in counts.items():
        by_set[name].append((unit, right, total))
    scores = {}
    for name, parts in by_set.items():
        if name == "RewardBench":
            scores[name] = sum(r / t for _, r, t in parts) / len(parts)
        else:
            scores[name] = sum(r for _, r, _ in parts) / sum(t for _, _, t in parts)
    return scores


def headline(counts, sets):
    """Headline sets equally within each group, then groups equally."""
    groups = defaultdict(list)
    for name, score in set_scores(counts).items():
        if sets[name]["track"] == "headline":
            groups[sets[name]["group"]].append(score)
    return sum(sum(g) / len(g) for g in groups.values()) / len(groups), {
        group: sum(g) / len(g) for group, g in groups.items()
    }


def tally(scored):
    """Right and total per cluster and (set, unit), the bootstrap's building blocks."""
    clusters = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for o in scored:
        cell = clusters[o["cluster"]][o["unit"]]
        cell[0] += o["right"]
        cell[1] += 1
    return clusters


def bootstrap(systems, sets):
    """95% intervals of each system's headline, and of paired differences, by resampling whole
    clusters within each stratum. `systems` maps a name to its headline outcomes on shared items."""
    tallies = {name: tally(scored) for name, scored in systems.items()}
    strata = defaultdict(set)
    for scored in systems.values():
        for o in scored:
            strata[o["cluster"][0]].add(o["cluster"])
    strata = {s: sorted(c, key=str) for s, c in strata.items()}
    rng = random.Random(SEED)
    draws = {name: [] for name in systems}
    for _ in range(RESAMPLES):
        chosen = [c for clusters in strata.values() for c in rng.choices(clusters, k=len(clusters))]
        for name, clusters in tallies.items():
            counts = defaultdict(lambda: [0, 0])
            for c in chosen:
                for unit, (right, total) in clusters.get(c, {}).items():
                    counts[unit][0] += right
                    counts[unit][1] += total
            draws[name].append(headline(counts, sets)[0])
    names = list(systems)
    out = {name: interval(values) for name, values in draws.items()}
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            out[f"{a} − {b}"] = interval([x - y for x, y in zip(draws[a], draws[b], strict=True)])
    return out


def interval(values):
    values = sorted(values)
    return values[int(0.025 * len(values))], values[int(0.975 * len(values)) - 1]


def probability_scores(scored):
    """Brier, log loss and baselines over complete answers; how many answers that covers."""
    complete = [o for o in scored if o["p"] is not None]
    if not complete:
        return {"complete": 0, "of": len(scored)}

    def brier(p, y):
        return sum((x - (i == y)) ** 2 for i, x in enumerate(p))

    clipped = sum(o["p"][o["y"]] < CLIP for o in complete)
    return {
        "complete": len(complete),
        "of": len(scored),
        "brier": mean(brier(o["p"], o["y"]) for o in complete),
        "brier uniform": mean(1 - 1 / o["k"] for o in complete),
        "brier always A": mean(brier([1.0] + [0.0] * (o["k"] - 1), o["y"]) for o in complete),
        "log loss": mean(-math.log(max(o["p"][o["y"]], CLIP)) for o in complete),
        "log loss uniform": mean(math.log(o["k"]) for o in complete),
        "log loss always A": mean(0.0 if o["y"] == 0 else -math.log(CLIP) for o in complete),
        "clipped": clipped,
    }


def ece(scored):
    """Descriptive calibration: five equal-width bins of the top probability, with their counts."""
    bins = defaultdict(list)
    for o in scored:
        if o["p"] is not None:
            top = max(o["p"])
            bins[min(int(top * ECE_BINS), ECE_BINS - 1)].append((top, o["p"].index(top) == o["y"]))
    n = sum(map(len, bins.values()))
    if not n:
        return None, []
    rows = [(b, len(v), mean(t for t, _ in v), mean(r for _, r in v)) for b, v in sorted(bins.items())]
    return sum(count / n * abs(acc - conf) for _, count, conf, acc in rows), rows


def ordinal(scored, complete):
    """HelpSteer2: exact level (the most probable) over every shared question, an unanswered one
    wrong; mean absolute error of the expected level and the ranked probability score, both divided
    by the number of levels minus one, over the `complete` questions: those every run answered with
    all levels seen, so runs compare on the same questions and no level is read from part of them."""
    k = scored[0]["k"] - 1
    seen = [o for o in scored if o["key"] in complete]

    def rps(p, y):
        cdf, total = 0.0, 0.0
        for i in range(len(p) - 1):
            cdf += p[i]
            total += (cdf - (i >= y)) ** 2
        return total

    return {
        "exact": mean(o["right"] for o in scored),
        "mae": mean(abs(o["score"] - o["y"]) / k for o in seen) if seen else None,
        "rps": mean(rps(o["p"], o["y"]) / k for o in seen) if seen else None,
        "complete": len(seen),
        "of": len(scored),
    }


def typesafe(scored):
    """Per workflow and question family: accuracy (a question left unanswered is wrong); for yes/no
    families, false positives and negatives among the answered, the unanswered apart, balanced
    accuracy where both labels occur; the all-no and (hindsight) commonest-label baselines."""
    rows = []
    by = defaultdict(list)
    for o in scored:
        by[(o["unit"][1], o["family"])].append(o)
    for (workflow, family), group in sorted(by.items()):
        labels = Counter(o["y"] for o in group)
        row = {
            "workflow": workflow,
            "family": family,
            "cases": len({o["cluster"] for o in group}),
            "n": len(group),
            "accuracy": mean(o["right"] for o in group),
            "no answer": sum(not o["answered"] for o in group),
            "commonest label (hindsight)": labels.most_common(1)[0][1] / len(group),
        }
        if group[0]["k"] == 2:  # yes/no: index 0 is yes
            yes = [o for o in group if o["y"] == 0]
            no = [o for o in group if o["y"] == 1]
            row["all no"] = len(no) / len(group)
            row["false positives"] = sum(o["answered"] and not o["right"] for o in no)
            row["false negatives"] = sum(o["answered"] and not o["right"] for o in yes)
            if yes and no:
                row["balanced accuracy"] = (mean(o["right"] for o in yes) + mean(o["right"] for o in no)) / 2
        rows.append(row)
    return rows


def mean(values):
    values = list(values)
    return sum(values) / len(values)


def score(paths):
    """Every system in the runs, scored and printed as Markdown; the numbers are returned too.
    Systems are compared on the questions every run answered, so a stopped or partial run cannot
    shift the others; probability scores use the questions every run answered completely."""
    with open(PATH) as f:
        frozen = json.load(f)
    sets = frozen["sets"]
    sets["TypeSafe cases"] = {"track": "typesafe", "group": "TypeSafe"}
    families = {s: f for f, subsets in sets["RewardBench"]["families"].items() for s in subsets}
    fields = row_fields(sets)
    runs = read_runs(paths)
    main, wide = bench.size("main"), bench.size("wide")
    coverage = {}
    for system, rows in runs.items():
        items = check_run(system, rows, frozen)
        full = main + (wide if any(sets[r["set"]]["track"] == "wide" for r in rows) else 0)
        coverage[system] = (
            f"complete, {items} items" if items == full else f"incomplete: {items} of {full} items"
        )
    scored = {
        system: [o for row in rows for o in outcomes(row, fields, families)] for system, rows in runs.items()
    }
    shared = set.intersection(*({o["key"] for o in s} for s in scored.values()))
    if not shared:
        raise SystemExit("no question is answered by every run; score them one at a time")
    scored = {system: [o for o in s if o["key"] in shared] for system, s in scored.items()}
    complete = set.intersection(*({o["key"] for o in s if o["p"] is not None} for s in scored.values()))
    report = {}
    for system, all_scored in scored.items():
        track = defaultdict(list)
        for o in all_scored:
            track[sets[o["set"]]["track"]].append(o)
        counts = defaultdict(lambda: [0, 0])
        for o in track["headline"]:
            counts[o["unit"]][0] += o["right"]
            counts[o["unit"]][1] += 1
        overall, groups = headline(counts, sets) if counts else (None, {})
        every = defaultdict(lambda: [0, 0])
        for o in all_scored:
            every[o["unit"]][0] += o["right"]
            every[o["unit"]][1] += 1
        by_set = Counter(o["set"] for o in all_scored)
        comparable = [o for o in track["headline"] if o["key"] in complete]
        own_complete = sum(o["p"] is not None for o in track["headline"])
        report[system] = {
            "coverage": coverage[system],
            "headline": overall,
            "groups": groups,
            # RewardBench's score is the mean of its families, here as in the headline
            "sets": {n: (value, by_set[n]) for n, value in sorted(set_scores(every).items())},
            "tracks": {t: len(v) for t, v in track.items()},
            "probabilities": probability_scores(comparable) | {"own complete": own_complete},
            "ece": ece(comparable),
            "ordinal": ordinal(track["ordinal"], complete) if track["ordinal"] else None,
            "typesafe": typesafe(track["typesafe"]),
        }
    headline_shared = {
        system: [o for o in s if sets[o["set"]]["track"] == "headline"] for system, s in scored.items()
    }
    intervals = bootstrap(headline_shared, sets) if all(headline_shared.values()) else {}
    print_report(report, intervals, sets, len(shared))
    return report, intervals


def print_report(report, intervals, sets, shared):
    pct = "{:.1%}".format
    print(
        f"# Core v1 scores\n\nEvery number compares the {shared} questions every run answered; "
        f"probability scores, the questions every run answered with all options seen. "
        f"{RESAMPLES} cluster resamples, seed {SEED}.\n"
    )
    print(
        "| System | Run | Headline | 95% interval | Probability questions (own) "
        "| Brier (uniform, always A) | Log loss (uniform, always A) |"
    )
    print("|---|---|---:|---:|---:|---:|---:|")
    for system, r in report.items():
        lo, hi = intervals.get(system, (None, None))
        p = r["probabilities"]
        cells = [
            r["coverage"],
            pct(r["headline"]) if r["headline"] is not None else "—",
            f"{pct(lo)}–{pct(hi)}" if lo is not None else "—",
            f"{p['complete']} ({p['own complete']})",
            f"{p['brier']:.3f} ({p['brier uniform']:.3f}, {p['brier always A']:.3f})"
            if p.get("brier") is not None
            else "—",
            f"{p['log loss']:.3f} ({p['log loss uniform']:.3f}, {p['log loss always A']:.3f}), "
            f"{p['clipped']} clipped"
            if p.get("log loss") is not None
            else "—",
        ]
        print(f"| {system} | " + " | ".join(cells) + " |")
    for pair, (lo, hi) in intervals.items():
        if " − " in pair:
            print(f"\nPaired difference {pair}: {lo:+.1%} to {hi:+.1%} (95%)")
    for system, r in report.items():
        print(f"\n## {system}\n")
        print("| Group | Score |\n|---|---:|")
        for group, value in r["groups"].items():
            print(f"| {group} | {pct(value)} |")
        print("\n| Set | Track | Score | Questions |\n|---|---|---:|---:|")
        for name, (acc, n) in r["sets"].items():
            family = " (mean of its families)" if name == "RewardBench" else ""
            print(f"| {name}{family} | {sets[name]['track']} | {pct(acc)} | {n} |")
        if r["ordinal"]:
            o = r["ordinal"]
            print(
                f"\nHelpSteer2: exact level {pct(o['exact'])} on {o['of']} questions; MAE/(K−1) "
                f"{o['mae']:.3f} and RPS/(K−1) {o['rps']:.3f} on the {o['complete']} every run "
                "answered with all levels seen"
                if o["complete"]
                else f"\nHelpSteer2: exact level {pct(o['exact'])} on {o['of']} questions; no MAE or RPS, "
                "as no question was answered with all levels seen by every run"
            )
        value, bins = r["ece"]
        if value is not None:
            shown = ", ".join(
                f"{b / ECE_BINS:.1f}–{(b + 1) / ECE_BINS:.1f}: {n} ({pct(acc)} right)"
                for b, n, _, acc in bins
            )
            print(f"\nECE (descriptive, headline): {value:.3f}; bins {shown}")
        if r["typesafe"]:
            print(
                "\n| Workflow | Family | Cases | n | Accuracy | Balanced | FP | FN | No answer | All no "
                "| Commonest (hindsight) |"
            )
            print("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
            for t in r["typesafe"]:
                cells = [t["workflow"], t["family"], t["cases"], t["n"], pct(t["accuracy"]),
                         pct(t["balanced accuracy"]) if "balanced accuracy" in t else "—",
                         t.get("false positives", "—"), t.get("false negatives", "—"), t["no answer"],
                         pct(t["all no"]) if "all no" in t else "—",
                         pct(t["commonest label (hindsight)"])]  # fmt: skip
                print("| " + " | ".join(map(str, cells)) + " |")
