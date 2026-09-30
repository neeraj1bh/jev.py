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
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock, Thread

import torch
from huggingface_hub.constants import HF_HUB_CACHE
from transformers import TextIteratorStreamer

from jev import cache, downloads, folders, hub, llamaserver
from jev.core import DEFAULT_MODEL, ROOT, SYSTEM, Jev, _options, _text, gpu_hint
from jev.dev import NO_NODE, page_tools
from jev.eval import typesafe_rows
from jev.remote import ADDRESS, BACKENDS, EXTRAS, NoProbabilities, Remote, env, total

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
ROWS = "https://datasets-server.huggingface.co/rows?dataset={}&config={}&split={}&offset={}&length={}"
POOL, POOL_RUNS = 300, 20  # rows of a larger split kept on disk, and how many windows they come from
FULL_ROWS = 3300  # a split this small is kept whole
# windows per set where 20 would miss a stratum: DBpedia-14's test split is 14 label blocks of 5,000
# rows (four windows a block); MMLU-Pro's smallest category has about 380 rows
RUNS = {"DBpedia-14": 56, "MMLU-Pro": 60}
# Core v1 picks these one per label or subject, or by quota, so it needs every row
FULL = {
    "MMLU", "Banking77", "CLINC150", "LEDGAR", "RewardBench", "Jailbreak attempts", "ToxicChat",
    "BBQ race and ethnicity", "RAGTruth", "SQuAD v2", "Global-MMLU-Lite Hindi",
    "Global-MMLU-Lite Chinese", "Global-MMLU-Lite English",
}  # fmt: skip
# name: (Hub dataset, config, split, state fields, question, label field or a function of the row,
# the label meaning yes)
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
        "Given only this excerpt, is the hypothesis entailed, contradicted, or neither?", "label", None,
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
    "LegalBench hearsay": (  # the task's own test, which leaves exclusions and exceptions aside
        "nguha/legalbench", "hearsay", "test", {"evidence": "text"},
        "Is this evidence hearsay under this simple test only: a statement (spoken, written, or conduct "
        "meant to assert something) made out of court and offered to prove that what it asserts is "
        "true? Ignore the legal exclusions and exceptions, such as a party's own statements.",
        "answer", "Yes",
    ),
    "LegalBench definitions": (
        "nguha/legalbench", "definition_classification", "test", {"sentence": "text"},
        "Does this sentence from a court opinion define a term?", "answer", "Yes",
    ),
    "RAGTruth": (  # people marked each unsupported span; any span makes the answer yes
        "wandb/RAGTruth-processed", "default", "test",
        {"request": "query", "context": "context", "response": "output"},
        "Does the response contain a factual claim that contradicts, or is unsupported by, the supplied "
        "request and context?",
        lambda r: "yes" if sum(r["hallucination_labels_processed"].values()) else "no", "yes",
    ),
    "Jailbreak attempts": (  # ToxicChat's own jailbreak label, set by its annotators
        "lmsys/toxic-chat", "toxicchat0124", "test", {"user message": "user_input"},
        "Is this message trying to get the chatbot to break its rules or safety guidelines?",
        "jailbreaking", 1,
    ),
    "SQuAD v2": (  # the answers are never shown: a question with none is unanswerable
        "rajpurkar/squad_v2", "squad_v2", "validation", {"passage": "context", "question": "question"},
        "Can the question be answered from the passage?",
        lambda r: "yes" if r["answers"]["text"] else "no", "yes",
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
    "GoldenSwag": (  # the HellaSwag validation items that pass GoldenSwag's validity checks
        "PleIAs/GoldenSwag", "default", "validation",
        lambda r: {"activity": r["activity_label"], "context": r["ctx"]},
        "Which ending is the most likely continuation?",
        lambda r: (r["endings"], int(r["label"])),
    ),
    "TruthfulQA": (
        "truthfulqa/truthful_qa", "multiple_choice", "validation",
        lambda r: {"question": r["question"]},
        "Which answer is true?",
        lambda r: _shuffled(r["question"], *_true_and_false(r["mc1_targets"])),
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
        "Which option correctly fills the blank (_)?",
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
        "What conclusion about the question is supported by the supplied study context?",
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
            ["response A was preferred", "response B was preferred", "recorded tie"],
            [r["winner_model_a"], r["winner_model_b"], r["winner_tie"]].index(1),
        ),
    ),
    "RewardBench": (
        "allenai/reward-bench", "default", "filtered",
        lambda r: {"prompt": r["prompt"], **_pair(r["id"], r["chosen"], r["rejected"])},
        "Which response better satisfies the request, considering correctness, relevance and safety?",
        lambda r: (["A is better", "B is better"], 0 if int(r["id"]) % 2 == 0 else 1),
    ),
    "Global-MMLU-Lite Hindi": (  # the Lite set is human-translated or post-edited throughout
        "CohereLabs/Global-MMLU-Lite", "hi", "test",
        lambda r: {"subject": r["subject"].replace("_", " "), "question": r["question"]},
        "Which answer is correct?",
        lambda r: ([r[f"option_{k}"] for k in "abcd"], "ABCD".index(r["answer"])),
    ),
    "Global-MMLU-Lite Chinese": (
        "CohereLabs/Global-MMLU-Lite", "zh", "test",
        lambda r: {"subject": r["subject"].replace("_", " "), "question": r["question"]},
        "Which answer is correct?",
        lambda r: ([r[f"option_{k}"] for k in "abcd"], "ABCD".index(r["answer"])),
    ),
    "Global-MMLU-Lite English": (  # the same questions as Hindi and Chinese: the language control
        "CohereLabs/Global-MMLU-Lite", "en", "test",
        lambda r: {"subject": r["subject"].replace("_", " "), "question": r["question"]},
        "Which answer is correct?",
        lambda r: ([r[f"option_{k}"] for k in "abcd"], "ABCD".index(r["answer"])),
    ),
    "BBQ race and ethnicity": (  # this copy keeps each item's template, polarity and context type
        "heegyu/bbq", "Race_ethnicity", "test",
        lambda r: {"context": r["context"], "question": r["question"]},
        "Based only on the context, which answer is supported?",
        lambda r: ([r["ans0"], r["ans1"], r["ans2"]], int(r["label"])),
    ),
    "MuSR murder mysteries": (
        "TAUR-Lab/MuSR", "default", "murder_mysteries",
        lambda r: {"story": r["narrative"], "question": r["question"]},
        "Which answer does the story support?",
        lambda r: (ast.literal_eval(r["choices"]), int(r["answer_index"])),
    ),
    "HelpSteer2": (  # a score question: its options are the annotators' level descriptions
        "nvidia/HelpSteer2", "default", "validation",
        lambda r: {"prompt": r["prompt"], "response": r["response"]},
        "How helpful is the response to the prompt?",
        lambda r: (HELPFULNESS, int(r["helpfulness"])),
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
SCORED = {"HelpSteer2"}  # asked as a score: the label is the index of its level
HELPFULNESS = [  # HelpSteer2's annotation guidelines, level 0 first
    "The response is not useful or helpful at all. The response completely missed the essence of "
    "what the user wanted.",
    "The response is borderline unhelpful and mostly does not capture what the user was looking "
    "for, but it is still usable and helpful in a small way.",
    "The response is partially helpful but misses the overall goal of the user's query/input in "
    "some way. The response did not fully satisfy what the user was looking for.",
    "The response is mostly helpful and mainly aligned with what the user was looking for, but "
    "there is still some room for improvement.",
    "The response is extremely helpful and completely aligned with the spirit of what the prompt "
    "was asking for.",
]
KEEP = {  # rows a set leaves out, and why
    "Arena votes": lambda r: len(json.loads(r["prompt"])) == 1,  # joined turns lose their order
    "RAGTruth": lambda r: r["quality"] == "good",  # not truncated answers or wrong refusals
    "ToxicChat": lambda r: r["human_annotation"],  # the rest were labelled by a model
    "Jailbreak attempts": lambda r: r["human_annotation"],
    "ARC-Challenge": lambda r: len(r["choices"]["text"]) == 4,  # so answer positions can balance
    "HelpSteer2": lambda r: "<extra_id_1>" not in r["prompt"],  # multi-turn chats joined by markers
}
DESCRIBE = {  # an option's meaning, shown with it where its name alone is unclear
    "PubMedQA": {"maybe": "the evidence is mixed or inconclusive"},
    "ContractNLI": {"neutral": "neither established nor contradicted"},
}


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


def _true_and_false(targets):
    """TruthfulQA's single-answer choices, split into the one true answer and the rest."""
    pairs = list(zip(targets["choices"], targets["labels"], strict=True))
    return next(c for c, true in pairs if true), [c for c, true in pairs if not true]


def _shuffled(question, right, wrong):
    """GPQA and TruthfulQA list the right answer first; a fixed per-question order keeps every run
    comparable."""
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
    "GoldenSwag": "Which ending continues the scene most plausibly? HellaSwag's checked items",
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
    "WinoGrande": "Which option fills the gap in the sentence? Two choices",
    "MedQA": "US medical licensing exam question, four choices",
    "PubMedQA": "A research abstract and a question: yes, no or maybe?",
    "Arena votes": "Two chatbot answers to one prompt: which did the person prefer, or a tie?",
    "RewardBench": "A prompt and two responses: which is better? Labels from a curated benchmark",
    "GPQA Diamond": "Graduate-level science question written to resist search (needs HF_TOKEN)",
    "XNLI Hindi": "NLI in Hindi: entailment, neutral or contradiction?",
    "Global-MMLU-Lite Hindi": "MMLU in Hindi, translated by people, four choices",
    "Global-MMLU-Lite Chinese": "MMLU in Chinese, translated by people, four choices",
    "Global-MMLU-Lite English": "The same MMLU questions in English, the control for Hindi and Chinese",
    "LegalBench hearsay": "A piece of evidence and the issue it is offered for: is it hearsay?",
    "LegalBench definitions": "A sentence from a US court opinion: does it define a term?",
    "RAGTruth": "A source, a request and a model's answer: does it claim what the source does not say?",
    "SQuAD v2": "A Wikipedia paragraph and a question: can the paragraph answer it?",
    "Jailbreak attempts": "A real user message to a chatbot: is it trying to break its rules?",
    "HelpSteer2": "A prompt and a response: how helpful is it, from 0 to 4? Rated by people",
    "BBQ race and ethnicity": "A short scene and a question where one answer is a stereotype",
    "MuSR murder mysteries": "A 1,000-word mystery: who is the most likely murderer? Two suspects",
    "BBH causal judgement": "A story about cause and blame: would a typical person say yes?",
    "BBH date understanding": "Date arithmetic in words, up to six choices",
    "Core v1": (
        "Picked 2026-09-24 from the decided question list, Review 2 next: 50 items a set (one per "
        "label or subject where it has more), spread over its strata, and every TypeSafe step. "
        "Banking77, CLINC150 and LEDGAR join only when every picked model reads over 26 options"
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
        "WinoGrande", "RAGTruth", "SQuAD v2",
    ],
    "Reasoning": ["MuSR murder mysteries", "BBH causal judgement", "BBH date understanding"],
    "Other languages": [
        "XNLI Hindi", "Global-MMLU-Lite Hindi", "Global-MMLU-Lite Chinese", "Global-MMLU-Lite English",
    ],
    "Intent and topic": ["Banking77", "CLINC150", "AG News topic", "DBpedia-14"],
    "Knowledge and exams": [
        "MMLU", "MMLU-Pro", "ARC-Challenge", "OpenBookQA", "CommonsenseQA", "GoldenSwag",
        "TruthfulQA", "MedQA", "PubMedQA", "GPQA Diamond",
    ],
    "Safety and spam": [
        "ToxicChat", "Tweet hate", "Tweet offensive", "SMS spam", "Jailbreak attempts",
        "BBQ race and ethnicity",
    ],
    "Which answer is better": ["Arena votes", "RewardBench", "HelpSteer2"],
    "Contracts and business": [
        "ContractNLI", "LEDGAR", "LegalBench hearsay", "LegalBench definitions", "TypeSafe cases",
    ],
}  # fmt: skip
OPTIONS = {
    "MMLU": 4,
    "MMLU-Pro": 10,
    "ARC-Challenge": 4,
    "GoldenSwag": 4,
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
    "Global-MMLU-Lite Hindi": 4,
    "Global-MMLU-Lite Chinese": 4,
    "Global-MMLU-Lite English": 4,
    "HelpSteer2": 5,
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
            # whole split (FULL) takes hundreds of pages, so back off for up to a few minutes.
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


def download(name, hub, config, split):
    """A set's pool, fetched once into DATA with the Hub revision it came from. A split of up to
    FULL_ROWS rows, or a set in FULL, is kept whole. A larger one is read as seeded windows: a short
    run of rows from each equal stretch of the split, since some splits are sorted by label."""
    path = dataset_path(name)
    if not os.path.exists(path):
        for _ in range(2):  # a pool read while the dataset changed is read again, once
            before = revision(hub, fresh=True)
            pool = read_pool(name, hub, config, split)
            if revision(hub, fresh=True) == before:
                break
        else:
            raise ValueError(f"{hub} changed on the Hub twice while {name} was downloading; try later")
        os.makedirs(DATA, exist_ok=True)
        with open(path, "w") as f:
            json.dump(pool | {"revision": before}, f)
    with open(path) as f:
        return json.load(f)


def read_pool(name, hub, config, split):
    first = rows_page(hub, config, split, 0, 1)
    total = first["num_rows_total"]
    if total <= FULL_ROWS or name in FULL:
        rule, seed, size = "full", None, 100
        starts = list(range(0, total, size))
    else:
        runs = RUNS.get(name, POOL_RUNS)
        rule, seed, size, stretch = f"{runs} seeded windows", f"pool:{name}", POOL // runs, total / runs
        rng = random.Random(seed)
        starts = [int(k * stretch + rng.random() * (stretch - size)) for k in range(runs)]
    PROGRESS[name] = [0, len(starts), "pages"]
    rows = []
    try:
        for start in starts:
            rows += rows_page(hub, config, split, start, size)["rows"]
            PROGRESS[name][0] += 1
    finally:
        PROGRESS.pop(name, None)
    return {
        "features": first["features"], "rows": rows, "rule": rule, "seed": seed, "total": total,
        "starts": starts, "size": size,
    }  # fmt: skip


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
    """The rows of a downloaded page that carry a label (SNLI marks unlabelled pairs -1) and that
    the set keeps."""
    rows = page["rows"]
    if name in KEEP:
        rows = [r for r in rows if KEEP[name](r["row"])]
    if name in MC or callable(DATASETS[name][5]):
        return rows
    label = DATASETS[name][5]
    return [r for r in rows if r["row"][label] != -1]


def criteria(name, options):
    return {o: DESCRIBE.get(name, {}).get(o) for o in options}


def row_item(name, page, r):
    """One downloaded row as a request with its truth, for a set in DATASETS or MC."""
    if name in MC:
        hub, _, split, state_of, question, options_of = MC[name]
        options, answer = options_of(r["row"])
        if name in SCORED:
            q, truth = {"type": "score", "instructions": question, "criteria": options}, str(answer)
        else:
            q = {"type": "choice", "instructions": question, "criteria": criteria(name, options)}
            truth = options[answer]
        return {
            "state": state_of(r["row"]),
            "questions": {"answer": q},
            "truth": {"answer": truth},
            "source": f"{hub} · {split} row {r['row_idx']}",
            "options": len(options),
        }
    hub, _, split, fields, question, label, yes = DATASETS[name]
    row = r["row"]
    if callable(label):
        names, value = None, label(row)
    else:
        names = next(x["type"].get("names") for x in page["features"] if x["name"] == label)
        value = names[row[label]] if names else row[label]
    if yes is not None:
        q = {"type": "noul", "instructions": question}
        truth = "yes" if value == yes else "no"
    else:
        q = {"type": "choice", "instructions": question, "criteria": criteria(name, names)}
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
    downloads about 300 rows spread over the set into DATA; later calls deal from them."""
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
    """(cache folder, complete?): where the whole model is, else MODELS for a new download."""
    found = on_disk().get(model_id)
    return (found[0], True) if found else (MODELS, False)


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


def log_row(body, backend, answers, ms, response=None):
    """One answer of a run, appended to its session's file, with the rest of the reply (usage,
    invalid answers, an error) when there is one."""
    name = "".join(c if c.isalnum() or c in "._-" else "-" for c in body["log"])[:120]
    os.makedirs(LOGS, exist_ok=True)
    keys = ("dataset", "set", "source", "state", "questions", "truth", "mode", "sides", "system")
    row = {k: body.get(k) for k in keys}
    # "at" is when the answer came back, so a replay can follow the run's real timeline
    row |= {"backend": backend, "answers": answers, "ms": ms, "at": round(time.time() * 1000)}
    if response:
        row["response"] = {k: v for k, v in response.items() if k != "answers"}
    with LOCK, open(os.path.join(LOGS, name + ".jsonl"), "a") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def answer(a):
    """The answer a probability reply amounts to, in the label set's words."""
    if a["type"] == "noul":
        return "yes" if a["noul"] >= 0.5 else "no"
    if a["type"] == "choice":
        return a["choice"]
    p = a.get("probabilities")  # a score's answer is its most probable level, not the rounded mean
    return max(p, key=p.get) if p else str(round(a["score"]))


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
            res = {"answers": x["answers"]}
            if usage := (x.get("response") or {}).get("usage"):
                # the totals the page prices a run from, not each question's details
                billed = total((usage.get("per_question") or {}).values(), "cost")
                res["usage"] = {
                    "input_tokens": usage.get("input_tokens"),
                    "output_tokens": usage.get("output_tokens"),
                    "cost": usage.get("cost", billed if usage.get("per_question") else None),
                }
            it["sides"][x["backend"]] = {"ms": x["ms"], "res": res}
            if "at" in x:  # older runs did not record it
                # the item started when its first model started (local models answer one after
                # another), and ended with its last answer
                it["start"] = min(it.get("start", x["at"]), x["at"] - x["ms"])
                it["at"] = max(it.get("at", 0), x["at"])
    return list(items.values())


