"""The labelled sets the page and Core v1 read from the Hugging Face Hub, one record each, and
TypeSafe's published cases: where each comes from, which rows it keeps, and how a row becomes a
request with its truth."""

import ast
import json
import os
import random
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass

from jev.core import ROOT
from jev.local.downloads import PROGRESS
from jev.remote import env

DATA = os.path.join(ROOT, "data")  # rows fetched from the Hub, git-ignored
ROWS = "https://datasets-server.huggingface.co/rows?dataset={}&config={}&split={}&offset={}&length={}"
POOL = 300  # rows of a larger split kept on disk
FULL_ROWS = 3300  # a split this small is kept whole


@dataclass(frozen=True, kw_only=True)
class Source:
    hub: str
    config: str
    split: str
    question: str
    group: str  # the heading it is listed under in the page
    about: str
    provenance: str  # who wrote the text, who made the labels, and any filtering
    options: int = 2
    keep: Callable[[dict], bool] | None = None
    describe: dict[str, str] | None = None  # an option's meaning, where its name alone is unclear
    knowledge: bool = False  # needs knowledge from outside the state by design
    gated: bool = False  # needs a Hugging Face token and the set's terms accepted
    scored: bool = False  # asked as a score: the label is the index of its level
    full: bool = False  # Core v1 picks one per label or subject, or by quota, so it needs every row
    windows: int = 20  # a larger split is read as this many seeded windows


@dataclass(frozen=True, kw_only=True)
class Labelled(Source):
    """The same question for every row, its label in a field of the row."""

    fields: dict[str, str]  # state key -> row field
    label: str | Callable[[dict], str]  # the field holding the label, or a function of the row
    yes: object = None  # the label that means yes; None when the labels are the options


@dataclass(frozen=True, kw_only=True)
class MultipleChoice(Source):
    """Options that differ from row to row."""

    state: Callable[[dict], dict]
    options_of: Callable[[dict], tuple[list, int]]  # the options and the index of the right one


def _subject_and_question(r):
    return {"subject": r["subject"].replace("_", " "), "question": r["question"]}


def _question(r):
    return {"question": r["question"]}


def _lettered(r):
    return r["choices"]["text"], r["choices"]["label"].index(r["answerKey"])


def _global_mmlu_lite(r):
    return [r[f"option_{k}"] for k in "abcd"], "ABCD".index(r["answer"])


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
NLI_PAIR = {"premise": "premise", "hypothesis": "hypothesis"}
TWEETS = "tweets; labels by annotators"
GLOBAL_MMLU = "MMLU questions translated or post-edited by people; cultural sensitivity marked by annotators"

