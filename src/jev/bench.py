"""Core v1: a frozen pick of items from every set in the demo, stored as pointers.

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
    uv run jev-bench check                         # offline self-checks of the readout

Each run is saved like a demo batch, so Past runs lists it and can compare runs side by side.
"""

import hashlib
import json
import math
import os
import random
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from threading import Event

from jev import demo, remote
from jev.core import ROOT
from jev.remote import PROMPT_VERSION

NAME = "core-v1"
PATH = os.path.join(ROOT, "benchmarks", f"{NAME}.json")
TOKENS_PATH = os.path.join(ROOT, "benchmarks", f"{NAME}-tokens.json")
ROWS_PATH = os.path.join(demo.DATA, f"{NAME}-rows.json")  # picked rows fetched from the Hub, git-ignored
STOP = Event()  # set by the page's Stop: the download ends before its next page
TOKENIZER = "Qwen/Qwen2.5-0.5B-Instruct"
PER_SET = 50  # items a set gives, unless it has more topics: then one per topic
LETTER_LIMIT = 26
DATASET = "Core v1"
HOSTED_WORKERS = 8
REDUX = "edinburgh-dawg/mmlu-redux-2.0"  # MMLU re-checked by people, 100 questions a subject
# The field a set's picks are spread over (None: its label). Sets with more topics than PER_SET
# give one item per topic.
TOPICS = {
    "MMLU": "subject",
    "Banking77": None,
    "CLINC150": None,
    "LEDGAR": None,
    "MMLU-Pro": "category",
    "MultiNLI mismatched": "genre",
    "ContractNLI": "hypothesis",
    "RewardBench": "subset",
    "MedQA": "meta_info",
    "DBpedia-14": None,
}
# Options vary in number or are shuffled per question, so answer positions are left to chance.
RANDOM_POSITIONS = {"MMLU-Pro", "TruthfulQA", "BBH date understanding", "GPQA Diamond"}
# set: (a row's cell, items per cell, the field spread over within a cell)
QUOTAS = {
    "BBQ race and ethnicity": (
        lambda r: (r["context_condition"], r["question_polarity"]),
        {("ambig", "neg"): 13, ("ambig", "nonneg"): 12, ("disambig", "neg"): 12, ("disambig", "nonneg"): 13},
        "question_index",
    ),
}
# RAGTruth's yes and no items per task. A random pick is answerable by length (81% on QA), so each
# no is the one nearest a yes in length, as for jailbreak attempts; at most one response per source.
RAGTRUTH = {"QA": (8, 8), "Summary": (9, 8), "Data2txt": (8, 9)}
# Jailbreak messages run long and ordinary ones short, so each jailbreak is paired with the ordinary
# message nearest it in length, within max(5 words, a quarter of its length); half the pairs of
# JAILBREAK_TOXIC use a toxic ordinary message, so toxicity does not give the answer away.
JAILBREAK_PAIRS, JAILBREAK_TOXIC = 25, 12
LANGUAGES = ("Global-MMLU-Lite Hindi", "Global-MMLU-Lite Chinese")  # ask the English set's questions
# The Chinese rows of this subject hold its questions shuffled among its sample_ids (checked
# 2026-09-24: none of its 10 match the English options), so it cannot be asked in all three.
UNMATCHED_SUBJECTS = {"high_school_world_history"}
# TypeSafe questions review found unanswerable from their step (a needed fact is missing, or the
# rubric allows two answers); each step keeps its other questions
TYPESAFE_OMIT = {
    ("agent_trace_observability/trace_e2ab80ce644dc6a4d4ea02cfcffcccee", "safety_1"): ["within_grant"],
    ("invoice_processing/ap_00074", "semantic"): ["line_3_scope", "line_3_completion"],
    ("invoice_processing/ap_00246", "semantic"): ["price_basis", "billed_above_basis"],
    ("customer_service/retention-sarcastic-sure-whatever/t0", "triage"): ["desired_outcome"],
    ("customer_service/billing-overdraft-no-food/t1", "money"): ["refund_reason"],
}
FIRST = ("Jailbreak attempts", "Global-MMLU-Lite English")  # picked before the sets that depend on them
AUXILIARY = {  # reported beside the headline, not in it
    "IMDB", "AG News topic", "DBpedia-14", "Arena votes", "MuSR murder mysteries",
    "Global-MMLU-Lite English",
}  # fmt: skip
KNOWLEDGE = {  # sets that need outside knowledge by design; the rest are answered from the state
    "MMLU", "MMLU-Pro", "ARC-Challenge", "OpenBookQA", "CommonsenseQA", "MedQA", "GPQA Diamond",
    "TruthfulQA", "Global-MMLU-Lite Hindi", "Global-MMLU-Lite Chinese", "Global-MMLU-Lite English",
    "LegalBench hearsay",
}  # fmt: skip
PROVENANCE = {  # who wrote the text, who made the labels, and any filtering
    "SST-2 sentiment": "movie-review sentences; labels by crowd workers",
    "IMDB": "user movie reviews; labels from the reviewer's rating",
    "Tweet sentiment": "tweets; labels by annotators",
    "Tweet emotion": "tweets; labels by annotators",
    "Tweet irony": "tweets; labels by annotators",
    "Tweet hate": "tweets; labels by annotators",
    "Tweet offensive": "tweets; labels by annotators",
    "RTE entailment": "news and Wikipedia sentences; labels by annotators",
    "SNLI": "image captions and crowd-written hypotheses; labels by crowd workers",
    "MultiNLI mismatched": "text from five genres and crowd-written hypotheses; labels by crowd workers",
    "ANLI round 3": "hypotheses written by people to fool models; labels by their writers, checked by others",
    "BoolQ": "real search questions and Wikipedia passages; answers by annotators",
    "MultiRC": "paragraphs from several sources; questions and answers by crowd workers",
    "WinoGrande": "crowd-written sentences, filtered by an algorithm; answers by their writers",
    "RAGTruth": "responses by six language models; unsupported spans marked by people; truncated "
    "responses and wrong refusals left out",
    "SQuAD v2": "Wikipedia paragraphs; questions by crowd workers, unanswerable ones written to look "
    "answerable",
    "MuSR murder mysteries": "stories written by a language model from a synthetic construction; "
    "answers by construction",
    "BBH causal judgement": "stories from studies of how people judge causes; labels from people's answers",
    "BBH date understanding": "questions and answers written for BIG-bench",
    "XNLI Hindi": "MultiNLI-style pairs translated by people; labels from the English pairs",
    "Global-MMLU-Lite Hindi": "MMLU questions translated or post-edited by people; cultural "
    "sensitivity marked by annotators",
    "Global-MMLU-Lite Chinese": "MMLU questions translated or post-edited by people; cultural "
    "sensitivity marked by annotators",
    "Global-MMLU-Lite English": "MMLU questions in English; cultural sensitivity marked by annotators",
    "Banking77": "banking customer-service queries; intent labels from the released Banking77 dataset",
    "CLINC150": "crowd-written assistant requests; labels from collection tasks and curator checks, "
    "including out-of-scope requests",
    "AG News topic": "news titles and descriptions; topic labels inherited from the AG News corpus",
    "DBpedia-14": "Wikipedia abstracts; labels from DBpedia's ontology (metadata)",
    "MMLU": "exam questions from public sources; only those MMLU-Redux 2.0 re-checked and marked ok",
    "MMLU-Pro": "MMLU and other academic problems; distractors added using GPT-4 and reviewed by people",
    "ARC-Challenge": "grade-school science exam questions; keys from the exams; four-option items only",
    "OpenBookQA": "crowd-written science questions; answers by their writers",
    "CommonsenseQA": "crowd-written questions; answers by their writers",
    "GoldenSwag": "HellaSwag source continuations and model-generated distractors; filtered using model "
    "annotations and quality checks",
    "TruthfulQA": "questions and answers written by the authors",
    "MedQA": "medical licensing exam and mock-test questions; answer keys from the source",
    "PubMedQA": "PubMed abstracts and their titles as questions; labels by experts",
    "GPQA Diamond": "questions written by domain experts; answers checked by other experts",
    "ToxicChat": "real user messages to a chatbot; labels by people, people-annotated rows only",
    "SMS spam": "real text messages; labels from the collection",
    "Jailbreak attempts": "real user messages to a chatbot; labels by people, people-annotated rows "
    "only; ordinary messages matched in length",
    "BBQ race and ethnicity": "templated contexts and questions written by the authors; answers by "
    "construction",
    "Arena votes": "real user prompts and chatbot responses; one person's recorded vote; single-turn only",
    "RewardBench": "response pairs from several sources; rankings from source-specific human, model or "
    "correctness criteria, with manual and metadata-based filtering",
    "HelpSteer2": "prompts and model responses; helpfulness rated by annotators; single-turn only",
    "ContractNLI": "non-disclosure agreement text; labels by a computational linguistics researcher with "
    "crowd-worker assistance",
    "LEDGAR": "contract provisions from SEC filings; labels from their headings (metadata)",
    "LegalBench hearsay": "hand-written legal fact patterns inspired by casebooks and exercises; labels "
    "from the task authors",
    "LegalBench definitions": "sentences from US Supreme Court opinions; hand-coded definition labels from "
    "the task authors",
}
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