def progress():
    """Everything downloading now: datasets by pages, models by bytes."""
    return {k: {"done": done, "total": total, "unit": unit} for k, (done, total, unit) in PROGRESS.items()}


def memory_gb():
    if DEVICE == "cuda":
        return torch.cuda.get_device_properties(0).total_memory / 1e9
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1e9
    except (ValueError, OSError, AttributeError):  # Windows has no sysconf
        return None


def llamacpp_url():
    return env("LLAMACPP_URL") or BACKENDS["llamacpp"][1]


def laya_url():
    return env("LAYA_URL") or BACKENDS["laya"][1]


def laya_up(url, timeout=0.5):
    """Whether a laya-serve answers at this address. Its health reply lists the checkpoints it
    holds, which tells it from whatever else may be listening on so common a port."""
    try:
        with urllib.request.urlopen(url.split("/v1/")[0] + "/health", timeout=timeout) as r:
            reply = json.loads(r.read())
        return reply.get("status") == "ok" and "loaded" in reply
    except (OSError, ValueError, AttributeError):
        return False


OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key"
GATEWAY = {"at": 0.0, "models": []}  # OpenRouter's catalog, refetched every few hours
VERCEL_MODELS = "https://ai-gateway.vercel.sh/v1/models"
OPENROUTER_ENDPOINTS = "https://openrouter.ai/api/v1/models/{}/endpoints"
# Where each direct API's own price is published: Vercel's gateway lists Jev; OpenRouter lists what
# each provider charges for a model, and the provider's own entry is its API price.
PRICED_AS = {
    "typesafe": (VERCEL_MODELS, "typesafe-ai/jev"),
    "vercel": (VERCEL_MODELS, "typesafe-ai/jev"),
    "deepseek": (OPENROUTER_ENDPOINTS.format("deepseek/deepseek-v4.1-flash"), "DeepSeek"),
    "moonshot": (OPENROUTER_ENDPOINTS.format("moonshotai/kimi-k2.6"), "Moonshot AI"),
    "openai": (OPENROUTER_ENDPOINTS.format("openai/gpt-4o-mini"), "OpenAI"),
    "openrouter": (OPENROUTER_ENDPOINTS.format("openai/gpt-4o-mini"), "OpenAI"),
}
PRICES = {"at": 0.0, "prices": {}}  # backend -> ($ per 1M input, $ per 1M output)


