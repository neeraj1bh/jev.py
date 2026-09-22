"""Live comparison page.

Two modes. Generate vs readout: one local model answers the same questions two ways, writing
JSON token by token on the left, reading the logits in one pass on the right. Compare: the same
request to any two backends side by side, local, a llama.cpp server or hosted.

Nothing is loaded at start. A local model is downloaded when first picked: into the Hugging
Face cache if it is already there, else into ./models (git-ignored; JEV_MODELS overrides).

    uv run prod [model_id] [port]     # then open http://localhost:8080
"""

import ast
import contextlib
import gc
import gzip
import hashlib
import json
import mimetypes
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock, Thread

import torch
from huggingface_hub import try_to_load_from_cache
from huggingface_hub.constants import HF_HUB_CACHE
from transformers import TextIteratorStreamer

from jev import hub
from jev.core import DEFAULT_MODEL, ROOT, SYSTEM, Jev, _options, _text
from jev.eval import typesafe_rows
from jev.remote import BACKENDS, EXTRAS, NoProbabilities, Remote, env

WEB = os.path.join(ROOT, "web", "dist")  # the built page; see web/
MODELS = os.environ.get("JEV_MODELS") or os.path.join(ROOT, "models")
LOCAL = {  # tested models: weights on disk, GB
    "Qwen/Qwen2.5-0.5B-Instruct": 1.0,
    "Qwen/Qwen2.5-1.5B-Instruct": 3.1,
    "Qwen/Qwen2.5-3B-Instruct": 6.2,
}
HOSTED = {
    "typesafe": "Jev (TypeSafe)",
    "deepseek": "DeepSeek",
    "openai": "OpenAI",
    "openrouter": "OpenRouter",
    "moonshot": "Kimi",
    "vercel": "Jev (Vercel)",
}
DATA = os.path.join(ROOT, "data")  # dataset rows fetched for the demo, git-ignored
ADDED_PATH = os.path.join(DATA, "added-models.json")  # Hugging Face models added in the page: id -> GB
LOGS = os.path.join(ROOT, "results", "logs", "demo")  # one .jsonl per batch, git-ignored
ROWS = "https://datasets-server.huggingface.co/rows?dataset={}&config={}&split={}&offset={}&length=100"
# name: (Hub dataset, config, split, state fields, question, label field, the label meaning yes)
DATASETS = {
    "SST-2 sentiment": (
        "stanfordnlp/sst2", "default", "validation", {"review": "sentence"},
        "Is this review positive?", "label", "positive",
    ),
    "RTE entailment": (
        "nyu-mll/glue", "rte", "validation", {"sentence A": "sentence1", "sentence B": "sentence2"},
        "Does sentence A entail sentence B?", "label", "entailment",
    ),
    "BoolQ": (
        "google/boolq", "default", "validation", {"passage": "passage", "question": "question"},
        "Is the answer to the question yes?", "answer", True,
    ),
    "SNLI": (
        "stanfordnlp/snli", "plain_text", "test", {"premise": "premise", "hypothesis": "hypothesis"},
        "How does the hypothesis relate to the premise?", "label", None,
    ),
    "AG News topic": (
        "fancyzhx/ag_news", "default", "test", {"news": "text"},
        "Which section does this news belong to?", "label", None,
    ),
    "Tweet emotion": (
        "cardiffnlp/tweet_eval", "emotion", "test", {"tweet": "text"},
        "Which emotion does this tweet express?", "label", None,
    ),
    "Banking77": (
        "legacy-datasets/banking77", "default", "test", {"message": "text"},
        "What does the customer want?", "label", None,
    ),
    "CLINC150": (
        "clinc/clinc_oos", "plus", "test", {"message": "text"},
        "What does the user want? (oos = none of these)", "intent", None,
    ),
    "Tweet sentiment": (
        "cardiffnlp/tweet_eval", "sentiment", "test", {"tweet": "text"},
        "What is the sentiment of this tweet?", "label", None,
    ),
    "Tweet hate": (
        "cardiffnlp/tweet_eval", "hate", "test", {"tweet": "text"},
        "Is this tweet hateful towards immigrants or women?", "label", "hate",
    ),
    "Tweet irony": (
        "cardiffnlp/tweet_eval", "irony", "test", {"tweet": "text"},
        "Is this tweet ironic?", "label", "irony",
    ),
    "Tweet offensive": (
        "cardiffnlp/tweet_eval", "offensive", "test", {"tweet": "text"},
        "Is this tweet offensive?", "label", "offensive",
    ),
    "ANLI round 3": (
        "facebook/anli", "plain_text", "test_r3", {"premise": "premise", "hypothesis": "hypothesis"},
        "How does the hypothesis relate to the premise?", "label", None,
    ),
    "MultiNLI mismatched": (
        "nyu-mll/multi_nli", "default", "validation_mismatched",
        {"premise": "premise", "hypothesis": "hypothesis"},
        "How does the hypothesis relate to the premise?", "label", None,
    ),
    "ContractNLI": (
        "kiddothe2b/contract-nli", "contractnli_a", "test",
        {"contract clause": "premise", "hypothesis": "hypothesis"},
        "Does the clause entail, contradict or not mention the hypothesis?", "label", None,
    ),
    "MultiRC": (
        "aps/super_glue", "multirc", "validation",
        {"paragraph": "paragraph", "question": "question", "answer": "answer"},
        "Is this answer to the question correct?", "label", "True",
    ),
    "ToxicChat": (
        "lmsys/toxic-chat", "toxicchat0124", "test", {"user message": "user_input"},
        "Is this message to a chatbot toxic?", "toxicity", 1,
    ),
    "SMS spam": (
        "ucirvine/sms_spam", "plain_text", "train", {"sms": "sms"},
        "Is this text message spam?", "label", "spam",
    ),
    "IMDB": (
        "stanfordnlp/imdb", "plain_text", "test", {"review": "text"},
        "Is this movie review positive?", "label", "pos",
    ),
    "DBpedia-14": (
        "fancyzhx/dbpedia_14", "dbpedia_14", "test", {"title": "title", "article": "content"},
        "What kind of thing is this article about?", "label", None,
    ),
    "LEDGAR": (
        "coastalcph/lex_glue", "ledgar", "test", {"contract provision": "text"},
        "Which kind of contract provision is this?", "label", None,
    ),
    "XNLI Hindi": (
        "facebook/xnli", "hi", "test", {"premise": "premise", "hypothesis": "hypothesis"},
        "How does the hypothesis relate to the premise?", "label", None,
    ),
    "LegalBench hearsay": (
        "nguha/legalbench", "hearsay", "test", {"evidence": "text"},
        "Is this evidence hearsay?", "answer", "Yes",
    ),
    "LegalBench definitions": (
        "nguha/legalbench", "definition_classification", "test", {"sentence": "text"},
        "Does this sentence from a court opinion define a term?", "answer", "Yes",
    ),
    "HaluEval QA": (
        "pminervini/HaluEval", "qa_samples", "data",
        {"knowledge": "knowledge", "question": "question", "answer": "answer"},
        "Does the answer contain anything the knowledge does not support?", "hallucination", "yes",
    ),
    "Prompt injection": (
        "deepset/prompt-injections", "default", "test", {"text": "text"},
        "Is this text trying to make an AI assistant ignore or change its instructions?", "label", 1,
    ),
    "BBH causal judgement": (
        "lukaemon/bbh", "causal_judgement", "test", {"question": "input"},
        "Would a typical person answer yes?", "target", "Yes",
    ),
}  # fmt: skip