def typesafe_step(case, node, doc, qs, truth, omit=()):
    """One TypeSafe step as Core v1 asks it, without its omitted questions."""
    unknown = set(omit) - set(qs)
    if unknown:
        raise ValueError(f"TypeSafe {case} {node} has no question {', '.join(sorted(unknown))}")
    item = demo.typesafe_item(case, node, doc, qs, truth)
    return item | {
        "questions": {k: v for k, v in item["questions"].items() if k not in omit},
        "truth": {k: v for k, v in item["truth"].items() if k not in omit},
    }


def answer_group(name, item):
    """What the pick balances on: the label, or for multiple choice the right answer's position."""
    truth = item["truth"]["answer"]
    if name in demo.MC and name not in demo.SCORED:
        return list(item["questions"]["answer"]["criteria"]).index(truth)
    return truth


def balanced(pairs, key, n, seed):
    """Up to n items taking turns across groups, so no label or answer position dominates."""
    rng = random.Random(seed)
    groups = {}
    for pair in pairs:
        groups.setdefault(key(pair), []).append(pair)
    for members in groups.values():
        rng.shuffle(members)
    picked = []
    while len(picked) < n and any(groups.values()):
        for k in sorted(groups, key=str):
            if groups[k] and len(picked) < n:
                picked.append(groups[k].pop())
    return picked


