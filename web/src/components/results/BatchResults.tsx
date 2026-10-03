import type { RunContext } from "../../hooks/run/context";
import type { BatchRun } from "../../hooks/run/useBatchRun";
import type { Results } from "../../hooks/run/useResults";
import type { RunInput } from "../../hooks/run/useRunInput";
import type { RunView } from "../../hooks/run/useRunView";
import { isHosted } from "../../lib/backends";
import { HOSTED_PARALLEL } from "../../lib/runner";
import { GenerateView } from "../run/ResultPanels";
import { GenerateReplay } from "./GenerateReplay";
import { ResultsView } from "./ResultsView";

interface BatchResultsProps {
  ctx: RunContext;
  view: RunView;
  results: Results;
  input: RunInput;
  batch: BatchRun;
}

export function BatchResults({ ctx, view, results, input, batch }: BatchResultsProps) {
  const { backends, compareModels, isCompare, onePass, columnName } = ctx;
  const { panels, writtenAsAnswers, setPanelsVisible, closeSavedRun, resetPanels } = view;
  const { rows, columns, logFile, openItem, setResultsOpen, batchReplay } = results;
  const { inputName, labels, remaining } = input;
  const { liveBatch, batchRunning, showItem, stopBatch } = batch;

  const tableNote = `· ${batchReplay.visibleRows.length} done${remaining !== null && batchRunning ? ` · ${remaining} left in the set` : ""}`;

  return (
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
          isCompare && compareModels.every((id) => isHosted(backends[id])) ? HOSTED_PARALLEL : 1,
        )
      }
      onStopReplay={batchReplay.stop}
      onStopBatch={stopBatch}
      onOpenRow={(index) => showItem(index)}
      onBack={() => {
        batchReplay.stop();
        setResultsOpen(false);
        setPanelsVisible(true);
        closeSavedRun();
        resetPanels();
      }}
    />
  );
}
