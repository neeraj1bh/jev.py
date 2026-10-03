import { useRef } from "react";

import { errorMessage } from "../../lib/api";
import { isHosted } from "../../lib/backends";
import { now, runEach, timedGenerate, timedReadout } from "../../lib/runner";
import { writtenAnswers } from "../../lib/scoring";
import type { Item, Recording, Request } from "../../lib/types";
import { compareVerdict, generateVerdict } from "../../lib/verdicts";
import { idlePanel, runningPanel } from "../usePanels";
import type { RunContext } from "./context";
import type { Results } from "./useResults";
import type { RunInput } from "./useRunInput";
import type { RunView } from "./useRunView";

const logTimestamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

/** One run on the screen's input: every picked model read side by side, or one model asked to write
 * its answers and to read them; and Replay, which plays the last run back. */
export function useSingleRun(
  ctx: RunContext,
  view: RunView,
  results: Results,
  input: RunInput,
  prepare: (models: string[]) => Promise<boolean>,
) {
  const { backends, compareModels, generateModel, isCompare, runKind, isLocal, shortName } = ctx;
  const { columnName, toast } = ctx;
  const { setVerdict, recording, setRecording, setPanelsVisible, setPanels } = view;
  const { resetPanelStates, updatePanel, markFastest, closeSavedRun, setBusy, setReplaying } = view;
  const { setWrittenAsAnswers, exampleResults, panelsRef } = view;
  const { rows, rowsRef, replaceRows, setColumns, setTableVisible, setLogFile, generateBatch } =
    results;
  const { item, stateText, questionsText, example, inputName } = input;
  const logSession = useRef({ key: "", name: "" });

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

  return {
    run,
    onRun,
    replay,
    logName,
  };
}