def spread(pairs, topic, answer, n, seed):
    """Up to n items taking turns across topics. Within a topic it takes the answer least used
    overall so far, then in that topic, so answers stay even even where a topic lacks some."""
    rng = random.Random(seed)
    topics = {}
    for pair in pairs:
        topics.setdefault(topic(pair), []).append(pair)
    for members in topics.values():
        rng.shuffle(members)
    order = sorted(topics, key=str)
    rng.shuffle(order)
    within, overall, picked = {t: Counter() for t in topics}, Counter(), []
    while len(picked) < n and any(topics.values()):
        for t in order:
            if topics[t] and len(picked) < n:
                pair = min(topics[t], key=lambda p, t=t: (overall[answer(p)], within[t][answer(p)]))
                topics[t].remove(pair)
                within[t][answer(pair)] += 1
                overall[answer(pair)] += 1
                picked.append(pair)
    return picked


def quota(name, pairs, seed):
    """Each cell's count of items, spread within the cell; stops if a cell cannot be filled."""
    cell_of, counts, field = QUOTAS[name]
    picked = []
    for cell, count in counts.items():
        members = [p for p in pairs if cell_of(p[0]["row"]) == cell]
        got = spread(members, lambda p: p[0]["row"][field], lambda p: 0, count, f"{seed}:{cell}")
        if len(got) < count:
            raise ValueError(f"{name}: {len(got)} of the {count} items cell {cell} needs")
        picked += got
    return picked


