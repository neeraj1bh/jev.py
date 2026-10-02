import { ArrowCounterClockwise, CircleNotch, Columns, Play } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Benchmark } from "./components/benchmark/Benchmark";
import { Header } from "./components/header/Header";
import { AddModelDialog } from "./components/models/AddModelDialog";
import { DownloadBar } from "./components/models/DownloadBar";
import { KeyDialog } from "./components/models/KeyDialog";
import { KeysDialog } from "./components/models/KeysDialog";
import type { LocalModelActions } from "./components/models/ModelMenu";
import { ModelPicker } from "./components/models/ModelPicker";
import { MAX_COMPARE, ModelsPicker } from "./components/models/ModelsPicker";
import { RunningDialog } from "./components/models/RunningDialog";
import { PastRuns, runTime } from "./components/past/PastRuns";
import { GenerateReplay } from "./components/results/GenerateReplay";
import { ItemDialog } from "./components/results/ItemDialog";
import { ResultsView } from "./components/results/ResultsView";
import { EditDialog } from "./components/run/EditDialog";
import { InputBar, type InputSource } from "./components/run/InputBar";
import { RaceClocks } from "./components/run/RaceClocks";
import { CompareView, GenerateView } from "./components/run/ResultPanels";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { EmptyState } from "./components/ui/EmptyState";
import { FluxLoader } from "./components/ui/FluxLoader";
import { Icon } from "./components/ui/Icon";
import { Tip } from "./components/ui/Tip";
import { Toast } from "./components/ui/Toast";
import { useBackends } from "./hooks/useBackends";
import { useBatchReplay } from "./hooks/useBatchReplay";
import { useConfirm } from "./hooks/useConfirm";
import { useDownloads } from "./hooks/useDownloads";
import { idlePanel, runningPanel, usePanels } from "./hooks/usePanels";
import { isString, usePersistentState } from "./hooks/usePersistentState";
import { useSavedRuns } from "./hooks/useSavedRuns";
import { useTheme } from "./hooks/useTheme";
import { useToast } from "./hooks/useToast";
import {
  addModel,
  deleteModel,
  downloadModel,
  fetchRun,
  loadModel,
  sampleItem,
  stopDownload,
  stopModel,
} from "./lib/api";
import { ggufOverBudget, isHosted } from "./lib/backends";
import { EXAMPLES, type ExampleName, isExampleName } from "./lib/examples";
import { makerIcons } from "./lib/logos";
import { now, runBatchLoop, runEach, timedGenerate, timedReadout } from "./lib/runner";
import { mergeRuns } from "./lib/savedRuns";
import { readoutFooter, writtenAnswers } from "./lib/scoring";
import { cn, ghostButton, inset, labelText, shell, solidButton } from "./lib/styles";
import type {
  Backend,
  Item,
  Mode,
  Question,
  Recording,
  Request,
  Row,
  RunKind,
  SavedRun,
} from "./lib/types";
import { compareVerdict, generateVerdict, rowRecording } from "./lib/verdicts";

const CREDITS = ["neerxjbhatt", "essdecay"];