def live_prices():
    """Each direct API's own price, read at most every few hours with no key; a price that cannot
    be read is left out, so the page shows no estimate rather than a wrong one."""
    if time.time() - PRICES["at"] > 6 * 3600:
        pages, prices = {}, {}
        for backend, (url, name) in PRICED_AS.items():
            if url not in pages:
                try:
                    with urllib.request.urlopen(url, timeout=10) as r:
                        pages[url] = json.load(r)["data"]
                except (OSError, ValueError, KeyError):
                    pages[url] = None
            data = pages[url]
            if url == VERCEL_MODELS:
                entry = next((m["pricing"] for m in data or [] if m["id"] == name), None)
                keys = ("input", "output")
            else:
                entries = data["endpoints"] if data else []
                entry = next((e["pricing"] for e in entries if e["provider_name"] == name), None)
                keys = ("prompt", "completion")
            if entry:
                prices[backend] = tuple(round(float(entry.get(k) or 0) * 1e6, 3) for k in keys)
        PRICES.update(at=time.time(), prices=prices)
    return PRICES["prices"]


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


def caches():
    """The Hugging Face cache, models/, and any other cache folder added in the page."""
    return list(dict.fromkeys([HF_HUB_CACHE, MODELS, *filter(folders.is_hf_cache, model_dirs())]))