def ragtruth(pairs, seed):
    """Per task, yes responses in seeded order, each with the unpicked no response nearest it in
    length within max(5 words, a quarter of its length); a task's one extra item is the next of its
    label in seeded order. No source twice. Stops if a task falls short of its pairs or items."""
    rng = random.Random(seed)
    pairs = list(pairs)
    rng.shuffle(pairs)
    picked, used, record = [], set(), []

    def fresh(pair):
        return pair[0]["row"]["context"] not in used

    for task, counts in RAGTRUTH.items():
        rows = [p for p in pairs if p[0]["row"]["task_type"] == task]
        by_label = {label: [p for p in rows if p[1]["truth"]["answer"] == label] for label in ("yes", "no")}
        got = {"yes": [], "no": []}
        for pair in by_label["yes"]:
            if len(got["yes"]) == min(counts) or not fresh(pair):
                continue
            size, limit = words(pair), max(5, 0.25 * words(pair))
            near = [
                p
                for p in by_label["no"]
                if fresh(p)
                and p[0]["row"]["context"] != pair[0]["row"]["context"]
                and abs(words(p) - size) <= limit
            ]
            if near:
                match = min(near, key=lambda p: abs(words(p) - size))
                got["yes"].append(pair)
                got["no"].append(match)
                used.update({pair[0]["row"]["context"], match[0]["row"]["context"]})
                record.append(
                    {"row": pair[0]["row_idx"], "match": match[0]["row_idx"], "words": size}
                    | {"gap": abs(words(match) - size), "task": task}
                )
        if len(got["yes"]) < min(counts):
            raise ValueError(f"RAGTruth: {len(got['yes'])} of the {min(counts)} length-matched {task} pairs")
        for label, count in zip(("yes", "no"), counts, strict=True):
            for pair in by_label[label]:
                if len(got[label]) < count and fresh(pair):
                    got[label].append(pair)
                    used.add(pair[0]["row"]["context"])
            if len(got[label]) < count:
                raise ValueError(f"RAGTruth: {len(got[label])} of the {count} {task} {label} items")
        picked += got["yes"] + got["no"]
    return picked, record


def squad(pairs, seed):
    """SQuAD v2 over all its articles: the first 15 (seeded) give an answerable and an unanswerable
    question from two paragraphs, the other 20 one question each, the two kinds alternating; no
    paragraph twice. Within a paragraph, the first question of the kind in seeded order."""
    rng = random.Random(seed)
    articles = {}
    for pair in pairs:
        row = pair[0]["row"]
        articles.setdefault(row["title"], {}).setdefault(row["context"], []).append(pair)
    titles = sorted(articles)
    rng.shuffle(titles)
    if len(titles) != 35:
        raise ValueError(f"SQuAD v2: {len(titles)} articles, not 35")
    picked = []
    for k, title in enumerate(titles):
        paragraphs = list(articles[title].values())
        rng.shuffle(paragraphs)
        for questions in paragraphs:
            rng.shuffle(questions)
        for label in ["yes", "no"] if k < 15 else [["yes", "no"][(k - 15) % 2]]:
            kind = [q for questions in paragraphs for q in questions if q[1]["truth"]["answer"] == label]
            if not kind:
                raise ValueError(f"SQuAD v2: no {label} question left in {title}")
            picked.append(kind[0])
            paragraphs = [ps for ps in paragraphs if kind[0] not in ps]
    return picked


def words(pair):
    return len(" ".join(str(v) for v in pair[1]["state"].values()).split())