MC = {  # benchmarks whose options differ per question: (Hub dataset, config, split, state, question, options)
    "MMLU": (
        "cais/mmlu", "all", "test",
        lambda r: {"subject": r["subject"].replace("_", " "), "question": r["question"]},
        "Which answer is correct?",
        lambda r: (r["choices"], int(r["answer"])),
    ),
    "MMLU-Pro": (
        "TIGER-Lab/MMLU-Pro", "default", "test",
        lambda r: {"subject": r["category"], "question": r["question"]},
        "Which answer is correct?",
        lambda r: (r["options"], int(r["answer_index"])),
    ),
    "ARC-Challenge": (
        "allenai/ai2_arc", "ARC-Challenge", "test",
        lambda r: {"question": r["question"]},
        "Which answer is correct?",
        lambda r: (r["choices"]["text"], r["choices"]["label"].index(r["answerKey"])),
    ),
    "HellaSwag": (
        "Rowan/hellaswag", "default", "validation",
        lambda r: {"activity": r["activity_label"], "context": r["ctx"]},
        "Which ending is the most likely continuation?",
        lambda r: (r["endings"], int(r["label"])),
    ),
    "TruthfulQA": (
        "truthfulqa/truthful_qa", "multiple_choice", "validation",
        lambda r: {"question": r["question"]},
        "Which answer is true?",
        lambda r: (r["mc1_targets"]["choices"], r["mc1_targets"]["labels"].index(1)),
    ),
    "CommonsenseQA": (
        "tau/commonsense_qa", "default", "validation",
        lambda r: {"question": r["question"]},
        "Which answer is the most sensible?",
        lambda r: (r["choices"]["text"], r["choices"]["label"].index(r["answerKey"])),
    ),
    "OpenBookQA": (
        "allenai/openbookqa", "main", "test",
        lambda r: {"question": r["question_stem"]},
        "Which answer is correct?",
        lambda r: (r["choices"]["text"], r["choices"]["label"].index(r["answerKey"])),
    ),
    "WinoGrande": (
        "allenai/winogrande", "winogrande_debiased", "validation",
        lambda r: {"sentence": r["sentence"]},
        "Who or what does the blank (_) refer to?",
        lambda r: ([r["option1"], r["option2"]], int(r["answer"]) - 1),
    ),
    "MedQA": (
        "GBaker/MedQA-USMLE-4-options", "default", "test",
        lambda r: {"question": r["question"]},
        "Which answer is correct?",
        lambda r: (list(r["options"].values()), list(r["options"]).index(r["answer_idx"])),
    ),
    "PubMedQA": (
        "qiaojin/PubMedQA", "pqa_labeled", "train",
        lambda r: {"abstract": " ".join(r["context"]["contexts"]), "question": r["question"]},
        "Given the abstract, what is the answer to the question?",
        lambda r: (["yes", "no", "maybe"], ["yes", "no", "maybe"].index(r["final_decision"])),
    ),
    "Arena votes": (
        "lmarena-ai/arena-human-preference-55k", "default", "train",
        lambda r: {
            "prompt": _joined(r["prompt"]),
            "response A": _joined(r["response_a"]),
            "response B": _joined(r["response_b"]),
        },
        "Which response did the person who asked prefer?",
        lambda r: (
            ["A is better", "B is better", "a tie"],
            [r["winner_model_a"], r["winner_model_b"], r["winner_tie"]].index(1),
        ),
    ),
    "RewardBench": (
        "allenai/reward-bench", "default", "filtered",
        lambda r: {"prompt": r["prompt"], **_pair(r["id"], r["chosen"], r["rejected"])},
        "Which response is better?",
        lambda r: (["A is better", "B is better"], 0 if int(r["id"]) % 2 == 0 else 1),
    ),
    "Global-MMLU Hindi": (
        "CohereLabs/Global-MMLU", "hi", "test",
        lambda r: {"subject": r["subject"].replace("_", " "), "question": r["question"]},
        "Which answer is correct?",
        lambda r: ([r[f"option_{k}"] for k in "abcd"], "ABCD".index(r["answer"])),
    ),
    "Global-MMLU Chinese": (
        "CohereLabs/Global-MMLU", "zh", "test",
        lambda r: {"subject": r["subject"].replace("_", " "), "question": r["question"]},
        "Which answer is correct?",
        lambda r: ([r[f"option_{k}"] for k in "abcd"], "ABCD".index(r["answer"])),
    ),
    "BBQ race and ethnicity": (
        "walledai/BBQ", "default", "raceEthnicity",
        lambda r: {"context": r["context"], "question": r["question"]},
        "Which answer is correct?",
        lambda r: (r["choices"], int(r["answer"])),
    ),
    "MuSR murder mysteries": (
        "TAUR-Lab/MuSR", "default", "murder_mysteries",
        lambda r: {"story": r["narrative"], "question": r["question"]},
        "Which answer does the story support?",
        lambda r: (ast.literal_eval(r["choices"]), int(r["answer_index"])),
    ),
    "BBH date understanding": (
        "lukaemon/bbh", "date_understanding", "test",
        lambda r: {"question": r["input"].split("\nOptions:")[0]},
        "Which answer is correct?",
        lambda r: _bbh_options(r["input"], r["target"]),
    ),
    "GPQA Diamond": (  # gated: accept its terms on the Hub and put HF_TOKEN in .env
        "Idavidrein/gpqa", "gpqa_diamond", "train",
        lambda r: {"question": r["Question"]},
        "Which answer is correct?",
        lambda r: _shuffled(
            r["Question"], r["Correct Answer"], [r[f"Incorrect Answer {k}"] for k in (1, 2, 3)]
        ),
    ),
}  # fmt: skip


def _joined(value):
    """Arena turns are stored as a JSON list of strings."""
    try:
        return "\n\n".join(x or "" for x in json.loads(value))
    except (TypeError, ValueError):
        return value


def _pair(item_id, chosen, rejected):
    """RewardBench always lists the better response first; alternate by id so A is not always right."""
    a, b = (chosen, rejected) if int(item_id) % 2 == 0 else (rejected, chosen)
    return {"response A": a, "response B": b}


def _bbh_options(text, target):
    """BBH lists its options inside the question as "(A) ..." lines; the target is "(A)"."""
    lines = text.split("\nOptions:\n")[1].splitlines()
    letters = [line[1] for line in lines]
    return [line[4:] for line in lines], letters.index(target[1])


def _shuffled(question, right, wrong):
    """GPQA keeps the right answer first; a fixed per-question order keeps every run comparable."""
    options = [right, *wrong]
    random.Random(question).shuffle(options)
    return options, options.index(right)


