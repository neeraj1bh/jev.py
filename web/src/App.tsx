import { type ReactNode, useCallback, useRef, useState } from "react";

import { fetchProgress, fetchRun, fetchRuns, loadModel, sampleItem } from "./api";
import { isHosted, TEXTLESS } from "./backends";
import { BatchTable } from "./components/BatchTable";
import { EditDialog } from "./components/EditDialog";
import { Header } from "./components/Header";
import { InputBar, type InputSource } from "./components/InputBar";
import { ItemDialog } from "./components/ItemDialog";
import { KeyDialog } from "./components/KeyDialog";
import { ModelPicker, ModelsPicker } from "./components/ModelPicker";
import { type KindFilter, PastRuns } from "./components/PastRuns";
import { CompareView, GenerateView } from "./components/ResultPanels";
import { Summary } from "./components/Summary";
import { Toast } from "./components/Toast";
import { EXAMPLES, type ExampleName, isExampleName } from "./examples";
import { useBackends } from "./hooks/useBackends";
import { idlePanel, runningPanel, usePanels } from "./hooks/usePanels";
import { isString, usePersistentState } from "./hooks/usePersistentState";
import { useTheme } from "./hooks/useTheme";
import { useToast } from "./hooks/useToast";
import { now, runBatchLoop, runEach, timedGenerate, timedReadout } from "./runner";
import { readoutFooter, writtenAnswers } from "./scoring";
import { cn, ghostButton, labelText, solidButton } from "./styles";
import type { Item, Mode, Recording, Request, Row, RunKind, SavedRun } from "./types";
import { compareVerdict, generateVerdict, rowRecording } from "./verdicts";

const FIRST_EXAMPLE: ExampleName = "Support ticket";
const isKindFilter = (value: unknown): value is KindFilter =>
  value === "" || value === "cmp" || value === "gen";
const HOSTED_PARALLEL = 8;

const prettyJson = (value: unknown) => JSON.stringify(value, null, 2);
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const logTimestamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