def jailbreak(pairs, seed):
    """Jailbreak messages in seeded order, each with the unpicked ordinary message nearest it in
    length within the gap rule; toxic ordinary messages first until JAILBREAK_TOXIC pairs have one.
    A jailbreak with no ordinary message in range is skipped. Stops if the pairs fall short."""
    rng = random.Random(seed)
    jailbreaks = [p for p in pairs if p[1]["truth"]["answer"] == "yes"]
    ordinary = [p for p in pairs if p[1]["truth"]["answer"] == "no"]
    rng.shuffle(jailbreaks)
    rng.shuffle(ordinary)
    picked, record = [], []
    for pair in jailbreaks:
        if len(record) == JAILBREAK_PAIRS:
            break
        size, limit = words(pair), max(5, 0.25 * words(pair))
        toxic = sum(r["toxic"] for r in record) < JAILBREAK_TOXIC
        for want in [True, False] if toxic else [False]:
            near = [
                p for p in ordinary if bool(p[0]["row"]["toxicity"]) == want and abs(words(p) - size) <= limit
            ]
            if near:
                match = min(near, key=lambda p: abs(words(p) - size))
                ordinary.remove(match)
                picked += [pair, match]
                record.append(
                    {"row": pair[0]["row_idx"], "match": match[0]["row_idx"], "words": size}
                    | {"gap": abs(words(match) - size), "toxic": want}
                )
                break
    toxic = sum(r["toxic"] for r in record)
    if len(record) < JAILBREAK_PAIRS or toxic < JAILBREAK_TOXIC:
        raise ValueError(f"Jailbreak attempts: {len(record)} pairs, {toxic} toxic; the rule needs 25 and 12")
    return picked, record


def languages(pairs, seed):
    """Global-MMLU-Lite English: 25 culturally sensitive and 25 agnostic questions, each half spread
    over subjects with answer positions even. Hindi and Chinese ask the same questions."""
    picked = []
    for label in ("CS", "CA"):
        members = [
            p
            for p in pairs
            if p[0]["row"]["cultural_sensitivity_label"] == label
            and p[0]["row"]["subject"] not in UNMATCHED_SUBJECTS
        ]
        picked += spread(
            members,
            lambda p: p[0]["row"]["subject"],
            lambda p: answer_group("Global-MMLU-Lite English", p[1]),
            25,
            f"{seed}:{label}",
        )
    return picked


def redux_ok(subjects):
    """(subject, question) of each MMLU question that MMLU-Redux 2.0 re-checked and marked ok."""
    ok = set()
    for subject in subjects:
        for r in demo.rows_page(REDUX, subject, "test", 0)["rows"]:
            if r["row"]["error_type"] == "ok":
                ok.add((subject, r["row"]["question"].strip()))
    return ok


def usable(name, pairs):
    """Leave out items whose options repeat, exactly or after lower-casing and dropping punctuation,
    and decisions seen already (the same state, question and ordered options); for MMLU also every
    question MMLU-Redux did not mark ok. Items that only share a context stay."""
    if name == "MMLU":
        ok = redux_ok({r["row"]["subject"] for r, _ in pairs})
        pairs = [(r, item) for r, item in pairs if (r["row"]["subject"], r["row"]["question"].strip()) in ok]
    seen, kept = set(), []
    for r, item in pairs:
        if name in demo.MC:
            options = [re.sub(r"[^\w\s]", "", str(o)).lower().strip() for o in demo.MC[name][5](r["row"])[0]]
            if len(set(options)) < len(options):
                continue
        decision = json.dumps([item["state"], item["questions"]], ensure_ascii=False)
        if decision not in seen:
            seen.add(decision)
            kept.append((r, item))
    return kept


