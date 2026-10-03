import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";

import type { RunContext } from "../../hooks/run/context";
import type { BatchRun } from "../../hooks/run/useBatchRun";
import type { ModelActions } from "../../hooks/run/useModelActions";
import type { Waiting } from "../../hooks/run/usePrepare";
import type { Results } from "../../hooks/run/useResults";
import type { RunInput } from "../../hooks/run/useRunInput";
import type { RunView } from "../../hooks/run/useRunView";
import type { SingleRun } from "../../hooks/run/useSingleRun";
import { cn, ghostButton, inset, labelText, shell } from "../../lib/styles";
import type { Backend } from "../../lib/types";
import { ModelPicker } from "../models/ModelPicker";
import { ModelsPicker } from "../models/ModelsPicker";
import { Icon } from "../ui/Icon";
import { InputBar } from "./InputBar";
import { RunButton } from "./RunButton";
import { RunPanels } from "./RunPanels";

interface RunScreenProps {
  ctx: RunContext;
  view: RunView;
  results: Results;
  input: RunInput;
  models: ModelActions;
  single: SingleRun;
  batch: BatchRun;
  waiting: Waiting | null;
  backendList: Backend[];
}

export function RunScreen(props: RunScreenProps) {
  const { ctx, view, results, input, models, single, batch, waiting, backendList } = props;
  const { backends, datasets, isCompare, compareModels, setCompareModels, generateModel } = ctx;
  const { openMenu, setOpenMenu, menuHandler } = ctx;
  const { recording, busy, replaying, resetPanels } = view;
  const { source, example, dataset, item, remaining, questionCount, setEditing } = input;
  const { chooseSource, chooseExample, chooseDataset, nextItem } = input;
  const { pickGenerateModel, localActions, toggleCompareModel } = models;
  const { batchRunning, batchProgress, batchSize, setBatchSize, noModel } = batch;
  const { runBatch, stopBatch } = batch;

  return (
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
                        results.clearBatch();
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
                onClick={single.replay}
              >
                <Icon icon={ArrowCounterClockwiseIcon} size={14} />
                Replay together
              </button>
              <RunButton busy={busy} replaying={replaying} noModel={noModel} onRun={single.onRun} />
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
            pickedBackends={(isCompare ? compareModels : [generateModel]).map((id) => backends[id])}
            datasetMenuOpen={openMenu === "dataset"}
            onDatasetMenuOpenChange={menuHandler("dataset")}
            busy={busy}
            remaining={remaining}
            batchSize={batchSize}
            onBatchSizeChange={setBatchSize}
            onNextItem={() => nextItem()}
            onRunBatch={runBatch}
            batchRunning={batchRunning}
            onStop={stopBatch}
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

      <RunPanels ctx={ctx} view={view} input={input} waiting={waiting} />
    </>
  );
}