def on_disk():
    return cache.on_disk(caches())


def model_places():
    """Folders known to hold models: each usable model's folder in the caches, and the folders
    added in the page."""
    return [
        os.path.join(c, "models--" + m.replace("/", "--")) for m, (c, _) in on_disk().items()
    ] + model_dirs()


def model_dirs():
    """Folders added in the page and the known llama.cpp and LM Studio ones; a folder inside a
    Hugging Face cache is left out, since the cache itself is read by model name."""
    added = [*folders.settings()["folders"], *folders.KNOWN]
    return [d for d in dict.fromkeys(added) if not in_cache(d)]


def in_cache(folder):
    return any(folder.startswith(c.rstrip(os.sep) + os.sep) for c in (HF_HUB_CACHE, MODELS))


def folder_models():
    return folders.scan(model_dirs())


def folder_state():
    """The folders added in the page, how many models each holds, and the llama-server in use."""

    def count(d):
        return len(folders.scan([d])) + (len(cache.on_disk([d])) if folders.is_hf_cache(d) else 0)

    listed = [{"path": d, "models": count(d)} for d in model_dirs()]
    gguf = any(k.startswith("gguf:") for k in folders.scan(model_dirs()))
    return {"folders": listed, "llama_server": folders.llama_server(), "has_gguf": gguf}


