import { useRef, useState } from "react";

import { runTime } from "../../components/past/PastRuns";
import { errorMessage, fetchRun } from "../../lib/api";
import { isExampleName } from "../../lib/examples";
import { HOSTED_PARALLEL, runBatchLoop } from "../../lib/runner";
import { mergeRuns } from "../../lib/savedRuns";
import { readoutFooter } from "../../lib/scoring";
import type { Item, Mode, Row, RunKind, SavedRun } from "../../lib/types";
import { rowRecording } from "../../lib/verdicts";
import { isString, usePersistentState } from "../usePersistentState";
import type { useSavedRuns } from "../useSavedRuns";
import type { RunContext } from "./context";
import type { Results } from "./useResults";
import type { RunInput } from "./useRunInput";
import type { RunView } from "./useRunView";

/** Batches: many items of a set asked in turn, the table they fill, the item dialog, and saved runs
 * opened from Past runs. */
export function useBatchRun(
  ctx: RunContext,
  view: RunView,
  results: Results,
  input: RunInput,
  prepare: (models: string[]) => Promise<boolean>,
  single: { run: (batchItem?: Item) => Promise<boolean>; logName: (models: string[]) => string },
  savedRuns: ReturnType<typeof useSavedRuns>,
  switchMode: (next: Mode) => void,
) {
  const { backends, compareModels, setCompareModels, generateModel, setGenerateModel, mode } = ctx;
  const { isCompare, isLocal, readsWide, runKind, shortName, columnName, toast } = ctx;
  const { setVerdict, setRecording, setPanels, resetPanelStates, setPanelsVisible, markFastest } =
    view;
  const { setBusy, setSavedNames, setWrittenAsAnswers } = view;
  const { rowsRef, replaceRows, columns, setColumns, setTableVisible, setResultsOpen } = results;
  const { setLogFile, setOpenItem, batchKey, generateBatch } = results;
  const { item, dataset, remaining, setRemaining, showRequest, nextItem } = input;
  const { setSource, setExample, setDataset } = input;
  const { run, logName } = single;
  const [liveBatch, setLiveBatch] = useState<{ startedAt: number; total: number } | null>(null);

  const [batchRunning, setBatchRunning] = useState(false);

  const [batchProgress, setBatchProgress] = useState("");

  const [batchSize, setBatchSize] = usePersistentState("batch-size", "50", isString);

  const freshDeck = useRef(false);

  const stopRequested = useRef(false);
  const noModel = isCompare ? compareModels.length === 0 : !generateModel;

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

  const stopBatch = () => {
    stopRequested.current = true;
    setBatchRunning(false);
  };

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

  return {
    liveBatch,
    batchRunning,
    batchProgress,
    batchSize,
    setBatchSize,
    noModel,
    showItem,
    runBatch,
    stopBatch,
    openSavedRuns,
  };
}

export type BatchRun = ReturnType<typeof useBatchRun>;