ABOUT = {  # one line per set, shown when hovering it in the page
    "SST-2 sentiment": "Is this movie-review sentence positive?",
    "RTE entailment": "Does sentence A entail sentence B?",
    "BoolQ": "Given a Wikipedia passage, is the answer to the question yes?",
    "SNLI": "Premise and hypothesis: entailment, neutral or contradiction?",
    "AG News topic": "News snippet: World, Sports, Business or Sci/Tech?",
    "Tweet emotion": "Tweet: anger, joy, optimism or sadness?",
    "Banking77": "Banking customer message: which of 77 intents?",
    "CLINC150": "Assistant request: which of 150 intents, or out of scope?",
    "TypeSafe cases": "TypeSafe's published cases: a business document with several questions",
    "MMLU": "Exam question from 57 subjects, four choices",
    "MMLU-Pro": "Harder exam question, ten choices",
    "ARC-Challenge": "Grade-school science question that simple methods get wrong",
    "HellaSwag": "Which ending continues the scene most plausibly?",
    "TruthfulQA": "Which answer is true, where a common misconception is also offered?",
    "Tweet sentiment": "Tweet: negative, neutral or positive?",
    "Tweet hate": "Is this tweet hate speech against immigrants or women?",
    "Tweet irony": "Is this tweet ironic?",
    "Tweet offensive": "Is this tweet offensive?",
    "ANLI round 3": "Adversarial NLI, written to fool strong models: entailment, neutral or contradiction?",
    "MultiNLI mismatched": "NLI on genres unseen in training: entailment, neutral or contradiction?",
    "ContractNLI": "An NDA clause against a hypothesis: entailed, contradicted or not mentioned?",
    "MultiRC": "A paragraph, a question and a candidate answer: is the answer correct?",
    "ToxicChat": "A real user message to a chatbot: toxic or not, labelled by people?",
    "SMS spam": "Is this text message spam?",
    "IMDB": "Is this full movie review positive?",
    "DBpedia-14": "Wikipedia article: which of 14 kinds of thing?",
    "LEDGAR": "Contract provision: which of 100 provision types?",
    "CommonsenseQA": "Everyday-knowledge question, five choices",
    "OpenBookQA": "Elementary science question needing a fact plus common sense",
    "WinoGrande": "Who does the pronoun gap refer to? Two choices",
    "MedQA": "US medical licensing exam question, four choices",
    "PubMedQA": "A research abstract and a question: yes, no or maybe?",
    "Arena votes": "Two chatbot answers to one prompt: which did the person prefer, or a tie?",
    "RewardBench": "A prompt and two responses: which is better? Labels from a curated benchmark",
    "GPQA Diamond": "Graduate-level science question written to resist search (needs HF_TOKEN)",
    "XNLI Hindi": "NLI in Hindi: entailment, neutral or contradiction?",
    "Global-MMLU Hindi": "MMLU translated into Hindi, four choices",
    "Global-MMLU Chinese": "MMLU translated into Chinese, four choices",
    "LegalBench hearsay": "A piece of evidence and the issue it is offered for: is it hearsay?",
    "LegalBench definitions": "A sentence from a US court opinion: does it define a term?",
    "HaluEval QA": "Knowledge, a question and an answer: does the answer add unsupported claims?",
    "Prompt injection": "A message to an assistant: is it trying to override its instructions?",
    "BBQ race and ethnicity": "A short scene and a question where one answer is a stereotype",
    "MuSR murder mysteries": "A 1,000-word mystery: who is the most likely murderer? Two suspects",
    "BBH causal judgement": "A story about cause and blame: would a typical person say yes?",
    "BBH date understanding": "Date arithmetic in words, up to six choices",
    "Core v1": (
        "Frozen 2026-09-22: 50 balanced items from each set and every TypeSafe step. Banking77, "
        "CLINC150 and LEDGAR join only when every picked model reads over 26 options"
    ),
}
CORE = ("Core v1",)  # frozen benchmarks, see bench.py
try:  # input tokens per item, measured by `jev-bench tokens`, for the page's cost estimates
    with open(os.path.join(ROOT, "benchmarks", "core-v1-tokens.json")) as f:
        SIZES = json.load(f)["per_item"]
except (OSError, ValueError):
    SIZES = {}
GATED = {"GPQA Diamond"}  # need a Hugging Face token and the set's terms accepted
CORE_ITEMS = {}
GROUPS = {  # menu headings, in order; every set belongs to one
    "Frozen benchmarks": list(CORE),
    "Sentiment and tone": [
        "SST-2 sentiment", "IMDB", "Tweet sentiment", "Tweet emotion", "Tweet irony",
    ],
    "Meaning and reading": [
        "RTE entailment", "SNLI", "MultiNLI mismatched", "ANLI round 3", "BoolQ", "MultiRC",
        "WinoGrande", "HaluEval QA",
    ],
    "Reasoning": ["MuSR murder mysteries", "BBH causal judgement", "BBH date understanding"],
    "Other languages": ["XNLI Hindi", "Global-MMLU Hindi", "Global-MMLU Chinese"],
    "Intent and topic": ["Banking77", "CLINC150", "AG News topic", "DBpedia-14"],
    "Knowledge and exams": [
        "MMLU", "MMLU-Pro", "ARC-Challenge", "OpenBookQA", "CommonsenseQA", "HellaSwag",
        "TruthfulQA", "MedQA", "PubMedQA", "GPQA Diamond",
    ],
    "Safety and spam": [
        "ToxicChat", "Tweet hate", "Tweet offensive", "SMS spam", "Prompt injection",
        "BBQ race and ethnicity",
    ],
    "Which answer is better": ["Arena votes", "RewardBench"],
    "Contracts and business": [
        "ContractNLI", "LEDGAR", "LegalBench hearsay", "LegalBench definitions", "TypeSafe cases",
    ],
}  # fmt: skip
OPTIONS = {
    "MMLU": 4,
    "MMLU-Pro": 10,
    "ARC-Challenge": 5,
    "HellaSwag": 4,
    "TruthfulQA": 13,
    "SNLI": 3,
    "AG News topic": 4,
    "Tweet emotion": 4,
    "Banking77": 77,
    "CLINC150": 151,
    "Tweet sentiment": 3,
    "ANLI round 3": 3,
    "MultiNLI mismatched": 3,
    "ContractNLI": 3,
    "DBpedia-14": 14,
    "LEDGAR": 100,
    "CommonsenseQA": 5,
    "OpenBookQA": 4,
    "WinoGrande": 2,
    "MedQA": 4,
    "PubMedQA": 3,
    "Arena votes": 3,
    "RewardBench": 2,
    "GPQA Diamond": 4,
    "XNLI Hindi": 3,
    "Global-MMLU Hindi": 4,
    "Global-MMLU Chinese": 4,
    "BBQ race and ethnicity": 3,
    "MuSR murder mysteries": 2,
    "BBH date understanding": 6,
}  # the rest are yes/no
LETTER = {
    "deepseek",
    "moonshot",
    "openrouter",
    "openai",
    "llamacpp",
}  # read the answer as a letter: 26 options at most
PROGRESS = {}  # downloading now: name -> [done, total, unit]; a model is measured on disk as it arrives
DECKS = {}  # dataset name -> row indices not dealt yet, so a batch never repeats an item