def local_ids(extra):
    """Chat models already on this machine, the ones added in the page, and the built-in starters
    until three models are on disk."""
    disk = on_disk()
    starters = list(LOCAL) if len(disk) < 3 else []
    in_folders = folders.scan(model_dirs())
    return list(dict.fromkeys([*disk, *added(), *starters, *in_folders, *extra])), disk


def backends(extra):
    """Everything the page can pick, with what it needs before it can run."""
    out, mem = [], memory_gb()
    ids, disk = local_ids(extra)
    in_folders = folders.scan(model_dirs())
    for m in ids:
        if m.startswith("remote:") or m in in_folders:
            continue
        found = disk.get(m)
        folder = found[0] if found else MODELS
        gb = model_gb(m) or (found and found[1])
        out.append(
            {
                "id": m,
                "group": "local",
                "label": m.split("/")[-1].removesuffix("-Instruct"),
                "ready": bool(found),
                "path": os.path.join(folder, "models--" + m.replace("/", "--")),
                "gb": gb,
                "need_gb": gb and round(gb * (1 if BF16 else 2) * 1.3, 1),
                "have_gb": mem and round(mem, 1),
                "device": DEVICE,
                "tested": m in LOCAL,
            }
        )
    for fid, found in in_folders.items():
        gguf = found["kind"] == "gguf"
        entry = {"id": fid, "label": found["label"], "gb": found["gb"], "path": fid.removeprefix("gguf:")}
        if gguf:  # read by letter through a llama-server started for it
            running = llamaserver.running(entry["path"])
            out.append(
                entry
                | {
                    "group": "gguf",
                    "ready": bool(folders.llama_server()),
                    "max": 26,
                    "running": running,
                    "budget_gb": llamaserver.budget_gb(folders.llama_server()),
                }
            )
        else:
            need = round(found["gb"] * (1 if BF16 else 2) * 1.3, 1)
            out.append(entry | {"group": "local", "ready": True, "device": DEVICE, "need_gb": need})
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
    laya, laya_answers = laya_url(), laya_up(laya_url())
    # Like the llama-server above: listed only when one answers or its address was set under Keys.
    if laya_answers or env("LAYA_URL"):
        out.append(
            {"id": "remote:laya", "group": "server", "label": "Laya", "ready": laya_answers, "url": laya}
        )
    prices = live_prices()
    for b, label in HOSTED.items():
        var = BACKENDS[b][0]
        ready, most = bool(env(var)), 26 if b in LETTER else None
        price = prices.get(b)
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
            | ({"price": price[0], "price_out": price[1]} if price else {})
        )
    return out


