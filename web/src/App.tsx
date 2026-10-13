import { useCallback, useEffect, useRef, useState } from "react";
import { Benchmark } from "./components/benchmark/Benchmark";
import { Credits } from "./components/header/Credits";
import { Header } from "./components/header/Header";
import { AddModelDialog } from "./components/models/AddModelDialog";
import { DownloadBar } from "./components/models/DownloadBar";
import { KeyDialog } from "./components/models/KeyDialog";
import { KeysDialog } from "./components/models/KeysDialog";
import { RunningDialog } from "./components/models/RunningDialog";
import { PastRuns } from "./components/past/PastRuns";
import { BatchResults } from "./components/results/BatchResults";
import { ItemDialog } from "./components/results/ItemDialog";
import { EditDialog } from "./components/run/EditDialog";
import { RunScreen } from "./components/run/RunScreen";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { Toast } from "./components/ui/Toast";
import type { RunContext } from "./hooks/run/context";
import { useBatchRun } from "./hooks/run/useBatchRun";
import { useModelActions } from "./hooks/run/useModelActions";
import { usePrepare } from "./hooks/run/usePrepare";
import { useResults } from "./hooks/run/useResults";
import { useRunInput } from "./hooks/run/useRunInput";
import { useRunView } from "./hooks/run/useRunView";
import { useSingleRun } from "./hooks/run/useSingleRun";
import { useBackends } from "./hooks/useBackends";
import { useConfirm } from "./hooks/useConfirm";
import { useDownloads } from "./hooks/useDownloads";
import { useSavedRuns } from "./hooks/useSavedRuns";
import { useTheme } from "./hooks/useTheme";
import { useToast } from "./hooks/useToast";
import { errorMessage, stopDownload } from "./lib/api";
import { isHosted } from "./lib/backends";
import type { Mode, RunKind } from "./lib/types";

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

  const [runningOpen, setRunningOpen] = useState(false);

  const confirm = useConfirm();

  const [openMenu, setOpenMenu] = useState("");

  const savedRuns = useSavedRuns();

  const isCompare = mode === "compare";

  const onePass = backends[generateModel]?.group === "local";
  const runKind: RunKind = mode === "generate" ? "gen" : "cmp";

  const isLocal = (id: string) => !isHosted(backends[id]);

  // Wide sets ask more than 26 options: letter-reading backends stop at 26, Laya at 100.
  const readsWide = (models: string[]) =>
    models.every((id) => (backends[id]?.max ?? Number.POSITIVE_INFINITY) > 26);

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

  const ctx: RunContext = {
    backends,
    datasets,
    downloads,
    compareModels,
    setCompareModels,
    generateModel,
    setGenerateModel,
    reload,
    markDatasetLocal,
    mode,
    isCompare,
    onePass,
    runKind,
    isLocal,
    readsWide,
    shortName,
    columnName,
    toast,
    confirm,
    setKeysOpen,
    openMenu,
    setOpenMenu,
    menuHandler,
  };
  const view = useRunView(ctx);
  const { closeSavedRun, resetPanels, exampleResults } = view;
  const results = useResults(view);
  const { rows, columns, tableVisible, setTableVisible, resultsOpen } = results;
  const { openItem, setOpenItem, clearBatch } = results;
  const input = useRunInput(ctx, view, results);
  const { setSource, stateText, setStateText, questionsText, setQuestionsText } = input;
  const { editing, setEditing, inputName, chooseDataset } = input;

  async function switchMode(next: Mode) {
    if (next === mode) return;
    const running = batch.batchRunning ? batch.batchMode.current : null;
    const runTab = next === "compare" || next === "generate";
    // Clearing the table would hide a batch that keeps sending, and spending, out of sight.
    if (running && runTab && next !== running) {
      const stop = await confirm.ask(
        "Stop the running batch?",
        "Its answers so far stay in its saved run under Past runs.",
        "Stop and switch",
      );
      if (!stop) return;
      batch.stopBatch();
    }
    setMode(next);
    closeSavedRun();
    setTableVisible(false);
    if (!runTab) {
      savedRuns.refresh();
      return;
    }
    if (next === running) {
      setTableVisible(true);
      return;
    }
    clearBatch();
    exampleResults.current = {};
    resetPanels(next === "compare" ? compareModels.length : 2);
    reload();
  }

  const { waiting, prepare } = usePrepare(ctx, view);
  const models = useModelActions(ctx, view, results, input, switchMode);
  const { addingFor, setAddingFor, setKeyRequest, keyBackend, onKeySaved } = models;
  const { addLocalModel, localActions } = models;
  const single = useSingleRun(ctx, view, results, input, prepare);
  const batch = useBatchRun(ctx, view, results, input, prepare, single, savedRuns, switchMode);
  const { setBatchSize, showItem, openSavedRuns } = batch;

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

  const backendList = Object.values(backends).map((backend) => {
    const got = downloads[backend.id];
    return got
      ? { ...backend, downloading: got.total ? Math.floor((got.done / got.total) * 100) : 0 }
      : backend;
  });

  const runningModels = backendList.filter((backend) => backend.running);

  // Memory a local model needs per GB of weights here, as the server works it out.
  const localModel = backendList.find((backend) => backend.group === "local" && backend.gb);

  const memoryPerGb =
    localModel?.need_gb && localModel.gb ? localModel.need_gb / localModel.gb : undefined;

  return (
    <div className="mx-auto max-w-7xl px-6 pt-7 pb-14 max-[600px]:px-4">
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
          <BatchResults ctx={ctx} view={view} results={results} input={input} batch={batch} />
        ) : (
          <RunScreen
            ctx={ctx}
            view={view}
            results={results}
            input={input}
            models={models}
            single={single}
            batch={batch}
            waiting={waiting}
            backendList={backendList}
          />
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
      <Credits />
    </div>
  );
}