def pick(name, pairs, before):
    """A set's items, and anything its rule records. `before` holds the picks of the sets in FIRST."""
    seed = f"{NAME}:{name}"

    def answer(pair):
        return 0 if name in RANDOM_POSITIONS else answer_group(name, pair[1])

    if name == "SQuAD v2":
        return squad(pairs, seed), {}
    if name == "Jailbreak attempts":
        picked, record = jailbreak(pairs, seed)
        rule = "each jailbreak with the nearest-length ordinary message, gap at most max(5, 25%) words"
        return picked, {"seed": seed, "rule": rule, "pairs": record}
    if name == "ToxicChat":
        taken = {p[0]["row_idx"] for p in before["Jailbreak attempts"]}
        pairs = [p for p in pairs if p[0]["row_idx"] not in taken]
    if name == "Global-MMLU-Lite English":
        return languages(pairs, seed), {}
    if name in LANGUAGES:
        ids = {p[0]["row"]["sample_id"] for p in before["Global-MMLU-Lite English"]}
        picked = [p for p in pairs if p[0]["row"]["sample_id"] in ids]
        if len(picked) != len(ids):
            raise ValueError(f"{name}: {len(picked)} of the {len(ids)} English questions")
        return picked, {}
    if name == "RAGTruth":
        picked, record = ragtruth(pairs, seed)
        rule = "per task, each yes with the nearest-length no, gap at most max(5, 25%) words"
        return picked, {"seed": seed, "rule": rule, "pairs": record}
    if name in QUOTAS:
        return quota(name, pairs, seed), {}
    if name in TOPICS:
        field = TOPICS[name]

        def topic(pair):
            return pair[0]["row"][field] if field else pair[1]["truth"]["answer"]

        return spread(pairs, topic, answer, max(PER_SET, len({topic(p) for p in pairs})), seed), {}
    if name in RANDOM_POSITIONS:
        return random.Random(seed).sample(pairs, PER_SET), {}
    return balanced(pairs, answer, PER_SET, seed), {}


def manifest(name, options):
    """How a set is reported: its track, group, provenance and whether it needs outside knowledge."""
    if options > LETTER_LIMIT:
        track = "wide"
    elif name in demo.SCORED:
        track = "ordinal"
    else:
        track = "auxiliary" if name in AUXILIARY else "headline"
    group = next(g for g, names in demo.GROUPS.items() if name in names)
    out = {"track": track, "group": group, "knowledge": name in KNOWLEDGE, "provenance": PROVENANCE[name]}
    return out | ({"families": REWARDBENCH_FAMILIES} if name == "RewardBench" else {})