def dataset_path(name):
    return os.path.join(DATA, name.replace(" ", "-").lower() + ".json")


class Exhausted(Exception):
    pass


def deal(name, n, fresh):
    """The next unseen row index; a fresh deck on request, never a silent reshuffle."""
    if fresh or name not in DECKS:
        DECKS[name] = random.sample(range(n), n)
    if not DECKS[name]:
        raise Exhausted(f"all {n} items of {name} are done")
    return DECKS[name].pop()


def rows_page(hub, config, split, offset):
    """One page of 100 rows; HF_TOKEN, when set, opens sets that need a Hub login."""
    token = env("HF_TOKEN")
    req = urllib.request.Request(
        ROWS.format(hub, config, split, offset),
        headers={"authorization": f"Bearer {token}"} if token else {},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403) or (e.code == 404 and token):  # the Hub hides gated sets as 404
                raise ValueError(
                    f"{hub} is behind a login: accept its terms at https://huggingface.co/datasets/{hub}"
                    + ("" if token else ", then add a Hugging Face token under Keys")
                ) from e
            if e.code != 429 or attempt == 3:
                raise
            time.sleep(float(e.headers.get("retry-after") or 5 * (attempt + 1)))  # the Hub rate-limits


def download(name, hub, config, split):
    """300 rows of a set (three random pages), fetched once into DATA."""
    path = dataset_path(name)
    if not os.path.exists(path):
        PROGRESS[name] = [0, 3, "pages"]
        try:
            first = rows_page(hub, config, split, 0)
            total, rows = first["num_rows_total"], first["rows"]
            starts = range(100, max(101, total - 100), 100)
            picked = random.sample(starts, min(2, len(starts)))
            PROGRESS[name] = [1, 1 + len(picked), "pages"]
            for o in picked:
                rows += rows_page(hub, config, split, o)["rows"]
                PROGRESS[name][0] += 1
        finally:
            PROGRESS.pop(name, None)
        os.makedirs(DATA, exist_ok=True)
        with open(path, "w") as f:
            json.dump({"features": first["features"], "rows": rows}, f)
    with open(path) as f:
        return json.load(f)


def typesafe_item(case, node, doc, qs, truth):
    """One TypeSafe step: its document and every question on it, each with its consensus label."""
    return {
        "state": doc,
        "questions": qs,
        "truth": {k: {"true": "yes", "false": "no"}.get(v, v) for k, v in truth.items()},
        "source": f"TypeSafe · {case} · {node}",
        "options": None,
    }


def labelled_rows(name, page):
    """The rows of a downloaded page that carry a label; SNLI marks unlabelled pairs -1."""
    if name in MC:
        return page["rows"]
    label = DATASETS[name][5]
    return [r for r in page["rows"] if r["row"][label] != -1]


def row_item(name, page, r):
    """One downloaded row as a request with its truth, for a set in DATASETS or MC."""
    if name in MC:
        hub, _, split, state_of, question, options_of = MC[name]
        options, answer = options_of(r["row"])
        return {
            "state": state_of(r["row"]),
            "questions": {
                "answer": {"type": "choice", "instructions": question, "criteria": dict.fromkeys(options)}
            },
            "truth": {"answer": options[answer]},
            "source": f"{hub} · {split} row {r['row_idx']}",
            "options": len(options),
        }
    hub, _, split, fields, question, label, yes = DATASETS[name]
    names = next(x["type"].get("names") for x in page["features"] if x["name"] == label)
    row, value = r["row"], r["row"][label]
    value = names[value] if names else value
    if yes is not None:
        q = {"type": "noul", "instructions": question}
        truth = "yes" if value == yes else "no"
    else:
        q = {"type": "choice", "instructions": question, "criteria": dict.fromkeys(names)}
        truth = value
    return {
        "state": {k: row[v] for k, v in fields.items()},
        "questions": {"answer": q},
        "truth": {"answer": truth},
        "source": f"{hub} · {split} row {r['row_idx']}",
        "options": 2 if yes is not None else len(names),
    }


def sample(name, fresh=False, wide=False):
    """One random labelled item as a request, plus its truth. The first call per dataset
    downloads 300 rows (three random pages) into DATA; later calls deal from them."""
    if name in CORE:
        from jev import bench  # bench imports this module

        deck = f"{name} + wide" if wide else name  # wide: every picked model reads over 26 options
        if deck not in CORE_ITEMS:
            CORE_ITEMS[deck] = bench.load("main") + (bench.load("wide") if wide else [])
        items = CORE_ITEMS[deck]
        return items[deal(deck, len(items), fresh)] | {"pool": len(items), "left": len(DECKS[deck])}
    if name == "TypeSafe cases":
        cases = typesafe_rows()
        item = typesafe_item(*cases[deal(name, len(cases), fresh)])
        return item | {"pool": len(cases), "left": len(DECKS[name])}
    hub, config, split = (DATASETS.get(name) or MC[name])[:3]
    page = download(name, hub, config, split)
    rows = labelled_rows(name, page)
    item = row_item(name, page, rows[deal(name, len(rows), fresh)])
    return item | {"pool": len(rows), "left": len(DECKS[name])}


DEVICE = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
# jev.py loads bf16 on CUDA and on CPUs with native bf16, float32 elsewhere (twice the memory)
BF16 = DEVICE == "cuda" or getattr(torch.cpu, "_is_avx512_bf16_supported", lambda: False)()


def where(model_id):
    """(cache folder, downloaded?): the Hugging Face cache if the model is there, else MODELS."""
    for cache in (HF_HUB_CACHE, MODELS):
        found = [
            try_to_load_from_cache(model_id, f, cache_dir=cache)
            for f in ("config.json", "model.safetensors", "model.safetensors.index.json")
        ]
        if isinstance(found[0], str) and any(isinstance(x, str) for x in found[1:]):
            return cache, True
    return MODELS, False


def text_answers(text, questions):
    """A written JSON reply in the shape of a probability reply, each answer counted as certain."""
    try:
        got = json.loads(text.replace("```json", "").replace("```", "").strip())
    except ValueError:
        return {}
    out = {}
    for qid, q in questions.items():
        if not isinstance(got, dict) or qid not in got:
            continue
        v = str(got[qid]).strip().lower()
        first = (v.replace(",", " ").split() or [""])[0]
        if q["type"] == "noul":
            out[qid] = {"type": "noul", "noul": 1.0 if first in ("yes", "true") else 0.0}
        elif q["type"] == "choice":
            hit = next((la for la in _options(q)[0] if v == la.lower() or v.startswith(la.lower())), None)
            if hit is not None:
                out[qid] = {"type": "choice", "choice": hit, "probabilities": {hit: 1.0}}
        else:
            with contextlib.suppress(ValueError):
                out[qid] = {"type": "score", "score": float(first)}
    return out