SAMPLE_LOCK = Lock()
LOADED, LOCK = {}, Lock()  # backend id -> Jev or Remote; at most two local models stay in memory
SYSTEMS = {}  # backend id -> the system it answers as, also logged with the rows of its failed items


def download_model(bid):
    """Fetch a Hugging Face model's files when they are not on disk yet; loads nothing."""
    if bid.startswith(("remote:", "openrouter:", "gguf:")) or os.path.isdir(bid):
        return
    folder, have = where(bid)
    if not have:
        if env("HF_TOKEN"):  # a gated model downloads with the token saved under Keys
            os.environ["HF_TOKEN"] = env("HF_TOKEN")
        downloads.fetch(bid, folder, PROGRESS)


def get(bid):
    if bid.startswith("gguf:"):
        if not folders.llama_server():
            raise ValueError("Set the llama-server program in Add a model to run GGUF models")
        path = bid.removeprefix("gguf:")
        size = folder_models().get(bid, {}).get("gb")
        url = llamaserver.serve(path, folders.llama_server(), size)
        remote = LOADED.get(bid) or Remote("llamacpp", model=os.path.basename(bid))
        remote.url = url + "/v1/chat/completions"
        LOADED[bid] = remote
        return remote
    if bid not in LOADED:
        download_model(bid)  # outside LOCK, so other models keep answering while this one downloads
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
                LOADED[bid] = Jev(bid, cache_dir=where(bid)[0])
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
    "LAYA_URL": ("Laya server", "a laya-serve address instead of the default", ""),
}
HF_WHOAMI = "https://huggingface.co/api/whoami-v2"


def presets():
    """Model lists frozen with a benchmark, e.g. Core v1's, for one-click selection in the page."""
    path = os.path.join(ROOT, "benchmarks", "core-v1-models.json")
    if not os.path.exists(path):
        return []
    with open(path) as f:
        frozen = json.load(f)
    lists = {"Core v1 models": frozen["models"], "Core v1 optional": frozen.get("optional", [])}
    return [{"name": n, "dataset": "Core v1", "models": [m["id"] for m in ms]} for n, ms in lists.items()]


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
    elif name == "LAYA_URL":
        if not laya_up(key, timeout=5):
            raise ValueError("that address did not answer as a laya-serve")
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
    for backend, address in ADDRESS.items():  # a new address must not keep answering from the old one
        if var == address:
            LOADED.pop("remote:" + backend, None)

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


# Jev and Laya return probabilities only; they never write text
TEXTLESS = {"remote:typesafe", "remote:vercel", "remote:laya"}


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