def freeze():
    """Pick items for every set not in the file yet; sets already frozen keep their items."""
    frozen = {}
    if os.path.exists(PATH):
        with open(PATH) as f:
            frozen = json.load(f)["sets"]
    names = [*demo.DATASETS, *demo.MC]
    names = [*FIRST, *(n for n in names if n not in FIRST)]
    sets, before = {}, {}
    for name in [*(n for n in frozen if n in names), *(n for n in names if n not in frozen)]:
        hub, config, split = (demo.DATASETS.get(name) or demo.MC[name])[:3]
        pool = demo.download(name, hub, config, split) if name not in frozen or name in FIRST else None
        if name in frozen:
            sets[name] = frozen[name]
            if name in FIRST:  # the sets that depend on it read its rows
                rows = {i["row"] for i in frozen[name]["items"]}
                before[name] = [(r, None) for r in pool["rows"] if r["row_idx"] in rows]
            continue
        pairs = usable(name, [(r, demo.row_item(name, pool, r)) for r in demo.labelled_rows(name, pool)])
        picked, extra = pick(name, pairs, before)
        before[name] = picked
        options = demo.OPTIONS.get(name, 2)
        record = {k: pool[k] for k in ("rule", "seed", "total", "revision", "starts", "size")}
        sets[name] = {
            "hub": hub,
            "config": config,
            "split": split,
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
    for case, node, doc, qs, truth in demo.typesafe_rows():
        omit = TYPESAFE_OMIT.get((case, node), [])
        sha = fingerprint(typesafe_step(case, node, doc, qs, truth, omit))
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
        cache.get(name, {}).get("revision") == recorded or pool_revision(demo.dataset_path(name)) == recorded
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
    path = demo.dataset_path(name)
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
        item = demo.row_item(name, local, row) if row else None
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
    demo.PROGRESS[DATASET] = [0, pages_to_fetch(part)["pages"], "pages"]
    items = []
    try:
        for name, spec in frozen["sets"].items():
            if spec["part"] != part:
                continue
            local = local_rows(name, spec, cache)
            if local:
                path = ROWS_PATH if local is cache.get(name) else demo.dataset_path(name)
                items += local_items(name, spec, local, path)
                continue
            recorded, now = spec["pool"]["revision"], demo.revision(spec["hub"])
            pages, rows = {}, []
            for pointer in spec["items"]:
                start = pointer["row"] - pointer["row"] % 100
                if start not in pages:
                    if STOP.is_set():
                        raise ValueError(
                            "download stopped; the rows so far are kept, and it resumes next time"
                        )
                    pages[start] = demo.rows_page(spec["hub"], spec["config"], spec["split"], start)
                    demo.PROGRESS[DATASET][0] += 1
                page = pages[start]
                row = next(r for r in page["rows"] if r["row_idx"] == pointer["row"])
                rows.append(row)
                item = demo.row_item(name, page, row)
                if fingerprint(item) != pointer["sha"]:
                    raise ValueError(
                        f"{name} row {pointer['row']} changed on the Hub since {frozen['frozen']}"
                    )
                items.append(item | {"set": name})
            if now != recorded or demo.revision(spec["hub"], fresh=True) != recorded:
                print(f"{name}: the Hub revision moved since {frozen['frozen']}; every item still matches")
            else:  # kept after each set, so a stopped download resumes where it stopped
                features = next(iter(pages.values()))["features"]
                cache[name] = {"revision": recorded, "features": features, "rows": rows}
                os.makedirs(demo.DATA, exist_ok=True)
                with open(ROWS_PATH, "w") as f:
                    json.dump(cache, f)
    finally:
        demo.PROGRESS.pop(DATASET, None)
    if part == "main":
        steps = {
            (case, node): (case, node, doc, qs, truth) for case, node, doc, qs, truth in demo.typesafe_rows()
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
    """Letter-reading backends answer 26 options at most; Jev and local models read any number."""
    if model.startswith(("openrouter:", "gguf:")):
        return False
    kind, _, name = model.partition(":")
    return kind != "remote" or name.split(":")[0] not in demo.LETTER


def system(model, backend):
    """What answers a run, stored with each of its rows so results say which system produced them."""
    about = {"id": model, "model": backend.model_id, "device": getattr(backend, "device", None)}
    if isinstance(backend, remote.Remote) and backend.backend in (*remote.TYPED, "vercel"):
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
    backend = demo.get(model)
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
        demo.log_row(
            {"log": log, "dataset": dataset, "sides": [model], "system": about}
            | {k: item[k] for k in ("set", "source", "state", "questions", "truth")},
            model,
            response["answers"],
            ms,
            response,
        )

    # A hosted API answers many requests at once. A model on this machine answers one at a time,
    # Laya's server included, and its times must not count a wait in its own queue.
    hosted = model.startswith(("remote:", "openrouter:")) and not model.startswith("remote:laya")
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
        for q in item["questions"].values():
            _, user = letter_prompt(item["state"], q)
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


def check():
    """Offline asserts on the hosted letter readout; no network."""
    from jev.remote import letter_probs

    def top(**p):
        return [{"token": t.replace("_", " "), "logprob": math.log(x)} for t, x in p.items()]

    probs, cov = letter_probs(top(A=0.2, _A=0.2, B=0.3), 2)
    assert cov["status"] == "complete" and abs(probs[0] - 4 / 7) < 1e-12 and abs(probs[1] - 3 / 7) < 1e-12
    probs, cov = letter_probs(top(A=0.8, hello=0.1), 2)
    assert cov["status"] == "partial" and cov["missing"] == ["B"] and probs == [1.0, 0.0]
    probs, cov = letter_probs(top(hello=0.5, the=0.3), 2)
    assert cov["status"] == "none" and probs is None
    for tokens in (top(**{"\n": 0.8}), top(AB=0.8)):  # whitespace and two letters are no option
        assert letter_probs(tokens, 2) == (None, {"status": "none", "observed": 0, "missing": ["A", "B"]})
    probs, cov = letter_probs(top(A=0.2, B=0.3, _=0.4), 2)
    assert cov["status"] == "complete" and abs(probs[0] - 0.4) < 1e-12 and abs(cov["observed"] - 0.5) < 1e-12
    assert abs(sum(probs) - 1) < 1e-12
    reported = [{"prompt_tokens": 11, "completion_tokens": 1, "prompt_tokens_details": {"cached_tokens": 5}}]
    assert remote.total(reported * 2, "prompt_tokens") == 22
    assert remote.total([*reported, {"prompt_tokens": 9}], "completion_tokens") is None, "unknown, not 0"
    assert json.loads(json.dumps(0.123456789)) == 0.123456789
    item = {
        "state": {"text": "hi"},
        "questions": {
            "answer": {"type": "choice", "instructions": "Which?", "criteria": {"x": None, "y": None}}
        },
        "truth": {"answer": "x"},
    }
    swapped = json.loads(json.dumps(item))
    swapped["questions"]["answer"]["criteria"] = {"y": None, "x": None}
    assert fingerprint(item) != fingerprint(swapped), "option order must count"
    assert fingerprint(item) != fingerprint(item, "another"), "the prompt version must count"

    def ragtruth_row(i, label, size, task):
        row = {"row_idx": i, "row": {"task_type": task, "context": f"source {i}"}}
        return row, {"state": {"response": "word " * size}, "truth": {"answer": label}}

    tasks = [task for task in RAGTRUTH for _ in range(10)]
    unmatched = [ragtruth_row(i, "yes", 10, t) for i, t in enumerate(tasks)]
    unmatched += [ragtruth_row(100 + i, "no", 100, t) for i, t in enumerate(tasks)]
    try:
        ragtruth(unmatched, "check")
        raise AssertionError("RAGTruth must stop when its pairs cannot be length-matched")
    except ValueError:
        pass
    check_scoring()
    print("OK  letter readout, fingerprint, RAGTruth pairing and scoring checks")


def check_scoring():
    """The scorer's weighting, probability eligibility and failures, on made-up counts."""
    from jev import score

    sets = {
        "A": {"track": "headline", "group": "one"},
        "B": {"track": "headline", "group": "one"},
        "C": {"track": "headline", "group": "two"},
        "RewardBench": {"track": "headline", "group": "three"},
        "D": {"track": "auxiliary", "group": "two"},
    }
    counts = {
        ("A", None): [1, 1],
        ("B", None): [0, 1],
        ("C", None): [1, 2],
        ("D", None): [5, 5],  # auxiliary: never in the headline
        ("RewardBench", "Chat"): [1, 1],
        ("RewardBench", "Safety"): [1, 3],  # families averaged: 2/3, not the pooled 1/2
    }
    overall, groups = score.headline(counts, sets)
    assert groups == {"one": 0.5, "two": 0.5, "three": 2 / 3} and abs(overall - 5 / 9) < 1e-12
    partial = {"type": "choice", "choice": "x", "probabilities": {"x": 1.0, "y": 0.0}}
    assert score.distribution(partial | {"coverage": {"status": "partial"}}, ["x", "y"]) is None
    assert score.distribution(partial, ["x", "y"]) == [1.0, 0.0]
    assert score.distribution({"type": "noul", "noul": 0.25}, ["yes", "no"]) == [0.25, 0.75]
    assert score.distribution(None, ["yes", "no"]) is None
    row = {
        "set": "A",
        "source": "a · test row 7",
        "state": {"text": "hi"},
        "questions": {"q": {"type": "noul", "instructions": "?"}},
        "truth": {"q": "yes"},
        "answers": {},  # no answer: wrong, and no probabilities
    }
    (missing,) = score.outcomes(row, {}, {})
    assert not missing["right"] and missing["p"] is None
    probs = score.probability_scores([missing | {"p": [0.0, 1.0], "y": 0}, missing])
    assert probs["complete"] == 1 and probs["clipped"] == 1 and probs["brier"] == 2


def cli():
    args = sys.argv[1:]
    if args[:1] == ["freeze"]:
        freeze()
    elif args[:1] == ["export"]:
        export()
    elif args[:1] == ["score"] and len(args) > 1:
        from jev.score import score

        score(args[1:])
    elif args[:1] == ["check"]:
        check()
    elif args[:1] == ["tokens"]:
        tokens()
    elif args[:1] == ["run"] and len(args) == 2:
        run(args[1])
    else:
        print(__doc__)


if __name__ == "__main__":
    cli()