def log_row(body, backend, answers, ms):
    """One answer of a run, appended to its session's file."""
    name = "".join(c if c.isalnum() or c in "._-" else "-" for c in body["log"])[:120]
    os.makedirs(LOGS, exist_ok=True)
    row = {k: body.get(k) for k in ("dataset", "source", "state", "questions", "truth", "mode", "sides")}
    row |= {"backend": backend, "answers": answers, "ms": ms}
    with LOCK, open(os.path.join(LOGS, name + ".jsonl"), "a") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def answer(a):
    """The answer a probability reply amounts to, in the label set's words."""
    if a["type"] == "noul":
        return "yes" if a["noul"] >= 0.5 else "no"
    return a["choice"] if a["type"] == "choice" else str(round(a["score"]))


def right(a, truth):
    norm = {"true": "yes", "false": "no"}
    return answer(a).lower().strip() == norm.get(str(truth).lower(), str(truth).lower().strip())


def item_key(x):
    """One logged item: two TypeSafe steps can share a document, so the questions count too."""
    return x["source"], json.dumps((x["state"], x["questions"]), sort_keys=True)


SUMMARIES = {}  # file name -> (mtime, size, summary); a saved run is read again only when it changes


def summary(f):
    """One saved batch: set, backends, items and each side's score."""
    path = os.path.join(LOGS, f)
    stat = os.stat(path)
    cached = SUMMARIES.get(f)
    if cached and cached[:2] == (stat.st_mtime, stat.st_size):
        return cached[2]
    with open(path) as fh:
        lines = [json.loads(x) for x in fh if x.strip()]
    sides = sorted(
        dict.fromkeys(x["backend"] for x in lines), key=lambda b: not b.endswith("#text")
    )  # written side first
    order = next((x["sides"] for x in lines if x.get("sides")), None)
    if order and lines[0].get("mode") != "gen":  # compare: the order the models were picked in
        sides.sort(key=lambda b: order.index(b) if b in order else len(order))
    items = len({item_key(x) for x in lines})
    score = {b: [0, 0] for b in sides}
    for x in lines:
        for qid, t in x["truth"].items():
            score[x["backend"]][1] += 1
            score[x["backend"]][0] += qid in x["answers"] and right(x["answers"][qid], t)
    ds, kind = (lines[0]["dataset"], lines[0].get("mode") or "cmp") if lines else ("", "cmp")
    out = {"name": f[:-6], "dataset": ds, "backends": sides, "items": items, "score": score, "mode": kind}
    if items == 1:  # which item, so runs that can be compared are visible before opening them
        out["item"] = lines[0].get("source")
    # Short item fingerprints, so the page knows which runs share items before opening any; a big
    # run sends one digest of all of them instead.
    keys = sorted({hashlib.sha1(json.dumps(item_key(x)).encode()).hexdigest()[:8] for x in lines})
    out["keys" if len(keys) <= 200 else "digest"] = (
        keys if len(keys) <= 200 else hashlib.sha1(",".join(keys).encode()).hexdigest()[:12]
    )
    SUMMARIES[f] = stat.st_mtime, stat.st_size, out
    return out


def runs():
    """The saved batches, newest first."""
    if not os.path.isdir(LOGS):
        return []
    return [summary(f) for f in sorted(os.listdir(LOGS), reverse=True) if f.endswith(".jsonl")]


RUN_BODIES = {}  # file name -> (mtime, size, JSON body); a big run is merged once, not per open


def run_body(name):
    """run_rows as the JSON the page fetches, rebuilt only when the file changes."""
    path = os.path.join(LOGS, os.path.basename(name) + ".jsonl")
    stat = os.stat(path)
    cached = RUN_BODIES.get(path)
    if not cached or cached[:2] != (stat.st_mtime, stat.st_size):
        cached = RUN_BODIES[path] = (stat.st_mtime, stat.st_size, json.dumps(run_rows(name)).encode())
    return cached[2]


def run_rows(name):
    """One saved batch as items, each with both sides' answers, in the order they ran."""
    path = os.path.join(LOGS, os.path.basename(name) + ".jsonl")
    items = {}
    with open(path) as fh:
        for x in map(json.loads, filter(str.strip, fh)):
            it = items.setdefault(
                item_key(x), {"it": {k: x[k] for k in ("state", "questions", "truth", "source")}, "sides": {}}
            )
            it["sides"][x["backend"]] = {"ms": x["ms"], "res": {"answers": x["answers"]}}
    return list(items.values())


def folder_bytes(path):
    return sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs)


def progress():
    """Everything downloading now; a model's progress is the size of its folder so far."""
    out = {}
    for k, (done, total, unit) in list(PROGRESS.items()):
        if unit == "bytes":
            done = folder_bytes(done) if os.path.isdir(done) else 0
        out[k] = {"done": done, "total": total, "unit": unit}
    return out


def memory_gb():
    if DEVICE == "cuda":
        return torch.cuda.get_device_properties(0).total_memory / 1e9
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1e9
    except (ValueError, OSError, AttributeError):  # Windows has no sysconf
        return None


def llamacpp_url():
    return env("LLAMACPP_URL") or BACKENDS["llamacpp"][1]


OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key"
GATEWAY = {"at": 0.0, "models": []}  # OpenRouter's catalog, refetched every few hours


GATEWAY_CHECKED = os.path.join(DATA, "gateway-checked.json")  # model -> did it return probabilities
# The same check as shipped with the package (2026-09-22), so a fresh clone lists the working
# models before any key is set; this machine's own checks, in DATA, take precedence.
SHIPPED_CHECKED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "openrouter-checked.json")


def read_checked():
    checked = {}
    for path in (SHIPPED_CHECKED, GATEWAY_CHECKED):
        try:
            with open(path) as f:
                checked |= json.load(f)
        except (OSError, ValueError):
            pass
    return checked


CHECKED = read_checked()


def check_gateway(ids):
    """Ask each model one tiny question; keep only those whose answer carries probabilities.
    The catalog claims top_logprobs for many models whose providers then send none."""
    question = {"q": {"type": "noul", "instructions": "Is this a greeting?"}}
    for n, bid in enumerate(ids):
        PROGRESS["gateway"] = [n, len(ids), "models"]
        try:
            Remote("openrouter", model=bid.split(":", 1)[1], patient=False).ask({"text": "hello"}, question)
            CHECKED[bid] = True
        except urllib.error.HTTPError as e:
            if e.code == 429:  # rate limited (free models allow 50 a day): leave it for another day
                continue
            if e.code in (401, 402, 403):  # bad key or no credit left: says nothing about any model
                break
            CHECKED[bid] = False
        except (NoProbabilities, ValueError, KeyError, IndexError):
            CHECKED[bid] = False
        except OSError:
            break  # offline; try again next time
        os.makedirs(DATA, exist_ok=True)
        with open(GATEWAY_CHECKED, "w") as f:
            json.dump(CHECKED, f)
        time.sleep(1)
    PROGRESS.pop("gateway", None)


