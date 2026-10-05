"""How Core v1 picks a set's items: taking turns across labels, answer positions and topics, pairing
by length where length would give the answer away, and leaving out items not worth asking."""

import json
import random
import re
from collections import Counter

from jev.bench import datasets
from jev.bench.sets import SETS, MultipleChoice

PER_SET = 50  # items a set gives, unless it has more topics: then one per topic


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


FIRST = ("Jailbreak attempts", "Global-MMLU-Lite English")  # picked before the sets that depend on them


def answer_group(name, item):
    """What the pick balances on: the label, or for multiple choice the right answer's position."""
    truth = item["truth"]["answer"]
    if isinstance(SETS[name], MultipleChoice) and not SETS[name].scored:
        return list(item["questions"]["answer"]["criteria"]).index(truth)
    return truth


def balanced(pairs, key, count, seed):
    """Up to n items taking turns across groups, so no label or answer position dominates."""
    rng = random.Random(seed)
    groups = {}
    for pair in pairs:
        groups.setdefault(key(pair), []).append(pair)
    for members in groups.values():
        rng.shuffle(members)
    picked = []
    while len(picked) < count and any(groups.values()):
        for k in sorted(groups, key=str):
            if groups[k] and len(picked) < count:
                picked.append(groups[k].pop())
    return picked


def spread(pairs, topic, answer, count, seed):
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
    while len(picked) < count and any(topics.values()):
        for topic_key in order:
            if topics[topic_key] and len(picked) < count:
                pair = min(
                    topics[topic_key],
                    key=lambda candidate, topic_key=topic_key: (
                        overall[answer(candidate)],
                        within[topic_key][answer(candidate)],
                    ),
                )
                topics[topic_key].remove(pair)
                within[topic_key][answer(pair)] += 1
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
        for hub_row in datasets.rows_page(REDUX, subject, "test", 0)["rows"]:
            if hub_row["row"]["error_type"] == "ok":
                ok.add((subject, hub_row["row"]["question"].strip()))
    return ok


def usable(name, pairs):
    """Leave out items whose options repeat, exactly or after lower-casing and dropping punctuation,
    and decisions seen already (the same state, question and ordered options); for MMLU also every
    question MMLU-Redux did not mark ok. Items that only share a context stay."""
    if name == "MMLU":
        ok = redux_ok({r["row"]["subject"] for r, _ in pairs})
        pairs = [(r, item) for r, item in pairs if (r["row"]["subject"], r["row"]["question"].strip()) in ok]
    seen, kept = set(), []
    for hub_row, item in pairs:
        if isinstance(SETS[name], MultipleChoice):
            options = [
                re.sub(r"[^\w\s]", "", str(o)).lower().strip()
                for o in SETS[name].options_of(hub_row["row"])[0]
            ]
            if len(set(options)) < len(options):
                continue
        decision = json.dumps([item["state"], item["questions"]], ensure_ascii=False)
        if decision not in seen:
            seen.add(decision)
            kept.append((hub_row, item))
    return kept


def pick(name, pairs, before, seed):
    """A set's items, and anything its rule records. `before` holds the picks of the sets in FIRST."""

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