# Shown instead of the page while web/dist is missing or older than web/src. It polls and reloads
# by itself, so building in another terminal is the only step. Plain HTML: the built fonts and
# styles are exactly what may be missing.
BUILD_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>jev.py · build the page</title>
<style>
:root{--paper:#fbfbfa;--shell:#f0f1f3;--panel:#fff;--ink:#1a1c1f;--dim:#6b7079;--rule:#e4e5e7;
--warn:#b4531a}
@media (prefers-color-scheme:dark){:root{--paper:#101214;--shell:#21252b;--panel:#171a1e;
--ink:#e8eaed;--dim:#8b929c;--rule:#262a30;--warn:#f0a15b}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--paper);color:var(--ink);
font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.shell{width:min(460px,100%);background:var(--shell);border-radius:22px;padding:6px;
box-shadow:0 0 0 1px rgb(41 41 41/.04),0 12px 24px -12px rgb(0 0 0/.18)}
header{display:flex;align-items:center;gap:8px;padding:8px 10px 10px}
.tile{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;
background:var(--ink);color:var(--paper)}
h1{margin:0;font-size:15px;font-weight:600;letter-spacing:-.01em}
.dot{margin-left:auto;position:relative;width:8px;height:8px}
.dot i{position:absolute;inset:0;border-radius:50%;background:var(--warn)}
.dot i:first-child{animation:ping 1.2s cubic-bezier(0,0,.2,1) infinite;opacity:.7}
@keyframes ping{75%,to{transform:scale(2.2);opacity:0}}
.inset{background:var(--panel);border-radius:16px;padding:16px 18px}
p{margin:0 0 12px;color:var(--dim);font-size:13.5px}
.label{font-size:10.5px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;
color:var(--dim);margin-bottom:6px}
.cmd{display:flex;align-items:center;gap:8px;background:var(--shell);border-radius:10px;
padding:8px 8px 8px 12px}
code{flex:1;min-width:0;overflow-x:auto;white-space:nowrap;
font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace}
button{border:0;border-radius:999px;background:var(--ink);color:var(--paper);
font:500 12px system-ui,sans-serif;padding:6px 12px;cursor:pointer}
footer{display:flex;align-items:center;gap:8px;padding:10px 10px 4px;font-size:11.5px;
color:var(--dim)}
@media (prefers-reduced-motion:reduce){.dot i:first-child{animation:none}}
</style></head><body>
<main class="shell">
<header>
<span class="tile"><svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
<path d="M213.85,125.46l-112,120a8,8,0,0,1-13.69-7l14.66-73.33L45.19,143.49a8,8,0,0,1-3-13
l112-120a8,8,0,0,1,13.69,7L153.18,90.9l57.63,21.61a8,8,0,0,1,3,12.95Z"/></svg></span>
<h1>The page needs a build</h1><span class="dot" title="waiting for the build"><i></i><i></i></span></header>
<section class="inset">
<p>The page __STATE__. Build it once in another terminal; this tab reloads by itself when it is ready.</p>
<div class="label">Run</div>
<div class="cmd"><code id="cmd">cd web &amp;&amp; pnpm install &amp;&amp; pnpm build</code>
<button id="copy" type="button">Copy</button></div>
</section>
<footer>Waiting for the build · checks every 2 s</footer>
</main>
<script>
document.getElementById("copy").onclick = async (e) => {
  try {
    await navigator.clipboard.writeText(document.getElementById("cmd").textContent);
    e.target.textContent = "Copied";
  } catch {
    e.target.textContent = "Select and copy";
  }
};
setInterval(async () => {
  try { if ((await fetch(location.href, { cache: "no-store" })).ok) location.reload(); } catch {}
}, 2000);
</script>
</body></html>
"""


def page_is_stale(index):
    """True when the page's source changed after the last build, as after a git pull."""
    source = os.path.join(ROOT, "web")
    built = os.path.getmtime(index)
    paths = [os.path.join(source, f) for f in ("index.html", "package.json", "vite.config.ts")]
    paths += [os.path.join(d, f) for d, _, fs in os.walk(os.path.join(source, "src")) for f in fs]
    return any(os.path.getmtime(p) > built for p in paths if os.path.exists(p))


def main(model_id=DEFAULT_MODEL, port=8080):
    started_with = [] if model_id == DEFAULT_MODEL else [model_id]  # a model named at start is listed

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"  # chunked streaming needs 1.1; 1.0 clients would see the size markers

        def _send(self, code, data, ctype="application/json"):
            # The page may reload or close before the answer arrives.
            with contextlib.suppress(BrokenPipeError, ConnectionResetError):
                self._write(code, data, ctype)

        def _write(self, code, data, ctype):
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
                return self._send(200, json.dumps(backends(started_with)).encode())
            if self.path.endswith("/gateway"):
                return self._send(200, json.dumps(gateway()).encode())
            if self.path.endswith("/runs"):
                return self._send(200, json.dumps(runs()).encode())
            if "/run?" in self.path:
                name = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)["name"][0]
                return self._send(200, run_body(name))
            if self.path.endswith("/progress"):
                return self._send(200, json.dumps(progress()).encode())
            if self.path.endswith("/folders"):
                return self._send(200, json.dumps(folder_state()).encode())
            if "/browse" in self.path:
                if self.client_address[0] not in ("127.0.0.1", "::1"):
                    return self._send(
                        403, b'{"error": {"message": "folders can only be browsed from this machine"}}'
                    )
                query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                try:
                    path = query.get("path", [""])[0]
                    listing = folders.browse(
                        path, files="files" in query, hidden="hidden" in query, places=model_places()
                    )
                    shown = listing["path"]
                    listing["listed"] = shown in (HF_HUB_CACHE, MODELS, *model_dirs()) or in_cache(shown)
                except ValueError as e:
                    return self._send(400, json.dumps({"error": {"message": str(e)}}).encode())
                return self._send(200, json.dumps(listing).encode())
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
                if frozen:
                    from jev import bench  # bench imports this module

                    fetch = bench.pages_to_fetch()
                    sets += [
                        {
                            "name": n, "options": 26, "yes_no": False, "frozen": True,
                            "local": not fetch["pages"], "fetch": fetch, "items": bench.size(),
                            "fetch_wide": bench.pages_to_fetch("wide"),
                            "needs_token": bool(GATED) and not env("HF_TOKEN"),  # GPQA is in Core v1
                        }
                        for n in CORE
                    ]  # fmt: skip
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
            if not os.path.exists(index) or page_is_stale(index):
                state = (
                    "is older than its source (after a pull?)"
                    if os.path.exists(index)
                    else "is not built yet"
                )
                page = BUILD_PAGE.replace("__STATE__", state)
                return self._send(503, page.encode(), "text/html; charset=utf-8")
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
                if self.path.endswith("/stop") and body.get("backend") in CORE:  # Core v1's rows, not a model
                    from jev import bench

                    bench.STOP.set()
                    return self._send(200, b"{}")
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
                if self.path.endswith("/folders"):
                    if self.client_address[0] not in ("127.0.0.1", "::1"):
                        raise ValueError("folders can only be changed from this machine")
                    if "add" in body:
                        if in_cache(folders.local_path(body["add"])):
                            raise ValueError("These models are already in the menu.")
                        folders.add(body["add"], listed=(HF_HUB_CACHE, MODELS))
                    elif "remove" in body:
                        folders.remove(body["remove"])
                    elif "find_llama_server" in body:
                        folders.set_llama_server(folders.find_program(body["find_llama_server"]))
                    else:
                        folders.set_llama_server(body["llama_server"])
                    return self._send(200, json.dumps(folder_state()).encode())
                bid = body.get("backend") or model_id
                if not bid.startswith(("remote:", "openrouter:")) and bid not in local_ids([model_id])[0]:
                    raise ValueError(f"{bid} is not in the model menu; add it there first")
                if self.path.endswith("/stop"):  # a download, or the llama-server of a GGUF model
                    if bid.startswith("gguf:"):
                        llamaserver.stop(bid.removeprefix("gguf:"))
                    downloads.stop(bid)
                    return self._send(200, b"{}")
                if self.path.endswith("/delete"):
                    LOADED.pop(bid, None)
                    gc.collect()
                    freed = cache.delete(bid, caches())
                    return self._send(200, json.dumps({"freed": freed}).encode())
                if self.path.endswith("/download"):  # picked in the menu: fetch now, load at run time
                    download_model(bid)
                    return self._send(200, b"{}")
                was_running = set(llamaserver.running())
                jev = get(bid)
                from jev import bench  # bench imports this module

                SYSTEMS[bid] = bench.system(bid, jev)
                by_path = {m["path"]: m for m in backends([]) if m["group"] == "gguf"}
                gone = was_running - set(llamaserver.running())
                stopped_for_room = [by_path[p]["label"] for p in gone if p in by_path]
                if self.path.endswith("/load"):  # downloads a local model the first time
                    answer = {"device": jev.device, "stopped": stopped_for_room}
                    return self._send(200, json.dumps(answer).encode())
                if self.path.endswith("/generate"):
                    if (body.get("backend") or model_id) in TEXTLESS:
                        raise ValueError("This model returns probabilities only; it does not write text")
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
                if body.get("log"):  # every run is kept, with its input, label and the system that answered
                    log_row(body | {"system": SYSTEMS[bid]}, bid, res["answers"], res["latency_ms"], res)
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
                # a failed item is still logged, as the system the run's answered items name, so it counts
                # as wrong in that run; the page starts every model before a run, so only a model this
                # server never started is logged by its id alone
                if self.path.endswith("/systemone") and body.get("log"):
                    system = SYSTEMS.get(bid, {"id": bid})
                    log_row(body | {"system": system}, bid, {}, 0, {"answers": {}, "error": msg})
                self._send(400, json.dumps({"error": {"message": msg}}).encode())

        def log_message(self, fmt, *a):
            if self.path.endswith("/progress"):
                return  # polled every second while the page is open
            sys.stderr.write(f"{self.command} {self.path} {a[1] if len(a) > 1 else ''}\n")

    print(f"open http://localhost:{port}  ({DEVICE}; models in {HF_HUB_CACHE} or {MODELS})")
    if hint := gpu_hint():
        print(hint)
    Thread(target=runs, daemon=True).start()  # summarise the saved runs before Past runs is opened
    # `kill` ends the server like Ctrl+C does, and llama-server stops with it.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    # This machine only; JEV_HOST=0.0.0.0 opens the page and its models to the local network.
    server = ThreadingHTTPServer((os.environ.get("JEV_HOST", "127.0.0.1"), port), H)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()
        # Exit at once: a normal exit first waits for a model still generating or a download still
        # fetching, which held Ctrl-C for minutes. Saved runs are written a row at a time.
        llamaserver.stop()
        sys.stdout.flush()
        os._exit(0)


def build_page():
    """Builds the page when it is missing or older than its source, as after a pull. Without Node
    the server still starts and the page says how to build it."""
    index = os.path.join(WEB, "index.html")
    if os.path.exists(index) and not page_is_stale(index):
        return
    try:
        script = page_tools()
        if not script:
            print(NO_NODE)
            return
        subprocess.run([*script, "build"], cwd=os.path.dirname(WEB), check=True)
    except (OSError, subprocess.CalledProcessError) as e:
        print(f"the page was not built ({e}); open the server for the steps")


def cli(build=True):
    a = sys.argv[1:]
    if a and a[0].startswith("-"):  # e.g. `uv run prod --no-sync`, where uv passes the flag on
        raise SystemExit(f"prod takes a model and a port, not {a[0]}; uv's own flags go before prod")
    if build:
        build_page()
    main(*a[:1], **({"port": int(a[1])} if len(a) > 1 else {}))


if __name__ == "__main__":
    cli()