def gateway():
    """OpenRouter models that really return top log-probabilities, the only ones a readout can use."""
    if time.time() - GATEWAY["at"] > 6 * 3600:
        try:
            with urllib.request.urlopen("https://openrouter.ai/api/v1/models", timeout=10) as r:
                data = json.load(r)["data"]
        except (OSError, ValueError, KeyError):
            return []  # offline: the page simply shows no gateway models
        usable = [
            m
            for m in data
            if "top_logprobs" in (m.get("supported_parameters") or [])
            and m.get("architecture", {}).get("output_modalities") == ["text"]  # no image or audio models
            and not m["name"].endswith("(batch)")
        ]
        GATEWAY.update(at=time.time(), models=usable)
    var = BACKENDS["openrouter"][0]
    ready = bool(env(var))
    unchecked = ["openrouter:" + m["id"] for m in GATEWAY["models"] if "openrouter:" + m["id"] not in CHECKED]
    if ready and unchecked and "gateway" not in PROGRESS:
        PROGRESS["gateway"] = [0, len(unchecked), "models"]
        Thread(target=check_gateway, args=(unchecked,), daemon=True).start()
    return [
        {
            "id": "openrouter:" + m["id"],
            "group": "gateway",
            "provider": m["id"].lstrip("~").split("/")[0],
            "label": m["name"].split(": ", 1)[-1],
            "ready": ready,
            "key": var,
            "max": 26,
            "created": m.get("created", 0),
            "free": m["id"].endswith(":free"),  # OpenRouter marks its free variants this way
            "price": round(float(m.get("pricing", {}).get("prompt") or 0) * 1e6, 3),  # $ per 1M input tokens
            "price_out": round(float(m.get("pricing", {}).get("completion") or 0) * 1e6, 3),
        }
        for m in GATEWAY["models"]
        if CHECKED.get("openrouter:" + m["id"])
    ]


def added():
    try:
        with open(ADDED_PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def add_model(model_id):
    """Check a Hugging Face id and remember it; nothing downloads until it is picked."""
    gb = hub.check(model_id, env("HF_TOKEN"))
    models = added() | {model_id: gb}
    os.makedirs(DATA, exist_ok=True)
    with open(ADDED_PATH, "w") as f:
        json.dump(models, f, indent=1)


def model_gb(model_id):
    return LOCAL.get(model_id) or added().get(model_id)


def backends(extra):
    """Everything the page can pick, with what it needs before it can run."""
    out, mem = [], memory_gb()
    for m in dict.fromkeys([*LOCAL, *added(), *extra]):
        if m.startswith("remote:"):
            continue
        cache, have = where(m)
        gb = model_gb(m)
        out.append(
            {
                "id": m,
                "group": "local",
                "label": m.split("/")[-1].removesuffix("-Instruct"),
                "ready": have,
                "path": os.path.join(cache, "models--" + m.replace("/", "--")),
                "gb": gb,
                "need_gb": gb and round(gb * (1 if BF16 else 2) * 1.3, 1),
                "have_gb": mem and round(mem, 1),
                "device": DEVICE,
                "tested": m in LOCAL,
            }
        )
    url = llamacpp_url()
    try:
        with urllib.request.urlopen(url.split("/v1/")[0] + "/health", timeout=0.5) as r:
            up = (
                json.loads(r.read()).get("status") == "ok"
            )  # llama-server's reply, not a page that mentions "ok"
    except (OSError, ValueError, AttributeError):
        up = False
    # Listed only when a llama-server answers or its address was set under Keys; most machines have none.
    if up or env("LLAMACPP_URL"):
        out.append(
            {
                "id": "remote:llamacpp",
                "group": "server",
                "label": "llama.cpp server",
                "ready": up,
                "url": url,
                "max": 26,
            }
        )
    for b, label in HOSTED.items():
        var = BACKENDS[b][0]
        ready, most = bool(env(var)), 26 if b in LETTER else None
        out.append(
            {
                "id": "remote:" + b,
                "group": "hosted",
                "label": label,
                "ready": ready,
                "key": var,
                "max": most,
                "model": BACKENDS[b][2],  # the one model this direct API is pinned to
            }
        )
    return out


SAMPLE_LOCK = Lock()
LOADED, LOCK = {}, Lock()  # backend id -> Jev or Remote; at most two local models stay in memory


def get(bid):
    with LOCK:
        if bid not in LOADED:
            if bid.startswith(("remote:", "openrouter:")):
                kind, _, name = bid.partition(":")
                try:
                    LOADED[bid] = (  # remote:llamacpp:<name> names the model loaded in llama-server
                        Remote(*name.split(":", 1)) if kind == "remote" else Remote("openrouter", model=name)
                    )
                except SystemExit as e:  # no key
                    raise ValueError(str(e)) from None
            else:
                for old in [k for k in LOADED if not k.startswith("remote:")][:-1]:
                    del LOADED[old]
                gc.collect()
                if DEVICE == "cuda":
                    torch.cuda.empty_cache()
                cache, have = where(bid)
                if not have:
                    gb = model_gb(bid)
                    PROGRESS[bid] = [
                        os.path.join(cache, "models--" + bid.replace("/", "--")),
                        gb and gb * 1e9,
                        "bytes",
                    ]
                if env("HF_TOKEN"):  # a gated model downloads with the token saved under Keys
                    os.environ["HF_TOKEN"] = env("HF_TOKEN")
                try:
                    LOADED[bid] = Jev(bid, cache_dir=cache)
                finally:
                    PROGRESS.pop(bid, None)
        return LOADED[bid]


# Everything the Keys view lists: .env name -> (label, what it unlocks, where to get it)
KEYS = {
    "TYPESAFE_API_KEY": ("TypeSafe (Jev)", "Jev itself", "https://typesafe.ai"),
    "DEEPSEEK_API_KEY": ("DeepSeek", "the direct DeepSeek API", "https://platform.deepseek.com"),
    "MOONSHOT_API_KEY": ("Kimi", "the direct Kimi API", "https://platform.moonshot.ai"),
    "OPENAI_API_KEY": ("OpenAI", "the direct OpenAI API", "https://platform.openai.com"),
    "OPENROUTER_API_KEY": ("OpenRouter", "every OpenRouter model", "https://openrouter.ai/keys"),
    "AI_GATEWAY_API_KEY": ("Vercel AI Gateway", "Jev through Vercel", "https://vercel.com/ai-gateway"),
    "HF_TOKEN": (
        "Hugging Face",
        "sets behind a login, such as GPQA",
        "https://huggingface.co/settings/tokens",
    ),
    "LLAMACPP_URL": ("llama.cpp server", "a llama-server address instead of the default", ""),
}
HF_WHOAMI = "https://huggingface.co/api/whoami-v2"


def presets():
    """Model lists frozen with a benchmark, e.g. Core v1's, for one-click selection in the page."""
    path = os.path.join(ROOT, "benchmarks", "core-v1-models.json")
    if not os.path.exists(path):
        return []
    with open(path) as f:
        frozen = json.load(f)
    return [{"name": "Core v1 models", "dataset": "Core v1", "models": [m["id"] for m in frozen["models"]]}]


def keys():
    """Which keys are set; never their values."""
    backend = {v[0]: "remote:" + b for b, v in BACKENDS.items() if v[0]}
    return [
        {"var": var, "label": label, "unlocks": unlocks, "url": url, "set": bool(env(var)),
         "backend": backend.get(var)}
        for var, (label, unlocks, url) in KEYS.items()
    ]  # fmt: skip


def check_key(name, key):
    """One tiny request that fails if the key or address is wrong."""
    if name == "HF_TOKEN":
        request = urllib.request.Request(HF_WHOAMI, headers={"authorization": "Bearer " + key})
        urllib.request.urlopen(request, timeout=15).close()
    elif name == "LLAMACPP_URL":
        with urllib.request.urlopen(key.split("/v1/")[0] + "/health", timeout=5) as r:
            if json.loads(r.read()).get("status") != "ok":
                raise ValueError("that address answered, but not as a llama-server")
    elif name == "remote:openrouter":  # its key endpoint checks the key alone, whatever a model can do
        request = urllib.request.Request(OPENROUTER_KEY_URL, headers={"Authorization": "Bearer " + key})
        urllib.request.urlopen(request, timeout=15).close()
    else:
        get(name).ask({"text": "hello"}, {"q": {"type": "noul", "instructions": "Is this a greeting?"}})


def key_target(name):
    """The backend id (or None) and .env name for a backend id or a KEYS name."""
    bid = (
        name if name.startswith("remote:") else next((k["backend"] for k in keys() if k["var"] == name), None)
    )
    if bid is None and name not in KEYS:
        raise ValueError(f"unknown key {name}")
    return bid, BACKENDS[bid.split(":", 1)[1]][0] if bid else name


def clear_key(name):
    """Forget a key: out of this session and out of .env, with the note saved above it."""
    bid, var = key_target(name)
    os.environ.pop(var, None)
    LOADED.pop(bid, None)
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path) as f:
        lines = f.read().splitlines()
    label = KEYS.get(var, (var,))[0]
    out = []
    for line in lines:
        if line.partition("=")[0].strip() == var:
            if out and out[-1].startswith(f"# {label}:"):
                out.pop()
            continue
        out.append(line)
    with open(path, "w") as f:
        f.write("\n".join(out) + "\n")