export default function App() {
  const theme = useTheme();
  const toast = useToast();
  const {
    backends,
    datasets,
    generateModel,
    setGenerateModel,
    compareModels,
    setCompareModels,
    reload,
    markDatasetLocal,
  } = useBackends();
  const {
    panels,
    setPanels,
    reset: resetPanelStates,
    update: updatePanel,
    markFastest,
  } = usePanels();

  const [mode, setMode] = useState<Mode>("compare");
  const [source, setSource] = useState<InputSource>("examples");
  const [example, setExample] = useState<ExampleName | "">(FIRST_EXAMPLE);
  const [dataset, setDataset] = useState("");
  const [stateText, setStateText] = useState(prettyJson(EXAMPLES[FIRST_EXAMPLE].state));
  const [questionsText, setQuestionsText] = useState(prettyJson(EXAMPLES[FIRST_EXAMPLE].questions));
  const [item, setItem] = useState<Item | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<ReactNode>("Run to compare.");
  const [panelsVisible, setPanelsVisible] = useState(true);
  const [writtenAsAnswers, setWrittenAsAnswers] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [savedNames, setSavedNames] = useState<string[] | null>(null);
  const [tableVisible, setTableVisible] = useState(false);
  const [logFile, setLogFile] = useState({ text: "", path: "" });
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [busy, setBusy] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");
  const [batchSize, setBatchSize] = usePersistentState("batch-size", "50", isString);
  const [editing, setEditing] = useState(false);
  const [keyRequest, setKeyRequest] = useState<{ backend: string; forCompare: boolean } | null>(
    null,
  );
  const [openItem, setOpenItem] = useState<{
    index: number;
    direction: "" | "forward" | "back";
    open: boolean;
  } | null>(null);
  const [openMenu, setOpenMenu] = useState("");
  const [replayRow, setReplayRow] = useState<number | null>(null);
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  const [runsPage, setRunsPage] = useState(1);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsKind, setRunsKind] = usePersistentState<KindFilter>("runs-kind", "", isKindFilter);

  const rowsRef = useRef<Row[]>([]);
  const batchKey = useRef("");
  const freshDeck = useRef(false);
  const stopRequested = useRef(false);
  const generateBatch = useRef(false);
  const logSession = useRef({ key: "", name: "" });
  const exampleResults = useRef<Record<string, Recording>>({});
  const panelsRef = useRef<HTMLDivElement>(null);

  const isCompare = mode === "compare";
  const runKind: RunKind = mode === "generate" ? "gen" : "cmp";
  const compareNames = savedNames ?? compareModels.map((id) => backends[id]?.label ?? id);
  const inputName = dataset || example || "edited input";
  const questionIds = (() => {
    try {
      const questions: unknown = JSON.parse(questionsText);
      return questions && typeof questions === "object" ? Object.keys(questions) : [];
    } catch {
      return [];
    }
  })();
  const isLocal = (id: string) => !isHosted(backends[id]);

  const menuHandler = useCallback(
    (id: string) => (open: boolean) =>
      setOpenMenu((current) => (open ? id : current === id ? "" : current)),
    [],
  );

  const shortName = (id: string) =>
    backends[id]?.label ??
    id
      .replace(/^remote:/, "")
      .split("/")
      .pop() ??
    id;
  const columnName = (id: string, kind?: RunKind) =>
    id.endsWith("#text")
      ? `${shortName(id.slice(0, -5))} · text`
      : shortName(id) + (kind === "gen" ? " · probabilities" : "");

  const replaceRows = (next: Row[]) => {
    rowsRef.current = next;
    setRows(next);
  };

  const fillEditors = (request: Request) => {
    setStateText(prettyJson(request.state));
    setQuestionsText(prettyJson(request.questions));
  };

  const resetPanels = (count = isCompare ? compareNames.length : 2) => {
    resetPanelStates(count);
    setPanelsVisible(true);
    if (!batchKey.current) setSummaryVisible(false);
    setVerdict("Run to compare.");
    setRecording(null);
  };

  const closeSavedRun = () => {
    setSavedNames(null);
    setWrittenAsAnswers(false);
  };

  /** A new input, model or tab: the table, summary and any open saved run no longer apply. */
  const clearBatch = () => {
    replaceRows([]);
    batchKey.current = "";
    setRecording(null);
    setTableVisible(false);
    setSummaryVisible(false);
    setPanelsVisible(true);
    setOpenItem(null);
    closeSavedRun();
  };

  const showExampleResult = (recorded: Recording) => {
    const { written, readout } = recorded;
    if (!written || !readout) return;
    setPanels([
      { status: "done", ms: written.ms, text: written.text, footer: written.footer },
      { status: "done", ms: readout.ms, response: readout.response, footer: readout.footer },
    ]);
    setVerdict(recorded.verdict);
    setRecording(recorded);
    setPanelsVisible(true);
  };

  const warnIfTooManyOptions = (models: string[], name = dataset) => {
    const set = datasets.find((d) => d.name === name);
    const blocker =
      set &&
      models.map((id) => backends[id]).find((b) => b?.max && set.options && set.options > b.max);
    if (set && blocker) {
      toast.show(
        `${name} asks to pick 1 of ${set.options}; ${blocker.label} reads the answer as a letter and takes at most ${blocker.max}. Pick Jev or a local model, or another set.`,
      );
    }
  };

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    closeSavedRun();
    setTableVisible(false);
    setSummaryVisible(false);
    if (next === "past") {
      setRunsLoading(true);
      fetchRuns()
        .then(setSavedRuns)
        .finally(() => setRunsLoading(false));
      return;
    }
    clearBatch();
    exampleResults.current = {};
    resetPanels(next === "compare" ? compareModels.length : 2);
    reload();
  }

  function askForKey(backend: string, forCompare: boolean) {
    setOpenMenu("");
    setKeyRequest({ backend, forCompare });
  }

  async function onKeySaved(backend: string) {
    const forCompare = keyRequest?.forCompare ?? true;
    setKeyRequest(null);
    if (forCompare)
      setCompareModels((models) =>
        models.includes(backend) ? models : [...models, backend].slice(-6),
      );
    else setGenerateModel(backend);
    exampleResults.current = {};
    resetPanels();
    await reload();
    if (forCompare && mode === "generate") switchMode("compare");
  }

  function pickGenerateModel(id: string) {
    setOpenMenu("");
    const backend = backends[id];
    if (!backend) return;
    if (TEXTLESS.has(id)) {
      // Jev never writes text, so it can only be compared.
      if (!backend.ready) {
        askForKey(id, true);
        return;
      }
      if (!compareModels.includes(id))
        setCompareModels((models) => [...models.slice(0, 1), id, ...models.slice(2)]);
      switchMode("compare");
      return;
    }
    if (!backend.ready) {
      askForKey(id, false);
      return;
    }
    setGenerateModel(id);
    clearBatch();
    exampleResults.current = {};
    resetPanels();
    warnIfTooManyOptions([id]);
  }

  function toggleCompareModel(id: string) {
    const backend = backends[id];
    if (!backend) return;
    const adding = !compareModels.includes(id);
    if (adding && !backend.ready && backend.group === "hosted") {
      askForKey(id, true);
      return;
    }
    const next = adding ? [...compareModels, id] : compareModels.filter((model) => model !== id);
    setCompareModels(next);
    clearBatch();
    exampleResults.current = {};
    resetPanels(next.length);
    warnIfTooManyOptions(next);
  }

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

  /** Polls download progress so a long first download shows how far it is. */
  function watchDownload(key: string, what: string) {
    const timer = setInterval(async () => {
      const progress = (await fetchProgress().catch(() => null))?.[key];
      if (!progress) return;
      if (progress.unit !== "bytes") {
        setVerdict(
          `Downloading ${what} · page ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`,
        );
        return;
      }
      const gb = (bytes: number) => (bytes / 1e9).toFixed(1);
      const share = progress.total
        ? ` of ${gb(progress.total)} GB (${Math.min(99, Math.round((100 * progress.done) / progress.total))}%)`
        : " GB";
      setVerdict(`Downloading ${what} · ${gb(progress.done)}${share}`);
    }, 500);
    return () => clearInterval(timer);
  }

  async function nextItem(name = dataset): Promise<Item | null> {
    const set = datasets.find((d) => d.name === name);
    const stopWatching = set && !set.local ? watchDownload(name, name) : () => {};
    try {
      const next = await sampleItem(name);
      if (set && !set.local) markDatasetLocal(name);
      setItem(next);
      fillEditors(next);
      resetPanels();
      setRemaining(next.left ?? null);
      return next;
    } catch (error) {
      toast.show(errorMessage(error));
      return null;
    } finally {
      stopWatching();
    }
  }

  async function chooseDataset(name: string) {
    setOpenMenu("");
    setDataset(name);
    setExample("");
    clearBatch();
    setRemaining(null);
    setVerdict(`Fetching an item from ${name}…`);
    if (await nextItem(name)) setVerdict("Run to score it against the dataset's label.");
  }

  /** Downloads a local model on first use, then loads it, so timing starts warm. */
  async function prepare(id: string) {
    const backend = backends[id];
    if (!backend) {
      setVerdict("Pick a model first.");
      return false;
    }
    const downloading = backend.group === "local" && !backend.ready;
    if (downloading) {
      const size = backend.gb ? ` (${backend.gb} GB)` : "";
      if (!confirm(`Download ${backend.label}${size} into ${backend.path}?`)) return false;
      setVerdict(`Downloading ${backend.label}. First time only; this can take minutes.`);
    } else if (backend.group === "local") {
      setVerdict(`Loading ${backend.label}…`);
    }
    const stopWatching = downloading ? watchDownload(id, backend.label) : () => {};
    try {
      await loadModel(id);
    } catch (error) {
      setVerdict(errorMessage(error));
      toast.show(errorMessage(error));
      return false;
    } finally {
      stopWatching();
    }
    if (!backend.ready) await reload();
    return true;
  }

  /** One log file per mode, input and models; changing any of them starts a new one. */
  function logName(models: string[]) {
    const key = [runKind, inputName, ...models].join("|");
    if (key !== logSession.current.key) {
      logSession.current = {
        key,
        name: `${logTimestamp()}-${runKind}-${inputName}-${models.map(shortName).join("-vs-")}`,
      };
    }
    return logSession.current.name;
  }

  const logFields = (models: string[], current: Item | null) => ({
    log: logName(models),
    mode: runKind,
    sides: models,
    dataset: inputName,
    source: current?.source ?? "built-in example",
    truth: current?.truth ?? {},
  });

  async function readoutInto(index: number, body: Parameters<typeof timedReadout>[0]) {
    const result = await timedReadout(body, (startedAt) =>
      updatePanel(index, runningPanel("Scoring every option…", startedAt)),
    );
    const { startedAt, ms, response, footer } = result;
    updatePanel(index, {
      status: "done",
      startedAt,
      ms,
      response: result.failed ? undefined : response,
      footer,
    });
    if (result.failed) toast.show(footer);
    return result;
  }

  async function writeInto(body: object) {
    const written = await timedGenerate(
      body,
      (startedAt) => updatePanel(0, { ...runningPanel("Streaming…", startedAt), text: "" }),
      (text) => updatePanel(0, (panel) => ({ ...panel, text })),
    );
    updatePanel(0, {
      status: "done",
      startedAt: written.startedAt,
      ms: written.ms,
      text: written.text,
      footer: written.footer,
    });
    return written;
  }

  async function run(batchItem?: Item): Promise<boolean> {
    const current = batchItem ?? item;
    let request: Request;
    try {
      request = batchItem
        ? { state: batchItem.state, questions: batchItem.questions }
        : { state: JSON.parse(stateText), questions: JSON.parse(questionsText) };
    } catch {
      setVerdict("The state and the questions must both be valid JSON.");
      return false;
    }
    const models = isCompare ? compareModels : [generateModel];
    closeSavedRun();
    for (const id of models) if (!(await prepare(id))) return false;

    const body = { ...request, ...logFields(models, current) };
    setVerdict("Running…");
    setRecording(null);
    setPanelsVisible(true);
    resetPanelStates(isCompare ? models.length : 2);

    if (isCompare) {
      const sides = await runEach(models, isLocal, (id, i) =>
        readoutInto(i, { ...body, backend: id }),
      );
      if (sides.some((side) => side.failed)) {
        setVerdict("A model failed; its message is under its panel.");
        return false;
      }
      const sentence = compareVerdict(models.map(shortName), sides);
      setVerdict(sentence);
      markFastest(sides.map((side) => side.ms));
      setRecording({ sides, verdict: sentence });
      return true;
    }

    const model = generateModel;
    const hosted = isHosted(backends[model]);
    const readoutBody = { ...body, backend: model };
    const writeBody = { ...body, backend: model };
    if (!hosted) updatePanel(0, { ...idlePanel(), footer: "Waits for the logits to finish." });
    const [read, writtenAtOnce] = hosted
      ? await Promise.all([readoutInto(1, readoutBody), writeInto(writeBody)])
      : [await readoutInto(1, readoutBody), null];
    if (read.failed) {
      setVerdict(read.footer);
      return false;
    }
    const written = writtenAtOnce ?? (await writeInto(writeBody));
    markFastest([written.ms, read.ms]);
    const sentence = generateVerdict(written, read, !hosted);
    const recorded: Recording = { readout: read, written, verdict: sentence };
    setVerdict(sentence);
    setRecording(recorded);
    if (!current) exampleResults.current[example] = recorded;

    if (current && generateBatch.current) {
      if (!rowsRef.current.length)
        setColumns([columnName(`${model}#text`), columnName(model, "gen")]);
      setTableVisible(true);
      setLogFile({
        text: hosted ? "saved locally · both ways at once" : "saved locally · one after the other",
        path: `results/logs/demo/${logSession.current.name}.jsonl`,
      });
      const writtenSide = {
        ms: written.ms,
        response: { answers: writtenAnswers(written.parsed, request.questions) },
      };
      const readSide = { ms: read.ms, response: read.response };
      replaceRows([
        ...rowsRef.current,
        { item: current, sides: [writtenSide, readSide], isNew: true },
      ]);
    }
    return true;
  }

  async function onRun() {
    setBusy(true);
    try {
      await run();
    } catch (error) {
      toast.show(`The run stopped: ${errorMessage(error)}. Is the demo server still running?`);
    } finally {
      setBusy(false);
    }
  }

  function showItem(index: number, open = true) {
    const allRows = rowsRef.current;
    if (!allRows[index]) return;
    setOpenItem((previous) => ({
      index,
      open: open || !!previous?.open,
      direction:
        previous?.open && index !== previous.index
          ? index > previous.index
            ? "forward"
            : "back"
          : "",
    }));
    setItem(allRows[index].item);
    const recorded = rowRecording(allRows, index, columns);
    if (recorded) setRecording(recorded);
  }

  async function runCompareBatch(total: number) {
    const models = compareModels.slice();
    for (const id of models) if (!(await prepare(id))) return;
    const hostedCount = models.filter((id) => !isLocal(id)).length;
    const workers = hostedCount === models.length ? HOSTED_PARALLEL : 1;

    // The same set and models keep adding to the table; anything else starts a new one.
    const key = [dataset, ...models].join("|");
    if (key !== batchKey.current) {
      batchKey.current = key;
      replaceRows([]);
      freshDeck.current = true;
    }
    const log = logName(models);
    const names = models.map(shortName);
    const pace =
      workers > 1
        ? `${workers} at a time`
        : hostedCount
          ? "hosted at once, this machine one at a time"
          : "one at a time";
    setColumns(names);
    setTableVisible(true);
    setSummaryVisible(false);
    setPanelsVisible(true);
    resetPanelStates(models.length);
    setLogFile({
      text: `saved locally · ${pace}`,
      path: `results/logs/demo/${log.replace(/[^A-Za-z0-9._-]/g, "-")}.jsonl`,
    });
    setVerdict(`Running ${total} more items…`);

    const { done, exhausted } = await runBatchLoop({
      dataset,
      models,
      total,
      workers,
      isLocal,
      requestFields: { log, dataset, mode: runKind, sides: models },
      takeFreshDeck: () => {
        // Only the table's first request may reshuffle the deck, even with several in flight.
        const fresh = freshDeck.current;
        freshDeck.current = false;
        return fresh;
      },
      shouldStop: () => stopRequested.current,
      onProgress: ({ done: finished, inFlight, left }) => {
        const waiting = total - finished - inFlight;
        const running = inFlight ? ` · ${inFlight} running` : "";
        setVerdict(
          `${finished} of ${total} done${running}${waiting > 0 ? ` · ${waiting} waiting` : ""}.`,
        );
        if (left !== null) setRemaining(left + inFlight);
      },
      onRow: (next, sides) => {
        replaceRows([...rowsRef.current, { item: next, sides, isNew: true }]);
        setItem(next);
        // The panels show the latest finished item, as a single run would.
        setPanels(
          sides.map((side) => ({
            status: "done",
            ms: side.ms,
            response: side.response.error ? undefined : side.response,
            footer: side.response.error?.message ?? readoutFooter(side.response),
          })),
        );
        markFastest(sides.map((side) => side.ms));
      },
      onError: toast.show,
    });

    setVerdict(`${done} of ${total} done.${exhausted ? ` Stopped: ${exhausted}.` : ""}`);
    setSummaryVisible(true);
    const allRows = rowsRef.current;
    const recorded = allRows.length ? rowRecording(allRows, allRows.length - 1, names) : null;
    if (recorded) setRecording(recorded);
  }

  async function runGenerateBatch(total: number) {
    generateBatch.current = true;
    replaceRows([]);
    for (let i = 0; i < total && !stopRequested.current; i++) {
      setBatchProgress(` · ${i + 1} of ${total}`);
      const next = i === 0 ? item : await nextItem();
      if (!next || !(await run(next))) break;
    }
    if (rowsRef.current.length) setSummaryVisible(true);
  }

  async function runBatch(all: boolean) {
    const total = all ? (remaining ?? 0) : Math.max(1, Math.floor(Number(batchSize) || 1));
    setBusy(true);
    setBatchRunning(true);
    stopRequested.current = false;
    try {
      if (isCompare) await runCompareBatch(total);
      else await runGenerateBatch(total);
    } catch (error) {
      toast.show(`The batch stopped: ${errorMessage(error)}. Is the demo server still running?`);
    } finally {
      generateBatch.current = false;
      stopRequested.current = true;
      setBatchRunning(false);
      setBatchProgress("");
      setBusy(false);
    }
  }

  /** Rebuilds a saved batch (table, score, summary, replay) without sending any request. */
  async function openSavedRun(name: string) {
    const saved = savedRuns.find((run) => run.name === name);
    if (!saved) return;
    const stored = await fetchRun(name);
    const models = saved.backends;
    const target: Mode = saved.mode === "gen" ? "generate" : "compare";
    if (mode !== target) switchMode(target);
    if (isExampleName(saved.dataset)) {
      setSource("examples");
      setExample(saved.dataset);
      setDataset("");
    } else {
      setSource("dataset");
      setExample("");
      setDataset(saved.dataset);
    }

    const baseId = (id: string) => id.replace(/#text$/, "");
    const known = models.map(baseId).filter((id) => backends[id]);
    if (target === "generate" && known[0]) setGenerateModel(known[0]);
    if (target === "compare" && known.length >= 2) setCompareModels(known);

    const names = models.map((id) => columnName(id, saved.mode));
    const loaded: Row[] = stored.flatMap((row) => {
      const sides = models.map((id) => row.sides[id]).filter((side) => side !== undefined);
      return sides.length === models.length ? [{ item: row.item, sides }] : [];
    });
    batchKey.current = [saved.dataset, ...models].join("|");
    replaceRows(loaded);
    setColumns(names);
    setSavedNames(names);
    setWrittenAsAnswers(target === "generate");
    setRemaining(null);
    setTableVisible(true);
    setLogFile({ text: "loaded from disk", path: `results/logs/demo/${name}.jsonl` });
    setOpenItem(null);
    const lastRow = loaded.at(-1);
    if (lastRow) {
      setItem(lastRow.item);
      setRecording(rowRecording(loaded, loaded.length - 1, names));
    }
    setSummaryVisible(true);
    setPanelsVisible(false);
    setVerdict("Loaded from disk.");
  }

  function replay() {
    if (!recording) return;
    setPanelsVisible(true);
    if (recording.sides && rows.length)
      panelsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setReplaying(true);
    setReplayRow(recording.row ?? null);
    setVerdict(
      recording.row === undefined
        ? "Replaying: every side starts together and stops at its recorded time."
        : `Replaying item ${recording.row + 1}: every model starts together and stops at its recorded time.`,
    );
    const startedAt = now();
    const finish = (ms: number[]) => {
      setReplayRow(null);
      setVerdict(recording.verdict);
      markFastest(ms);
      setReplaying(false);
    };

    if (recording.sides) {
      const { sides } = recording;
      const ms = sides.map((side) => side.ms);
      if (!isCompare) setWrittenAsAnswers(true);
      setPanels(
        sides.map((side) => ({
          ...runningPanel("Scoring every option…", startedAt),
          cap: side.ms,
        })),
      );
      for (const [k, side] of sides.entries()) {
        const done = { ...side, status: "done", startedAt } as const;
        setTimeout(() => updatePanel(k, done), side.ms);
      }
      setTimeout(() => finish(ms), Math.max(...ms));
      return;
    }

    const { written, readout } = recording;
    if (!written || !readout) return;
    setPanels([
      { ...runningPanel("Streaming…", startedAt), cap: written.ms, text: "" },
      { ...runningPanel("Scoring every option…", startedAt), cap: readout.ms },
    ]);
    setTimeout(
      () =>
        updatePanel(1, {
          status: "done",
          startedAt,
          ms: readout.ms,
          response: readout.response,
          footer: readout.footer,
        }),
      readout.ms,
    );
    for (const [at, chunk] of written.chunks) {
      setTimeout(
        () => updatePanel(0, (panel) => ({ ...panel, text: (panel.text ?? "") + chunk })),
        at,
      );
    }
    setTimeout(() => {
      updatePanel(0, (panel) => ({
        ...panel,
        status: "done",
        ms: written.ms,
        footer: written.footer,
      }));
      finish([written.ms, readout.ms]);
    }, written.ms);
  }

  const backendList = Object.values(backends);
  const keyBackend = keyRequest ? backends[keyRequest.backend] : undefined;
  const questionCount = item ? Object.keys(item.truth).length : 0;
  const tableNote = `· ${rows.length} done${remaining !== null && batchRunning ? ` · ${remaining} left in the set` : ""}`;

  return (
    <div className="mx-auto max-w-[1280px] px-6 pt-7 pb-14 max-[600px]:px-4">
      <Header
        mode={mode}
        onModeChange={switchMode}
        preference={theme.preference}
        onPreferenceChange={theme.setPreference}
      />

      {mode === "past" ? (
        <PastRuns
          runs={savedRuns}
          loading={runsLoading}
          page={runsPage}
          kind={runsKind}
          menuOpen={openMenu === "kind"}
          onMenuOpenChange={menuHandler("kind")}
          onKindChange={(kind) => {
            setRunsKind(kind);
            setRunsPage(1);
            setOpenMenu("");
          }}
          onPageChange={setRunsPage}
          onOpenRun={openSavedRun}
          backendLabel={columnName}
        />
      ) : (
        <>
          <div className="rounded-lg border border-rule bg-panel px-4 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                {isCompare ? (
                  <ModelsPicker
                    backends={backendList}
                    selected={compareModels}
                    onToggle={toggleCompareModel}
                    open={openMenu === "models"}
                    onOpenChange={menuHandler("models")}
                  />
                ) : (
                  <ModelPicker
                    backends={backendList}
                    value={generateModel}
                    onPick={pickGenerateModel}
                    open={openMenu === "model"}
                    onOpenChange={menuHandler("model")}
                  />
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={ghostButton}
                  disabled={!recording || replaying || busy}
                  onClick={replay}
                >
                  Replay together
                </button>
                <button
                  type="button"
                  className={solidButton}
                  disabled={busy || replaying}
                  onClick={onRun}
                >
                  Run
                </button>
              </div>
            </div>
            <InputBar
              source={source}
              onSourceChange={chooseSource}
              example={dataset ? "" : example}
              onExampleChange={(name) => {
                setOpenMenu("");
                chooseExample(name);
              }}
              exampleMenuOpen={openMenu === "example"}
              onExampleMenuOpenChange={menuHandler("example")}
              dataset={dataset}
              datasets={datasets}
              onDatasetChange={chooseDataset}
              pickedBackends={(isCompare ? compareModels : [generateModel]).map(
                (id) => backends[id],
              )}
              datasetMenuOpen={openMenu === "dataset"}
              onDatasetMenuOpenChange={menuHandler("dataset")}
              busy={busy}
              remaining={remaining}
              batchSize={batchSize}
              onBatchSizeChange={setBatchSize}
              onNextItem={() => nextItem()}
              onRunBatch={runBatch}
              batchRunning={batchRunning}
              onStop={() => {
                stopRequested.current = true;
                setBatchRunning(false);
              }}
              onEdit={() => setEditing(true)}
            />
            {item && dataset && (
              <p className={cn(labelText, "mt-2.5 mb-0")}>
                {dataset} · {item.source} · {questionCount} question{questionCount > 1 ? "s" : ""}
                {item.options ? `, ${item.options} options` : ""}
                {batchProgress}
              </p>
            )}
          </div>

          <p className="mt-[18px] mb-0 min-h-[26px] text-base text-ink [&_b]:text-good">
            {verdict}
          </p>

          {summaryVisible && <Summary rows={rows} columns={columns} dataset={inputName} />}

          <div ref={panelsRef} hidden={!panelsVisible}>
            {isCompare ? (
              <CompareView
                names={compareNames}
                panels={panels}
                questionIds={questionIds}
                truth={item?.truth}
              />
            ) : (
              <GenerateView
                panels={panels}
                savedNames={savedNames}
                writtenAsAnswers={writtenAsAnswers}
                truth={item?.truth}
              />
            )}
          </div>

          {tableVisible && (
            <BatchTable
              rows={rows}
              columns={columns}
              note={tableNote}
              file={logFile}
              selected={openItem?.index ?? replayRow}
              follow={!!openItem?.open || replayRow !== null}
              onOpen={(index) => showItem(index)}
            />
          )}
        </>
      )}

      {openItem && (
        <ItemDialog
          open={openItem.open}
          index={openItem.index}
          direction={openItem.direction}
          rows={rows}
          columns={columns}
          dataset={inputName}
          onClose={() => setOpenItem((previous) => previous && { ...previous, open: false })}
          onNavigate={(index) => showItem(index, false)}
        />
      )}
      <EditDialog
        open={editing}
        onClose={() => setEditing(false)}
        state={stateText}
        questions={questionsText}
        onStateChange={setStateText}
        onQuestionsChange={setQuestionsText}
      />
      {keyBackend && (
        <KeyDialog backend={keyBackend} onCancel={() => setKeyRequest(null)} onSaved={onKeySaved} />
      )}
      <Toast message={toast.message} onClose={toast.hide} />
    </div>
  );
}
