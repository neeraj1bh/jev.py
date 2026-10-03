import { useRef, useState } from "react";

import type { InputSource } from "../../components/run/InputBar";
import { errorMessage, sampleItem } from "../../lib/api";
import { EXAMPLES, type ExampleName } from "../../lib/examples";
import type { Item, Question, Request } from "../../lib/types";
import type { RunContext } from "./context";
import type { Results } from "./useResults";
import type { RunView } from "./useRunView";

const FIRST_EXAMPLE: ExampleName = "Support ticket";
const prettyJson = (value: unknown) => JSON.stringify(value, null, 2);

/** What the screen asks: a built-in example, an item dealt from a dataset, or hand-edited JSON. */
export function useRunInput(ctx: RunContext, view: RunView, results: Results) {
  const { datasets, compareModels, generateModel, isCompare, readsWide, markDatasetLocal } = ctx;
  const { toast, confirm, setKeysOpen, setOpenMenu } = ctx;
  const { setVerdict, resetPanels, showExampleResult, exampleResults } = view;
  const { clearBatch } = results;
  const fetchAgreed = useRef(new Set<string>()); // frozen benchmarks the viewer agreed to download

  const [source, setSource] = useState<InputSource>("examples");

  const [example, setExample] = useState<ExampleName | "">(FIRST_EXAMPLE);

  const [dataset, setDataset] = useState("");

  const [stateText, setStateText] = useState(prettyJson(EXAMPLES[FIRST_EXAMPLE].state));

  const [questionsText, setQuestionsText] = useState(prettyJson(EXAMPLES[FIRST_EXAMPLE].questions));

  const [item, setItem] = useState<Item | null>(null);

  const [remaining, setRemaining] = useState<number | null>(null);

  const [editing, setEditing] = useState(false);

  const inputName = dataset || example || "edited input";

  const labels = item && Object.keys(item.truth).length > 0 ? item.truth : undefined;
  // The item on screen decides the questions; the editor only matters for hand-edited input.
  const asked: Record<string, Question> = (() => {
    if (item) return item.questions;
    try {
      const questions: unknown = JSON.parse(questionsText);
      return questions && typeof questions === "object"
        ? (questions as Record<string, Question>)
        : {};
    } catch {
      return {};
    }
  })();

  const questionIds = Object.keys(asked);
  const questionCount = item ? Object.keys(item.truth).length : 0;

  const fillEditors = (request: Request) => {
    setStateText(prettyJson(request.state));
    setQuestionsText(prettyJson(request.questions));
  };

  /** The item on screen and the input that Run sends must be the same item. */
  const showRequest = (next: Item) => {
    setItem(next);
    fillEditors(next);
  };

  function chooseExample(name: ExampleName) {
    setDataset("");
    setItem(null);
    setRemaining(null);
    clearBatch();
    setExample(name);
    fillEditors(EXAMPLES[name]);
    const saved = exampleResults.current[name];
    if (saved) showExampleResult(saved);
    else resetPanels();
  }

  function chooseSource(next: InputSource) {
    setSource(next);
    if (next === "examples") chooseExample(example || FIRST_EXAMPLE);
    else if (!dataset) setOpenMenu("dataset");
  }

  async function nextItem(name = dataset): Promise<Item | null> {
    const set = datasets.find((d) => d.name === name);
    try {
      const next = await sampleItem(
        name,
        false,
        readsWide(isCompare ? compareModels : [generateModel]),
      );
      if (set && !set.local) markDatasetLocal(name);
      showRequest(next);
      resetPanels();
      setRemaining(next.left ?? null);
      return next;
    } catch (error) {
      toast.show(errorMessage(error));
      return null;
    }
  }

  async function chooseDataset(name: string) {
    setOpenMenu("");
    if (datasets.find((set) => set.name === name)?.needs_token) {
      setKeysOpen(true);
      toast.show(
        `${name} is behind a Hugging Face login: add a read token here, and accept its terms on its Hugging Face page.`,
      );
      return;
    }
    // A frozen benchmark's first use downloads its rows: its wide sets too when every picked model
    // reads over 26 options, as the load that follows will.
    const chosen = datasets.find((set) => set.name === name);
    const wide = readsWide(isCompare ? compareModels : [generateModel]);
    const pages = (chosen?.fetch?.pages ?? 0) + (wide ? (chosen?.fetch_wide?.pages ?? 0) : 0);
    const sources =
      (chosen?.fetch?.datasets ?? 0) + (wide ? (chosen?.fetch_wide?.datasets ?? 0) : 0);
    const agreedKey = `${name}${wide ? " + wide" : ""}`;
    if (pages && !fetchAgreed.current.has(agreedKey)) {
      const ok = await confirm.ask(
        `Download ${name}'s items?`,
        `${name} is rebuilt from public Hugging Face datasets the first time: ${pages} pages of rows ` +
          `from ${sources} datasets, kept on this machine afterwards. It can take a while, as Hugging ` +
          "Face paces downloads; the bar below counts the pages. Stop keeps every finished dataset, " +
          "and choosing it again fetches the rest. Nothing is paid.",
        "Download",
      );
      if (!ok) return;
      fetchAgreed.current.add(agreedKey);
    }
    setDataset(name);
    setExample("");
    clearBatch();
    setRemaining(null);
    setVerdict(
      pages
        ? `Downloading ${name}'s items; progress shows below.`
        : `Fetching an item from ${name}…`,
    );
    if (await nextItem(name)) setVerdict("Run to score it against the dataset's label.");
  }

  return {
    source,
    setSource,
    example,
    setExample,
    dataset,
    setDataset,
    stateText,
    setStateText,
    questionsText,
    setQuestionsText,
    item,
    remaining,
    setRemaining,
    editing,
    setEditing,
    inputName,
    labels,
    asked,
    questionIds,
    questionCount,
    showRequest,
    chooseExample,
    chooseSource,
    nextItem,
    chooseDataset,
  };
}

export type RunInput = ReturnType<typeof useRunInput>;