def set_key(name, key, save):
    """Use a key typed into the page: test it with one tiny request, then keep it for this
    session and, if asked, write it to .env (git-ignored). A rejected key changes nothing.
    `name` is a backend id such as remote:deepseek, or a KEYS name such as HF_TOKEN."""
    bid, var = key_target(name)
    old = os.environ.get(var)
    os.environ[var] = key
    LOADED.pop(bid, None)
    if var == "LLAMACPP_URL":
        LOADED.pop("remote:llamacpp", None)

    def undo():
        if old is None:
            os.environ.pop(var, None)
        else:
            os.environ[var] = old
        LOADED.pop(bid, None)

    try:
        check_key(bid or var, key)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):  # only these say the key is wrong; anything else is the model or the route
            undo()
            raise
    except Exception:
        undo()
        raise
    if save:
        path = os.path.join(ROOT, ".env")
        lines = []
        if os.path.exists(path):
            with open(path) as f:
                lines = f.read().splitlines()
        at = next((i for i, x in enumerate(lines) if x.partition("=")[0].strip() == var), None)
        if at is None:
            label, unlocks, url = KEYS.get(var, (var, "", ""))
            lines.append(f"# {label}: {unlocks}" + (f" — {url}" if url else ""))
            lines.append(f"{var}={key}")
        else:
            lines[at] = f"{var}={key}"
        with open(path, "w") as f:
            f.write("\n".join(lines) + "\n")


TEXTLESS = {"remote:typesafe", "remote:vercel"}  # Jev returns probabilities only; it never writes text


def messages(state, questions):
    """The usual way: ask for every answer written out as one JSON object."""
    lines = []
    for qid, q in questions.items():
        labels, descs = _options(q)
        opts = ", ".join(f"{la} ({_text(d)})" if d else la for la, d in zip(labels, descs, strict=True))
        lines.append(f'"{qid}": {_text(q["instructions"])} — one of: {opts}')
    user = (
        f"STATE:\n{_text(state)}\n\nAnswer every question as one JSON object, "
        f"keys exactly as given, values from the allowed options:\n" + "\n".join(lines)
    )
    return [{"role": "system", "content": SYSTEM.split(" Read")[0]}, {"role": "user", "content": user}]