SETS = {
    "SST-2 sentiment": Labelled(
        hub="stanfordnlp/sst2", config="default", split="validation",
        fields={"review": "sentence"}, question="Is this review positive?", label="label", yes="positive",
        group="Sentiment and tone",
        about="Is this movie-review sentence positive?",
        provenance="movie-review sentences; labels by crowd workers",
    ),
    "IMDB": Labelled(
        hub="stanfordnlp/imdb", config="plain_text", split="test",
        fields={"review": "text"}, question="Is this movie review positive?", label="label", yes="pos",
        group="Sentiment and tone",
        about="Is this full movie review positive?",
        provenance="user movie reviews; labels from the reviewer's rating",
    ),
    "Tweet sentiment": Labelled(
        hub="cardiffnlp/tweet_eval", config="sentiment", split="test",
        fields={"tweet": "text"}, question="What is the sentiment of this tweet?", label="label", options=3,
        group="Sentiment and tone",
        about="Tweet: negative, neutral or positive?",
        provenance=TWEETS,
    ),
    "Tweet emotion": Labelled(
        hub="cardiffnlp/tweet_eval", config="emotion", split="test",
        fields={"tweet": "text"}, question="Which emotion does this tweet express?", label="label", options=4,
        group="Sentiment and tone",
        about="Tweet: anger, joy, optimism or sadness?",
        provenance=TWEETS,
    ),
    "Tweet irony": Labelled(
        hub="cardiffnlp/tweet_eval", config="irony", split="test",
        fields={"tweet": "text"}, question="Is this tweet ironic?", label="label", yes="irony",
        group="Sentiment and tone",
        about="Is this tweet ironic?",
        provenance=TWEETS,
    ),
    "RTE entailment": Labelled(
        hub="nyu-mll/glue", config="rte", split="validation",
        fields={"sentence A": "sentence1", "sentence B": "sentence2"},
        question="Does sentence A entail sentence B?", label="label", yes="entailment",
        group="Meaning and reading",
        about="Does sentence A entail sentence B?",
        provenance="news and Wikipedia sentences; labels by annotators",
    ),
    "SNLI": Labelled(
        hub="stanfordnlp/snli", config="plain_text", split="test",
        fields=NLI_PAIR, question="How does the hypothesis relate to the premise?", label="label", options=3,
        group="Meaning and reading",
        about="Premise and hypothesis: entailment, neutral or contradiction?",
        provenance="image captions and crowd-written hypotheses; labels by crowd workers",
    ),
    "MultiNLI mismatched": Labelled(
        hub="nyu-mll/multi_nli", config="default", split="validation_mismatched",
        fields=NLI_PAIR, question="How does the hypothesis relate to the premise?", label="label", options=3,
        group="Meaning and reading",
        about="NLI on genres unseen in training: entailment, neutral or contradiction?",
        provenance="text from five genres and crowd-written hypotheses; labels by crowd workers",
    ),
    "ANLI round 3": Labelled(
        hub="facebook/anli", config="plain_text", split="test_r3",
        fields=NLI_PAIR, question="How does the hypothesis relate to the premise?", label="label", options=3,
        group="Meaning and reading",
        about="Adversarial NLI, written to fool strong models: entailment, neutral or contradiction?",
        provenance="hypotheses written by people to fool models; labels by their writers, checked by others",
    ),
    "BoolQ": Labelled(
        hub="google/boolq", config="default", split="validation",
        fields={"passage": "passage", "question": "question"},
        question="Is the answer to the question yes?", label="answer", yes=True,
        group="Meaning and reading",
        about="Given a Wikipedia passage, is the answer to the question yes?",
        provenance="real search questions and Wikipedia passages; answers by annotators",
    ),
    "MultiRC": Labelled(
        hub="aps/super_glue", config="multirc", split="validation",
        fields={"paragraph": "paragraph", "question": "question", "answer": "answer"},
        question="Is this answer to the question correct?", label="label", yes="True",
        group="Meaning and reading",
        about="A paragraph, a question and a candidate answer: is the answer correct?",
        provenance="paragraphs from several sources; questions and answers by crowd workers",
    ),
    "WinoGrande": MultipleChoice(
        hub="allenai/winogrande", config="winogrande_debiased", split="validation",
        state=lambda r: {"sentence": r["sentence"]},
        question="Which option correctly fills the blank (_)?",
        options_of=lambda r: ([r["option1"], r["option2"]], int(r["answer"]) - 1),
        group="Meaning and reading",
        about="Which option fills the gap in the sentence? Two choices",
        provenance="crowd-written sentences, filtered by an algorithm; answers by their writers",
    ),
    "RAGTruth": Labelled(
        hub="wandb/RAGTruth-processed", config="default", split="test",
        fields={"request": "query", "context": "context", "response": "output"},
        question="Does the response contain a factual claim that contradicts, or is unsupported by, the "
        "supplied request and context?",
        # people marked each unsupported span; any span makes the answer yes
        label=lambda r: "yes" if sum(r["hallucination_labels_processed"].values()) else "no",
        yes="yes",
        keep=lambda r: r["quality"] == "good",
        full=True,
        group="Meaning and reading",
        about="A source, a request and a model's answer: does it claim what the source does not say?",
        provenance="responses by six language models; unsupported spans marked by people; truncated "
        "responses and wrong refusals left out",
    ),
    "SQuAD v2": Labelled(
        hub="rajpurkar/squad_v2", config="squad_v2", split="validation",
        fields={"passage": "context", "question": "question"},
        question="Can the question be answered from the passage?",
        # the answers are never shown: a question with none is unanswerable
        label=lambda r: "yes" if r["answers"]["text"] else "no",
        yes="yes",
        full=True,
        group="Meaning and reading",
        about="A Wikipedia paragraph and a question: can the paragraph answer it?",
        provenance="Wikipedia paragraphs; questions by crowd workers, unanswerable ones written to look "
        "answerable",
    ),
    "MuSR murder mysteries": MultipleChoice(
        hub="TAUR-Lab/MuSR", config="default", split="murder_mysteries",
        state=lambda r: {"story": r["narrative"], "question": r["question"]},
        question="Which answer does the story support?",
        options_of=lambda r: (ast.literal_eval(r["choices"]), int(r["answer_index"])),
        group="Reasoning",
        about="A 1,000-word mystery: who is the most likely murderer? Two suspects",
        provenance="stories written by a language model from a synthetic construction; answers by "
        "construction",
    ),
    "BBH causal judgement": Labelled(
        hub="lukaemon/bbh", config="causal_judgement", split="test",
        fields={"question": "input"}, question="Would a typical person answer yes?",
        label="target", yes="Yes",
        group="Reasoning",
        about="A story about cause and blame: would a typical person say yes?",
        provenance="stories from studies of how people judge causes; labels from people's answers",
    ),
    "BBH date understanding": MultipleChoice(
        hub="lukaemon/bbh", config="date_understanding", split="test",
        state=lambda r: {"question": r["input"].split("\nOptions:")[0]},
        question="Which answer is correct?",
        options_of=lambda r: _bbh_options(r["input"], r["target"]),
        options=6,
        group="Reasoning",
        about="Date arithmetic in words, up to six choices",
        provenance="questions and answers written for BIG-bench",
    ),
    "XNLI Hindi": Labelled(
        hub="facebook/xnli", config="hi", split="test",
        fields=NLI_PAIR, question="How does the hypothesis relate to the premise?", label="label", options=3,
        group="Other languages",
        about="NLI in Hindi: entailment, neutral or contradiction?",
        provenance="MultiNLI-style pairs translated by people; labels from the English pairs",
    ),
    "Global-MMLU-Lite Hindi": MultipleChoice(
        hub="CohereLabs/Global-MMLU-Lite", config="hi", split="test",
        state=_subject_and_question, question="Which answer is correct?", options_of=_global_mmlu_lite,
        options=4, knowledge=True, full=True,
        group="Other languages",
        about="MMLU in Hindi, translated by people, four choices",
        provenance=GLOBAL_MMLU,
    ),
    "Global-MMLU-Lite Chinese": MultipleChoice(
        hub="CohereLabs/Global-MMLU-Lite", config="zh", split="test",
        state=_subject_and_question, question="Which answer is correct?", options_of=_global_mmlu_lite,
        options=4, knowledge=True, full=True,
        group="Other languages",
        about="MMLU in Chinese, translated by people, four choices",
        provenance=GLOBAL_MMLU,
    ),
    "Global-MMLU-Lite English": MultipleChoice(
        hub="CohereLabs/Global-MMLU-Lite", config="en", split="test",
        state=_subject_and_question, question="Which answer is correct?", options_of=_global_mmlu_lite,
        options=4, knowledge=True, full=True,
        group="Other languages",
        about="The same MMLU questions in English, the control for Hindi and Chinese",
        provenance="MMLU questions in English; cultural sensitivity marked by annotators",
    ),
    "Banking77": Labelled(
        hub="legacy-datasets/banking77", config="default", split="test",
        fields={"message": "text"}, question="What does the customer want?", label="label",
        options=77, full=True,
        group="Intent and topic",
        about="Banking customer message: which of 77 intents?",
        provenance="banking customer-service queries; intent labels from the released Banking77 dataset",
    ),
    "CLINC150": Labelled(
        hub="clinc/clinc_oos", config="plus", split="test",
        fields={"message": "text"}, question="What does the user want? (oos = none of these)", label="intent",
        options=151, full=True,
        group="Intent and topic",
        about="Assistant request: which of 150 intents, or out of scope?",
        provenance="crowd-written assistant requests; labels from collection tasks and curator checks, "
        "including out-of-scope requests",
    ),
    "AG News topic": Labelled(
        hub="fancyzhx/ag_news", config="default", split="test",
        fields={"news": "text"}, question="Which section does this news belong to?", label="label", options=4,
        group="Intent and topic",
        about="News snippet: World, Sports, Business or Sci/Tech?",
        provenance="news titles and descriptions; topic labels inherited from the AG News corpus",
    ),
    "DBpedia-14": Labelled(
        hub="fancyzhx/dbpedia_14", config="dbpedia_14", split="test",
        fields={"title": "title", "article": "content"},
        question="What kind of thing is this article about?", label="label", options=14,
        windows=56,  # its test split is 14 label blocks of 5,000 rows: four windows a block
        group="Intent and topic",
        about="Wikipedia article: which of 14 kinds of thing?",
        provenance="Wikipedia abstracts; labels from DBpedia's ontology (metadata)",
    ),
    "MMLU": MultipleChoice(
        hub="cais/mmlu", config="all", split="test",
        state=_subject_and_question, question="Which answer is correct?",
        options_of=lambda r: (r["choices"], int(r["answer"])),
        options=4, knowledge=True, full=True,
        group="Knowledge and exams",
        about="Exam question from 57 subjects, four choices",
        provenance="exam questions from public sources; only those MMLU-Redux 2.0 re-checked and marked ok",
    ),
    "MMLU-Pro": MultipleChoice(
        hub="TIGER-Lab/MMLU-Pro", config="default", split="test",
        state=lambda r: {"subject": r["category"], "question": r["question"]},
        question="Which answer is correct?",
        options_of=lambda r: (r["options"], int(r["answer_index"])),
        options=10, knowledge=True,
        windows=60,  # its smallest category has about 380 rows
        group="Knowledge and exams",
        about="Harder exam question, ten choices",
        provenance="MMLU and other academic problems; distractors added using GPT-4 and reviewed by people",
    ),
    "ARC-Challenge": MultipleChoice(
        hub="allenai/ai2_arc", config="ARC-Challenge", split="test",
        state=_question, question="Which answer is correct?", options_of=_lettered,
        options=4, knowledge=True,
        keep=lambda r: len(r["choices"]["text"]) == 4,  # so answer positions can balance
        group="Knowledge and exams",
        about="Grade-school science question that simple methods get wrong",
        provenance="grade-school science exam questions; keys from the exams; four-option items only",
    ),
    "OpenBookQA": MultipleChoice(
        hub="allenai/openbookqa", config="main", split="test",
        state=lambda r: {"question": r["question_stem"]}, question="Which answer is correct?",
        options_of=_lettered,
        options=4, knowledge=True,
        group="Knowledge and exams",
        about="Elementary science question needing a fact plus common sense",
        provenance="crowd-written science questions; answers by their writers",
    ),
    "CommonsenseQA": MultipleChoice(
        hub="tau/commonsense_qa", config="default", split="validation",
        state=_question, question="Which answer is the most sensible?", options_of=_lettered,
        options=5, knowledge=True,
        group="Knowledge and exams",
        about="Everyday-knowledge question, five choices",
        provenance="crowd-written questions; answers by their writers",
    ),
    "GoldenSwag": MultipleChoice(
        hub="PleIAs/GoldenSwag", config="default", split="validation",
        state=lambda r: {"activity": r["activity_label"], "context": r["ctx"]},
        question="Which ending is the most likely continuation?",
        options_of=lambda r: (r["endings"], int(r["label"])),
        options=4,
        group="Knowledge and exams",
        about="Which ending continues the scene most plausibly? HellaSwag's checked items",
        provenance="HellaSwag source continuations and model-generated distractors; filtered using model "
        "annotations and quality checks",
    ),
    "TruthfulQA": MultipleChoice(
        hub="truthfulqa/truthful_qa", config="multiple_choice", split="validation",
        state=_question, question="Which answer is true?",
        options_of=lambda r: _shuffled(r["question"], *_true_and_false(r["mc1_targets"])),
        options=13, knowledge=True,
        group="Knowledge and exams",
        about="Which answer is true, where a common misconception is also offered?",
        provenance="questions and answers written by the authors",
    ),
    "MedQA": MultipleChoice(
        hub="GBaker/MedQA-USMLE-4-options", config="default", split="test",
        state=_question, question="Which answer is correct?",
        options_of=lambda r: (list(r["options"].values()), list(r["options"]).index(r["answer_idx"])),
        options=4, knowledge=True,
        group="Knowledge and exams",
        about="US medical licensing exam question, four choices",
        provenance="medical licensing exam and mock-test questions; answer keys from the source",
    ),
    "PubMedQA": MultipleChoice(
        hub="qiaojin/PubMedQA", config="pqa_labeled", split="train",
        state=lambda r: {"abstract": " ".join(r["context"]["contexts"]), "question": r["question"]},
        question="What conclusion about the question is supported by the supplied study context?",
        options_of=lambda r: (["yes", "no", "maybe"], ["yes", "no", "maybe"].index(r["final_decision"])),
        options=3,
        describe={"maybe": "the evidence is mixed or inconclusive"},
        group="Knowledge and exams",
        about="A research abstract and a question: yes, no or maybe?",
        provenance="PubMed abstracts and their titles as questions; labels by experts",
    ),
    "GPQA Diamond": MultipleChoice(
        hub="Idavidrein/gpqa", config="gpqa_diamond", split="train",
        state=lambda r: {"question": r["Question"]}, question="Which answer is correct?",
        options_of=lambda r: _shuffled(
            r["Question"], r["Correct Answer"], [r[f"Incorrect Answer {k}"] for k in (1, 2, 3)]
        ),
        options=4, knowledge=True, gated=True,
        group="Knowledge and exams",
        about="Graduate-level science question written to resist search (needs HF_TOKEN)",
        provenance="questions written by domain experts; answers checked by other experts",
    ),
    "ToxicChat": Labelled(
        hub="lmsys/toxic-chat", config="toxicchat0124", split="test",
        fields={"user message": "user_input"}, question="Is this message to a chatbot toxic?",
        label="toxicity", yes=1,
        keep=lambda r: r["human_annotation"],  # the rest were labelled by a model
        full=True,
        group="Safety and spam",
        about="A real user message to a chatbot: toxic or not, labelled by people?",
        provenance="real user messages to a chatbot; labels by people, people-annotated rows only",
    ),
    "Tweet hate": Labelled(
        hub="cardiffnlp/tweet_eval", config="hate", split="test",
        fields={"tweet": "text"}, question="Is this tweet hateful towards immigrants or women?",
        label="label", yes="hate",
        group="Safety and spam",
        about="Is this tweet hate speech against immigrants or women?",
        provenance=TWEETS,
    ),
    "Tweet offensive": Labelled(
        hub="cardiffnlp/tweet_eval", config="offensive", split="test",
        fields={"tweet": "text"}, question="Is this tweet offensive?", label="label", yes="offensive",
        group="Safety and spam",
        about="Is this tweet offensive?",
        provenance=TWEETS,
    ),
    "SMS spam": Labelled(
        hub="ucirvine/sms_spam", config="plain_text", split="train",
        fields={"sms": "sms"}, question="Is this text message spam?", label="label", yes="spam",
        group="Safety and spam",
        about="Is this text message spam?",
        provenance="real text messages; labels from the collection",
    ),
    "Jailbreak attempts": Labelled(
        hub="lmsys/toxic-chat", config="toxicchat0124", split="test",
        fields={"user message": "user_input"},
        question="Is this message trying to get the chatbot to break its rules or safety guidelines?",
        label="jailbreaking", yes=1,
        keep=lambda r: r["human_annotation"],
        full=True,
        group="Safety and spam",
        about="A real user message to a chatbot: is it trying to break its rules?",
        provenance="real user messages to a chatbot; labels by people, people-annotated rows only; "
        "ordinary messages matched in length",
    ),
    "BBQ race and ethnicity": MultipleChoice(
        hub="heegyu/bbq", config="Race_ethnicity", split="test",  # this copy keeps each item's template
        state=lambda r: {"context": r["context"], "question": r["question"]},
        question="Based only on the context, which answer is supported?",
        options_of=lambda r: ([r["ans0"], r["ans1"], r["ans2"]], int(r["label"])),
        options=3, full=True,
        group="Safety and spam",
        about="A short scene and a question where one answer is a stereotype",
        provenance="templated contexts and questions written by the authors; answers by construction",
    ),
    "Arena votes": MultipleChoice(
        hub="lmarena-ai/arena-human-preference-55k", config="default", split="train",
        state=lambda r: {
            "prompt": _joined(r["prompt"]),
            "response A": _joined(r["response_a"]),
            "response B": _joined(r["response_b"]),
        },
        question="Which response did the person who asked prefer?",
        options_of=lambda r: (
            ["response A was preferred", "response B was preferred", "recorded tie"],
            [r["winner_model_a"], r["winner_model_b"], r["winner_tie"]].index(1),
        ),
        options=3,
        keep=lambda r: len(json.loads(r["prompt"])) == 1,  # joined turns lose their order
        group="Which answer is better",
        about="Two chatbot answers to one prompt: which did the person prefer, or a tie?",
        provenance="real user prompts and chatbot responses; one person's recorded vote; single-turn only",
    ),
    "RewardBench": MultipleChoice(
        hub="allenai/reward-bench", config="default", split="filtered",
        state=lambda r: {"prompt": r["prompt"], **_pair(r["id"], r["chosen"], r["rejected"])},
        question="Which response better satisfies the request, considering correctness, relevance and "
        "safety?",
        options_of=lambda r: (["A is better", "B is better"], 0 if int(r["id"]) % 2 == 0 else 1),
        full=True,
        group="Which answer is better",
        about="A prompt and two responses: which is better? Labels from a curated benchmark",
        provenance="response pairs from several sources; rankings from source-specific human, model or "
        "correctness criteria, with manual and metadata-based filtering",
    ),
    "HelpSteer2": MultipleChoice(
        hub="nvidia/HelpSteer2", config="default", split="validation",
        state=lambda r: {"prompt": r["prompt"], "response": r["response"]},
        question="How helpful is the response to the prompt?",
        options_of=lambda r: (HELPFULNESS, int(r["helpfulness"])),
        options=5, scored=True,
        keep=lambda r: "<extra_id_1>" not in r["prompt"],  # multi-turn chats joined by markers
        group="Which answer is better",
        about="A prompt and a response: how helpful is it, from 0 to 4? Rated by people",
        provenance="prompts and model responses; helpfulness rated by annotators; single-turn only",
    ),
    "ContractNLI": Labelled(
        hub="kiddothe2b/contract-nli", config="contractnli_a", split="test",
        fields={"contract clause": "premise", "hypothesis": "hypothesis"},
        question="Given only this excerpt, is the hypothesis entailed, contradicted, or neither?",
        label="label", options=3,
        describe={"neutral": "neither established nor contradicted"},
        group="Contracts and business",
        about="An NDA clause against a hypothesis: entailed, contradicted or not mentioned?",
        provenance="non-disclosure agreement text; labels by a computational linguistics researcher with "
        "crowd-worker assistance",
    ),
    "LEDGAR": Labelled(
        hub="coastalcph/lex_glue", config="ledgar", split="test",
        fields={"contract provision": "text"}, question="Which kind of contract provision is this?",
        label="label", options=100, full=True,
        group="Contracts and business",
        about="Contract provision: which of 100 provision types?",
        provenance="contract provisions from SEC filings; labels from their headings (metadata)",
    ),
    "LegalBench hearsay": Labelled(
        hub="nguha/legalbench", config="hearsay", split="test",
        fields={"evidence": "text"},
        # the task's own test, which leaves exclusions and exceptions aside
        question="Is this evidence hearsay under this simple test only: a statement (spoken, written, or "
        "conduct meant to assert something) made out of court and offered to prove that what it asserts is "
        "true? Ignore the legal exclusions and exceptions, such as a party's own statements.",
        label="answer", yes="Yes", knowledge=True,
        group="Contracts and business",
        about="A piece of evidence and the issue it is offered for: is it hearsay?",
        provenance="hand-written legal fact patterns inspired by casebooks and exercises; labels from the "
        "task authors",
    ),
    "LegalBench definitions": Labelled(
        hub="nguha/legalbench", config="definition_classification", split="test",
        fields={"sentence": "text"}, question="Does this sentence from a court opinion define a term?",
        label="answer", yes="Yes",
        group="Contracts and business",
        about="A sentence from a US court opinion: does it define a term?",
        provenance="sentences from US Supreme Court opinions; hand-coded definition labels from the task "
        "authors",
    ),
}  # fmt: skip

# Listed beside the Hub sets in the page: (group, about)
OTHERS = {
    "Core v1": (
        "Frozen benchmarks",
        "Picked 2026-09-24 from the decided question list, Review 2 next: 50 items a set (one per "
        "label or subject where it has more), spread over its strata, and every TypeSafe step. "
        "Banking77, CLINC150 and LEDGAR join only when every picked model reads over 26 options",
    ),
    "TypeSafe cases": (
        "Contracts and business",
        "TypeSafe's published cases: a business document with several questions",
    ),
}
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