const FIRST_EXAMPLE: ExampleName = "Support ticket";
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
  const [keysOpen, setKeysOpen] = useState(false);
  const downloads = useDownloads();
  // A download that ends, here or in another tab, changes what is on disk: refetch the menu.
  const wasDownloading = useRef("");
  useEffect(() => {
    const now = Object.keys(downloads).sort().join();
    if (now !== wasDownloading.current && wasDownloading.current) reload();
    wasDownloading.current = now;
  }, [downloads, reload]);
  const [addingFor, setAddingFor] = useState<"generate" | "compare" | "benchmark" | null>(null);
  const [runningOpen, setRunningOpen] = useState(false);
  const confirm = useConfirm();
  const fetchAgreed = useRef(new Set<string>()); // frozen benchmarks the viewer agreed to download
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
  const [resultsOpen, setResultsOpen] = useState(false);
  const [liveBatch, setLiveBatch] = useState<{ startedAt: number; total: number } | null>(null);
  const [logFile, setLogFile] = useState({ text: "", path: "" });
  const [recording, setRecording] = useState<Recording | null>(null);
  const [busy, setBusy] = useState(false);
  // The step a run is waiting on before its first request, and the downloads that measure it.
  const [waiting, setWaiting] = useState<{ label: string; downloads: string[] } | null>(null);
  // Models loaded from this page already; loading them again is quick and needs no loader.
  const loaded = useRef(new Set<string>());
  const [replaying, setReplaying] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");
  const [batchSize, setBatchSize] = usePersistentState("batch-size", "50", isString);
  const [editing, setEditing] = useState(false);
  const [keyRequest, setKeyRequest] = useState<{
    backend: string;
    forCompare: boolean;
    /** The model to add once the key works, when it differs from the keyed backend. */
    add?: string;
  } | null>(null);
  const [openItem, setOpenItem] = useState<{
    index: number;
    direction: "" | "forward" | "back";
    open: boolean;
  } | null>(null);
  const [openMenu, setOpenMenu] = useState("");
  const savedRuns = useSavedRuns();

  const rowsRef = useRef<Row[]>([]);
  const batchKey = useRef("");
  const freshDeck = useRef(false);
  const stopRequested = useRef(false);
  const generateBatch = useRef(false);
  const logSession = useRef({ key: "", name: "" });
  const exampleResults = useRef<Record<string, Recording>>({});
  const panelsRef = useRef<HTMLDivElement>(null);
  const batchReplay = useBatchReplay(rows);

  const isCompare = mode === "compare";
  const onePass = backends[generateModel]?.group === "local";
  const runKind: RunKind = mode === "generate" ? "gen" : "cmp";
  const compareNames = savedNames ?? compareModels.map((id) => backends[id]?.label ?? id);
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
  const isLocal = (id: string) => !isHosted(backends[id]);
  // Letter-reading backends stop at 26 options; the rest read any number.
  const readsWide = (models: string[]) => models.every((id) => !backends[id]?.max);

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

  /** The item on screen and the input that Run sends must be the same item. */
  const showRequest = (next: Item) => {
    setItem(next);
    fillEditors(next);
  };

  const resetPanels = (count = isCompare ? compareNames.length : 2) => {
    resetPanelStates(count);
    setPanelsVisible(true);
    setVerdict("Run to compare.");
    setRecording(null);
  };

  const closeSavedRun = () => {
    setSavedNames(null);
    setWrittenAsAnswers(false);
  };

  /** A new input, model or tab: the table, summary and any open saved run no longer apply. */
  const clearBatch = () => {
    batchReplay.stop();
    setResultsOpen(false);
    replaceRows([]);
    batchKey.current = "";
    setRecording(null);
    setTableVisible(false);
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
    if (next === "past" || next === "benchmark") {
      savedRuns.refresh();
      return;
    }
    clearBatch();
    exampleResults.current = {};
    resetPanels(next === "compare" ? compareModels.length : 2);
    reload();
  }

  /** Loads a benchmark into Compare; the run itself waits for Run batch, so nothing is spent here. */
  async function setUpBenchmark(models: string[], name: string, items: number) {
    setCompareModels(models);
    setBatchSize(String(items));
    switchMode("compare");
    setSource("dataset");
    await chooseDataset(name);
    const keyless = models.some((id) => !backends[id]?.ready && backends[id]?.group !== "local");
    if (keyless) setKeysOpen(true);
    toast.show(
      keyless
        ? `${models.length} models set up on ${name}. Add your OpenRouter key, then press Run batch.`
        : `${models.length} models set up on ${name}. Press Run batch to start.`,
    );
  }

  function askForKey(backend: string, forCompare: boolean, add?: string) {
    setOpenMenu("");
    setKeyRequest({ backend, forCompare, add });
  }

  async function onKeySaved(keyed: string) {
    const forCompare = keyRequest?.forCompare ?? true;
    const backend = keyRequest?.add ?? keyed;
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

  /** A local model picked before it is on disk starts downloading right away, not at the first run. */
  async function downloadIfMissing(backend: Backend) {
    if (backend.group !== "local" || backend.ready || downloads[backend.id]) return;
    const ok = await confirm.ask(
      `Download ${backend.label}?`,
      `About ${backend.gb?.toFixed(1) ?? "?"} GB, saved to ${backend.path?.replace(/models--.*$/, "") ?? "models/"} and used from there next time.`,
      "Download",
    );
    if (!ok) return;
    downloadModel(backend.id)
      .then(() => toast.show(`${backend.label} is downloaded.`))
      .catch((error) => toast.show(errorMessage(error)))
      .finally(reload);
  }

  function pickGenerateModel(id: string) {
    setOpenMenu("");
    const backend = backends[id];
    if (!backend) return;
    // A local model that is not on disk yet downloads when it first runs; only hosted ones need a key.
    if (!backend.ready && backend.group !== "local") {
      if (backend.group === "gateway") askForKey("remote:openrouter", false, id);
      else askForKey(id, false);
      return;
    }
    downloadIfMissing(backend);
    setGenerateModel(id);
    clearBatch();
    exampleResults.current = {};
    resetPanels();
    warnIfTooManyOptions([id]);
  }

  /** Adds a Hugging Face model and picks it where the dialog was opened from. */
  async function addLocalModel(id: string) {
    await addModel(id);
    const added = (await reload()).find((backend) => backend.id === id);
    if (added) downloadIfMissing(added); // not awaited: the dialog closes, then the download asks
    if (addingFor === "generate") {
      setGenerateModel(id);
      clearBatch();
      exampleResults.current = {};
      resetPanels();
    } else if (addingFor === "compare" && compareModels.length < MAX_COMPARE) {
      const next = [...compareModels, id];
      setCompareModels(next);
      clearBatch();
      resetPanels(next.length);
    }
  }

  async function deleteLocalModel(backend: Backend) {
    setOpenMenu("");
    const shared = backend.path?.includes(`${"/"}.cache${"/"}huggingface`)
      ? " It is in the shared Hugging Face cache, so other tools lose it too."
      : "";
    const ok = await confirm.ask(
      `Delete ${backend.label}?`,
      `This removes about ${backend.gb ?? "?"} GB from ${backend.path}.${shared} It downloads again if you pick it later.`,
      "Delete",
    );
    if (!ok) return;
    try {
      const { freed } = await deleteModel(backend.id);
      toast.show(`Deleted ${backend.label}, ${(freed / 1e9).toFixed(1)} GB freed.`);
    } catch (error) {
      toast.show(errorMessage(error));
    }
    await reload();
  }

  const localActions = (target: "generate" | "compare" | "benchmark"): LocalModelActions => ({
    onAddModel: () => {
      setOpenMenu("");
      setAddingFor(target);
    },
    onDelete: deleteLocalModel,
    onStop: async (backend) => {
      await stopModel(backend.id).catch((error) => toast.show(errorMessage(error)));
      await reload();
    },
  });

  function toggleCompareModel(id: string) {
    const backend = backends[id];
    if (!backend) return;
    const adding = !compareModels.includes(id);
    if (adding && !backend.ready && backend.group === "hosted") {
      askForKey(id, true);
      return;
    }
    if (adding && !backend.ready && backend.group === "gateway") {
      askForKey("remote:openrouter", true, id);
      return;
    }
    if (adding) downloadIfMissing(backend);
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

  /** Downloads the local models that are not on disk yet, all at once after one question,
   * then loads each model, so timing starts warm. */
  async function prepare(models: string[]) {
    const picked = models
      .map((id) => backends[id])
      .filter((backend): backend is Backend => !!backend);
    if (!picked.length || picked.length !== models.length) {
      setVerdict("Pick a model first.");
      return false;
    }
    const tooBig = ggufOverBudget(picked);
    if (tooBig) {
      setVerdict(tooBig);
      toast.show(tooBig);
      return false;
    }
    const missing = picked.filter((backend) => backend.group === "local" && !backend.ready);
    if (missing.length && !(await confirmDownloads(missing))) return false;
    // A download changes what is on disk; a GGUF model starts llama-server, shown in the header.
    const refresh = missing.length > 0 || picked.some((backend) => backend.group === "gguf");
    try {
      await Promise.all(missing.map((backend) => loadModel(backend.id)));
      for (const backend of picked) await warmUp(backend);
    } catch (error) {
      setVerdict(errorMessage(error));
      toast.show(errorMessage(error));
      if (refresh) await reload();
      return false;
    } finally {
      setWaiting(null);
    }
    if (refresh) await reload();
    return true;
  }

  async function confirmDownloads(missing: Backend[]) {
    const gb = missing.reduce((sum, backend) => sum + (backend.gb ?? 0), 0);
    const names = missing.map((backend) => backend.label).join(", ");
    const ok = await confirm.ask(
      missing.length === 1 ? `Download ${names}?` : `Download ${missing.length} models?`,
      `${missing.length === 1 ? "" : `${names}. `}About ${gb.toFixed(1)} GB, saved to ${missing[0]?.path?.replace(/models--.*$/, "") ?? "models/"} and used from there next time.`,
      "Download",
    );
    if (ok) {
      setVerdict(`Downloading ${names}. First time only; this can take minutes.`);
      setWaiting({ label: "downloading", downloads: missing.map((backend) => backend.id) });
    }
    return ok;
  }

  /** Loads one picked model before its timed run, with a loader the first time. */
  async function warmUp(backend: Backend) {
    const cold = !backend.running && !loaded.current.has(backend.id);
    if (backend.group === "local") {
      setVerdict(`Loading ${backend.label}…`);
      if (cold) setWaiting({ label: "loading the model", downloads: [] });
    }
    if (backend.group === "gguf") {
      setVerdict(`Starting llama-server with ${backend.label}…`);
      if (cold) setWaiting({ label: "starting llama.cpp", downloads: [] });
    }
    const { stopped } = await loadModel(backend.id);
    loaded.current.add(backend.id);
    if (stopped?.length) toast.show(`Stopped ${stopped.join(", ")} to make room.`);
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
    set: current?.set,
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

  type RunBody = Request & ReturnType<typeof logFields>;

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
    if (!(await prepare(models))) return false;

    const body = { ...request, ...logFields(models, current) };
    setVerdict("Running…");
    setRecording(null);
    setPanelsVisible(true);
    resetPanelStates(isCompare ? models.length : 2);
    return isCompare ? runCompare(models, body) : runGenerate(body, request, current);
  }

  async function runCompare(models: string[], body: RunBody) {
    const sides = await runEach(models, isLocal, (id, i) =>
      readoutInto(i, { ...body, backend: id }),
    );
    const failed = sides.filter((side) => side.failed).length;
    if (failed > 0) {
      setVerdict(
        `${failed === 1 ? "One model" : `${failed} models`} failed; the reason is below the table.`,
      );
      return false;
    }
    const sentence = compareVerdict(models.map(shortName), sides);
    setVerdict(sentence);
    markFastest(sides.map((side) => side.ms));
    setRecording({ sides, verdict: sentence });
    return true;
  }

  async function runGenerate(body: RunBody, request: Request, current: Item | null) {
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
    showRequest(allRows[index].item);
    const recorded = rowRecording(allRows, index, columns);
    if (recorded) setRecording(recorded);
  }

  async function runCompareBatch(total: number) {
    const models = compareModels.slice();
    if (!(await prepare(models))) return;
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
    setResultsOpen(true);
    setPanelsVisible(true);
    resetPanelStates(models.length);
    setLogFile({
      text: `saved locally · ${pace}`,
      path: `results/logs/demo/${log.replace(/[^A-Za-z0-9._-]/g, "-")}.jsonl`,
    });
    setVerdict(`Running ${total} more items…`);

    const { done, exhausted } = await runBatchLoop({
      dataset,
      wide: readsWide(models),
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
      onRow: (next, sides, startedAt) => {
        replaceRows([
          ...rowsRef.current,
          { item: next, sides, isNew: true, start: startedAt, at: Date.now() },
        ]);
        showRequest(next);
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
    const allRows = rowsRef.current;
    const recorded = allRows.length ? rowRecording(allRows, allRows.length - 1, names) : null;
    if (recorded) setRecording(recorded);
  }

  async function runGenerateBatch(total: number) {
    generateBatch.current = true;
    replaceRows([]);
    setResultsOpen(true);
    for (let i = 0; i < total && !stopRequested.current; i++) {
      setBatchProgress(` · ${i + 1} of ${total}`);
      const next = i === 0 ? item : await nextItem();
      if (!next || !(await run(next))) break;
    }
  }

  async function runBatch(all: boolean) {
    if (noModel) {
      toast.show("Pick a model first.");
      return;
    }
    const total = all ? (remaining ?? 0) : Math.max(1, Math.floor(Number(batchSize) || 1));
    setBusy(true);
    setBatchRunning(true);
    setLiveBatch({ startedAt: performance.now(), total });
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

  /**
   * Rebuilds saved batches (table, score, summary, replay) without sending any request. Several
   * runs on one input open as one compare over the items they all have.
   */
  async function openSavedRuns(picked: string[]) {
    const chosen = savedRuns.runs.filter((run) => picked.includes(run.name));
    const first = chosen[0];
    if (!first) return;
    const name = chosen.map((run) => run.name).join(" + ");
    const kind: RunKind = chosen.length === 1 ? first.mode : "cmp";
    const everyRun = await Promise.all(chosen.map((run) => fetchRun(run.name)));
    const { columns: columnsOf, rows: stored } = mergeRuns(chosen, everyRun);
    const complete = (row: (typeof stored)[number]) =>
      columnsOf.every((column) => row.sides[column.id]);
    if (chosen.length > 1 && !stored.some(complete)) {
      toast.show("These runs have no item in common, so there is nothing to compare.");
      return;
    }
    const saved: SavedRun = { ...first, name, mode: kind, backends: columnsOf.map((c) => c.id) };
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

    const baseId = (id: string) => id.replace(/@.*$/, "").replace(/#text$/, "");
    const known = models.map(baseId).filter((id) => backends[id]);
    if (target === "generate" && known[0]) setGenerateModel(known[0]);
    if (target === "compare" && known.length) setCompareModels(known);

    const names = columnsOf.map(({ run, backend, id }) =>
      id === backend
        ? columnName(backend, chosen.length === 1 ? run.mode : undefined)
        : `${columnName(backend, run.mode)} · ${runTime(run.name)}`,
    );
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
    setResultsOpen(true);
    setLogFile({
      text: "loaded from disk",
      path: chosen.map((run) => `results/logs/demo/${run.name}.jsonl`).join(" + "),
    });
    setOpenItem(null);
    const lastRow = loaded.at(-1);
    if (lastRow) {
      showRequest(lastRow.item);
      setRecording(rowRecording(loaded, loaded.length - 1, names));
    }
    setPanelsVisible(false);
    setVerdict("Loaded from disk.");
  }

  function replay() {
    if (!recording) return;
    setPanelsVisible(true);
    if (recording.sides && rows.length)
      panelsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setReplaying(true);
    setVerdict(
      recording.row === undefined
        ? "Replaying: every side starts together and stops at its recorded time."
        : `Replaying item ${recording.row + 1}: every model starts together and stops at its recorded time.`,
    );
    const startedAt = now();
    const finish = (ms: number[]) => {
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

  const backendList = Object.values(backends).map((backend) => {
    const got = downloads[backend.id];
    return got
      ? { ...backend, downloading: got.total ? Math.floor((got.done / got.total) * 100) : 0 }
      : backend;
  });
  const noModel = isCompare ? compareModels.length === 0 : !generateModel;
  const waitingOn = (waiting?.downloads ?? []).flatMap((id) => downloads[id] ?? []);
  const waitingTotal = waitingOn.reduce((sum, part) => sum + part.total, 0);
  const waitingShare = waitingTotal
    ? waitingOn.reduce((sum, part) => sum + part.done, 0) / waitingTotal
    : undefined;
  const runningModels = backendList.filter((backend) => backend.running);
  // Memory a local model needs per GB of weights here, as the server works it out.
  const localModel = backendList.find((backend) => backend.group === "local" && backend.gb);
  const memoryPerGb =
    localModel?.need_gb && localModel.gb ? localModel.need_gb / localModel.gb : undefined;
  const keyBackend = keyRequest ? backends[keyRequest.backend] : undefined;
  const questionCount = item ? Object.keys(item.truth).length : 0;
  const tableNote = `· ${batchReplay.visibleRows.length} done${remaining !== null && batchRunning ? ` · ${remaining} left in the set` : ""}`;

  return (
    <div className="mx-auto max-w-[1280px] px-6 pt-7 pb-14 max-[600px]:px-4">
      <Header
        running={{
          labels: runningModels.map((backend) => backend.label),
          onOpen: () => setRunningOpen(true),
        }}
        mode={mode}
        onModeChange={switchMode}
        preference={theme.preference}
        onPreferenceChange={theme.setPreference}
        onOpenKeys={() => setKeysOpen(true)}
      />
      <KeysDialog open={keysOpen} onClose={() => setKeysOpen(false)} onChanged={reload} />
      <ConfirmDialog request={confirm.request} />
      <DownloadBar
        progress={downloads}
        label={(key) => backends[key]?.label ?? key}
        onStop={(key) => stopDownload(key).catch((error) => toast.show(errorMessage(error)))}
      />
      <RunningDialog
        open={runningOpen}
        models={runningModels}
        onClose={() => setRunningOpen(false)}
        onStop={(backend) => {
          if (runningModels.length <= 1) setRunningOpen(false);
          localActions("compare").onStop(backend);
        }}
      />
      <AddModelDialog
        open={addingFor !== null}
        listed={new Set(Object.keys(backends))}
        memoryPerGb={memoryPerGb}
        memoryGb={localModel?.have_gb}
        onClose={() => setAddingFor(null)}
        onAdd={addLocalModel}
        onFoldersChanged={reload}
      />

      <div key={mode} className="animate-fade motion-reduce:animate-none">
        {mode === "benchmark" ? (
          <Benchmark
            backends={backendList}
            datasets={datasets}
            runs={savedRuns.runs}
            backendLabel={columnName}
            onSetUp={setUpBenchmark}
            local={localActions("benchmark")}
          />
        ) : mode === "past" ? (
          <PastRuns
            runs={savedRuns.runs}
            loading={savedRuns.loading}
            page={savedRuns.page}
            kind={savedRuns.kind}
            menuOpen={openMenu === "kind"}
            onMenuOpenChange={menuHandler("kind")}
            onKindChange={(kind) => {
              savedRuns.setKind(kind);
              savedRuns.setPage(1);
              setOpenMenu("");
            }}
            onPageChange={savedRuns.setPage}
            onOpenRun={(name) => openSavedRuns([name])}
            onCompareRuns={openSavedRuns}
            backendLabel={columnName}
          />
        ) : resultsOpen && tableVisible ? (
          <ResultsView
            scoreboard={
              batchReplay.replaying
                ? {
                    startedAt: batchReplay.startedAt,
                    total: rows.length,
                    pace: batchReplay.pace,
                    label: `Replaying ${inputName} at ${Math.round(batchReplay.pace)}×`,
                  }
                : liveBatch && batchRunning
                  ? { ...liveBatch, pace: 1, label: `Running ${inputName}` }
                  : null
            }
            stage={
              isCompare ? undefined : batchReplay.replaying ? (
                <GenerateReplay
                  rows={rows}
                  startedAt={batchReplay.startedAt}
                  pace={batchReplay.pace}
                  onePass={onePass}
                />
              ) : batchRunning ? (
                <GenerateView
                  panels={panels}
                  savedNames={null}
                  writtenAsAnswers={writtenAsAnswers}
                  onePass={onePass}
                  truth={labels}
                />
              ) : undefined
            }
            dataset={inputName}
            priceOf={(column) =>
              Object.values(backends).find((backend) => columnName(backend.id) === column)
            }
            rows={batchReplay.visibleRows}
            columns={columns}
            note={tableNote}
            file={logFile}
            selected={
              batchReplay.replaying ? batchReplay.visibleRows.length - 1 : (openItem?.index ?? null)
            }
            follow={batchReplay.replaying || !!openItem?.open}
            running={batchRunning}
            replaying={batchReplay.replaying}
            speed={batchReplay.speed}
            onSpeedChange={batchReplay.setSpeed}
            onReplay={() =>
              batchReplay.play(
                isCompare && compareModels.every((id) => isHosted(backends[id]))
                  ? HOSTED_PARALLEL
                  : 1,
              )
            }
            onStopReplay={batchReplay.stop}
            onStopBatch={() => {
              stopRequested.current = true;
              setBatchRunning(false);
            }}
            onOpenRow={(index) => showItem(index)}
            onBack={() => {
              batchReplay.stop();
              setResultsOpen(false);
              setPanelsVisible(true);
              closeSavedRun();
              resetPanels();
            }}
          />
        ) : (
          <>
            <div className={shell}>
              <div className={cn(inset, "px-4 py-3.5")}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    {isCompare ? (
                      <>
                        <ModelsPicker
                          backends={backendList}
                          selected={compareModels}
                          onToggle={toggleCompareModel}
                          local={localActions("compare")}
                          open={openMenu === "models"}
                          onOpenChange={menuHandler("models")}
                        />
                        {compareModels.length > 0 && (
                          <button
                            type="button"
                            className="border-0 bg-transparent px-1.5 py-1 text-[13px] text-dim hover:text-ink"
                            onClick={() => {
                              setCompareModels([]);
                              clearBatch();
                              resetPanels(0);
                            }}
                          >
                            Clear
                          </button>
                        )}
                      </>
                    ) : (
                      <ModelPicker
                        backends={backendList}
                        value={generateModel}
                        onPick={pickGenerateModel}
                        local={localActions("generate")}
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
                      <Icon icon={ArrowCounterClockwise} size={14} />
                      Replay together
                    </button>
                    <Tip content={noModel ? "Pick a model first" : undefined}>
                      <button
                        type="button"
                        className={cn(solidButton, "min-w-[104px] overflow-hidden")}
                        disabled={busy || replaying || noModel}
                        onClick={onRun}
                      >
                        {/* The label changes in place, so the button says what it is doing. */}
                        <AnimatePresence mode="popLayout" initial={false}>
                          <motion.span
                            key={busy ? "running" : "run"}
                            className="inline-flex items-center gap-1.5"
                            initial={{ y: 12, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: -12, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 500, damping: 36 }}
                          >
                            <Icon
                              icon={busy ? CircleNotch : Play}
                              size={14}
                              className={busy ? "animate-spin" : undefined}
                            />
                            {busy ? "Running…" : "Run"}
                          </motion.span>
                        </AnimatePresence>
                      </button>
                    </Tip>
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
                    {dataset} · {item.source} · {questionCount} question
                    {questionCount > 1 ? "s" : ""}
                    {item.options ? `, ${item.options} options` : ""}
                    {batchProgress}
                  </p>
                )}
              </div>
            </div>

            {waiting && <FluxLoader label={waiting.label} share={waitingShare} />}
            <p
              className={cn(
                "mt-[18px] mb-0 min-h-[26px] text-sm text-ink [&_b]:font-semibold [&_b]:text-good",
                waiting && "text-center text-dim",
              )}
            >
              {verdict}
            </p>

            <div ref={panelsRef} hidden={!panelsVisible}>
              {isCompare && panels.some((panel) => panel.status !== "idle") && (
                <RaceClocks names={compareNames} panels={panels} />
              )}
              {isCompare && compareModels.length === 0 ? (
                <div className={shell}>
                  <div className={cn(inset, "overflow-hidden")}>
                    <EmptyState
                      icon={Columns}
                      around={makerIcons}
                      title="Pick models to compare"
                      action={{ label: "Choose models", onClick: () => setOpenMenu("models") }}
                    >
                      Compare sends the same questions to every model you pick and lines up their
                      answers, probabilities and times.
                    </EmptyState>
                  </div>
                </div>
              ) : isCompare ? (
                <CompareView
                  names={compareNames}
                  panels={panels}
                  questionIds={questionIds}
                  asked={asked}
                  truth={labels}
                />
              ) : (
                <GenerateView
                  panels={panels}
                  savedNames={savedNames}
                  writtenAsAnswers={writtenAsAnswers}
                  onePass={onePass}
                  truth={labels}
                />
              )}
            </div>
          </>
        )}
      </div>

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
        onStateChange={(text) => {
          setStateText(text);
          resetPanels();
        }}
        onQuestionsChange={(text) => {
          setQuestionsText(text);
          resetPanels();
        }}
      />
      {keyBackend && (
        <KeyDialog
          target={keyBackend.id}
          label={`${keyBackend.label} API key`}
          hint={keyBackend.key ?? "API key"}
          subtitle="Needed for this model; checked with one small request first"
          onCancel={() => setKeyRequest(null)}
          onSaved={() => onKeySaved(keyBackend.id)}
        />
      )}
      <Toast message={toast.message} onClose={toast.hide} />
      <footer className="mt-14 flex items-center justify-center gap-2 text-[13px] text-dim">
        by
        {CREDITS.map((handle, index) => [
          index > 0 && "and",
          <a
            key={handle}
            href={`https://x.com/${handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-rule px-2.5 py-0.5 text-dim no-underline transition-colors hover:border-dim hover:text-ink"
          >
            @{handle}
          </a>,
        ])}
      </footer>
    </div>
  );
}