def generate_remote(r, state, questions):
    """The same request written out by a hosted model, streamed as it arrives."""
    body = {"model": r.model_id, "messages": messages(state, questions), "stream": True}
    body |= {"max_tokens": 24 * len(questions), **EXTRAS.get(r.backend, {})}
    headers = {"authorization": f"Bearer {r.key}", "content-type": "application/json"}
    req = urllib.request.Request(r.url, data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp:
        for raw in resp:
            line = raw.decode().strip()
            if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                continue
            choices = json.loads(line[5:])["choices"]
            if choices and choices[0].get("delta", {}).get("content"):
                yield choices[0]["delta"]["content"]


@torch.no_grad()
def generate(jev, state, questions):
    """Ask the model to write all answers as one JSON object; yield text as it comes."""
    msgs = messages(state, questions)
    text = jev.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    enc = jev.tok(text, return_tensors="pt").to(jev.device)
    streamer = TextIteratorStreamer(jev.tok, skip_prompt=True, skip_special_tokens=True)
    Thread(
        target=jev.model.generate,
        kwargs=dict(
            **enc,
            streamer=streamer,
            do_sample=False,
            temperature=None,
            top_p=None,
            top_k=None,
            max_new_tokens=24 * len(questions),
        ),
    ).start()
    yield from streamer


def main(model_id=DEFAULT_MODEL, port=8080):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"  # chunked streaming needs 1.1; 1.0 clients would see the size markers

        def _send(self, code, data, ctype="application/json"):
            # A 9-model run is 11 MB of JSON; compressed it is a tenth of that.
            if len(data) > 64_000 and "gzip" in self.headers.get("accept-encoding", ""):
                data = gzip.compress(data, compresslevel=1)
                self.send_response(code)
                self.send_header("content-encoding", "gzip")
            else:
                self.send_response(code)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path.endswith("/backends"):
                return self._send(200, json.dumps(backends([model_id])).encode())
            if self.path.endswith("/gateway"):
                return self._send(200, json.dumps(gateway()).encode())
            if self.path.endswith("/runs"):
                return self._send(200, json.dumps(runs()).encode())
            if "/run?" in self.path:
                name = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)["name"][0]
                return self._send(200, run_body(name))
            if self.path.endswith("/progress"):
                return self._send(200, json.dumps(progress()).encode())
            if self.path.endswith("/presets"):
                return self._send(200, json.dumps(presets()).encode())
            if self.path.endswith("/keys"):
                return self._send(200, json.dumps(keys()).encode())
            if self.path.endswith("/datasets"):
                sets = [
                    {
                        "name": n,
                        "options": OPTIONS.get(n, 2),
                        "yes_no": n in DATASETS and DATASETS[n][6] is not None,
                        "needs_token": n in GATED and not env("HF_TOKEN"),
                        "local": os.path.exists(dataset_path(n)),
                    }
                    for n in [*DATASETS, *MC]
                ]
                frozen = os.path.exists(os.path.join(ROOT, "benchmarks", "core-v1.json"))
                sets += [
                    {"name": n, "options": 26, "yes_no": False, "frozen": True, "local": frozen} for n in CORE
                ]
                ts = os.path.isdir(os.path.join(ROOT, "results", "typesafe"))
                sets.append({"name": "TypeSafe cases", "options": None, "local": ts})
                group = {n: g for g, names in GROUPS.items() for n in names}
                order = [n for names in GROUPS.values() for n in names]
                for x in sets:
                    x["about"] = ABOUT[x["name"]]
                    x |= SIZES.get(x["name"], {})
                    x["group"] = group[x["name"]]
                sets.sort(key=lambda x: order.index(x["name"]))
                return self._send(200, json.dumps(sets).encode())
            path = urllib.parse.urlparse(self.path).path
            file = os.path.normpath(os.path.join(WEB, path.lstrip("/")))
            if path != "/" and file.startswith(WEB + os.sep) and os.path.isfile(file):
                kind = mimetypes.guess_type(file)[0] or "application/octet-stream"
                with open(file, "rb") as f:
                    return self._send(200, f.read(), kind)
            index = os.path.join(WEB, "index.html")
            if not os.path.exists(index):
                hint = "The page is not built yet. Run: cd web && pnpm install && pnpm build\n"
                return self._send(503, hint.encode(), "text/plain; charset=utf-8")
            with open(index, encoding="utf-8") as f:
                html = f.read().replace("{{model}}", model_id)
            self._send(200, html.encode(), "text/html; charset=utf-8")

        def from_elsewhere(self):
            """A request another website's page sent: it could spend your keys or replace them."""
            origin = self.headers.get("origin")
            host = urllib.parse.urlparse(origin).hostname if origin else None
            return origin is not None and host not in ("localhost", "127.0.0.1", "[::1]", "::1")

        def do_POST(self):
            if self.from_elsewhere():
                return self._send(403, b'{"error": {"message": "requests from other sites are refused"}}')
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
            try:
                if self.path.endswith("/sample"):
                    with SAMPLE_LOCK:  # batches ask in parallel; one download and one deck per set
                        try:
                            item = sample(body["dataset"], body.get("fresh", False), body.get("wide", False))
                        except Exhausted as e:
                            return self._send(409, json.dumps({"error": {"message": str(e)}}).encode())
                    return self._send(200, json.dumps(item).encode())
                if self.path.endswith("/key"):
                    if self.client_address[0] not in ("127.0.0.1", "::1"):
                        raise ValueError("keys can only be set from this machine")
                    if body.get("clear"):
                        clear_key(body["backend"])
                    else:
                        set_key(body["backend"], body["key"].strip(), body.get("save", False))
                    return self._send(200, b"{}")
                if self.path.endswith("/models"):
                    add_model(body["id"].strip())
                    return self._send(200, b"{}")
                bid = body.get("backend") or model_id
                if not bid.startswith(("remote:", "openrouter:")) and bid not in {*LOCAL, *added(), model_id}:
                    raise ValueError(f"{bid} is not in the model menu; add it there first")
                jev = get(bid)
                if self.path.endswith("/load"):  # downloads a local model the first time
                    return self._send(200, json.dumps({"device": jev.device}).encode())
                if self.path.endswith("/generate"):
                    if (body.get("backend") or model_id) in TEXTLESS:
                        raise ValueError("Jev returns probabilities only; it does not write text")
                    make = generate if isinstance(jev, Jev) else generate_remote
                    t = time.time()
                    pieces = make(jev, body["state"], body["questions"])
                    head = next(pieces, "")  # errors surface here, before the stream starts
                    self.send_response(200)
                    self.send_header("content-type", "text/plain; charset=utf-8")
                    self.send_header("transfer-encoding", "chunked")
                    self.end_headers()
                    text = []
                    for piece in [head, *pieces] if head else pieces:
                        text.append(piece)
                        chunk = piece.encode()
                        if not chunk:  # a zero-length chunk would end the stream
                            continue
                        self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                        self.wfile.flush()
                    self.wfile.write(b"0\r\n\r\n")
                    if body.get("log"):  # the written side of generate vs readout
                        answers = text_answers("".join(text), body["questions"])
                        log_row(
                            body,
                            (body.get("backend") or model_id) + "#text",
                            answers,
                            round((time.time() - t) * 1000),
                        )
                    return
                t = time.time()
                res = jev.ask(body["state"], body["questions"])
                res["latency_ms"] = round((time.time() - t) * 1000)
                if body.get("log"):  # every run is kept, with its input and label
                    log_row(body, body.get("backend") or model_id, res["answers"], res["latency_ms"])
                self._send(200, json.dumps(res).encode())
            except Exception as e:
                bid = body.get("backend") or model_id
                msg = str(e)
                gateway_model = bid.startswith("openrouter:")
                rejected = isinstance(e, urllib.error.HTTPError) and e.code in (401, 403)
                if self.path.endswith("/key") and rejected:
                    msg = f"That key was rejected (HTTP {e.code}). Nothing was saved."
                elif isinstance(e, NoProbabilities) and gateway_model:
                    CHECKED[bid] = False  # it drops out of the list on the next refresh
                    model = bid.split("/")[-1]
                    msg = f"{model} answered without probabilities, so it cannot be read this way."
                elif isinstance(e, urllib.error.HTTPError) and gateway_model and e.code == 404:
                    model = bid.split("/")[-1]
                    msg = f"OpenRouter has no provider for {model} that returns probabilities right now."
                elif isinstance(e, urllib.error.HTTPError) and bid.startswith(("remote:", "openrouter:")):
                    LOADED.pop(bid, None)  # the next try re-reads .env
                    name = next((x["label"] for x in backends([]) if x["id"] == bid), bid.split("/")[-1])
                    var = BACKENDS["openrouter" if gateway_model else bid.split(":", 1)[1]][0]
                    fix = "That key was rejected." if self.path.endswith("/key") else f"Check {var} in .env."
                    msg = f"{name} answered HTTP {e.code} ({e.reason})" + (
                        f". {fix}" if e.code in (401, 403) else "."
                    )
                elif isinstance(e, urllib.error.URLError):
                    LOADED.pop(bid, None)
                    msg = f"Could not reach {bid.split(':', 1)[-1]}: {e.reason}"
                self._send(400, json.dumps({"error": {"message": msg}}).encode())

        def log_message(self, fmt, *a):
            sys.stderr.write(f"{self.command} {self.path} {a[1] if len(a) > 1 else ''}\n")

    print(f"open http://localhost:{port}  ({DEVICE}; models in {HF_HUB_CACHE} or {MODELS})")
    Thread(target=runs, daemon=True).start()  # summarise the saved runs before Past runs is opened
    server = ThreadingHTTPServer(("", port), H)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()


def cli():
    a = sys.argv[1:]
    main(*a[:1], **({"port": int(a[1])} if len(a) > 1 else {}))


if __name__ == "__main__":
    cli()
