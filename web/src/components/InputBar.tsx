import { blockingBackend } from "../backends";
import { EXAMPLE_NAMES, type ExampleName } from "../examples";
import { chipButton, cx } from "../styles";
import type { Backend, Dataset } from "../types";
import { Dropdown, MenuHeading, MenuItem } from "./Menu";

export type InputSource = "examples" | "dataset";

const answerShape = (dataset: Dataset) =>
  dataset.options === 2
    ? "yes / no"
    : dataset.options
      ? `pick 1 of ${dataset.options}`
      : "several questions each";

interface InputBarProps {
  source: InputSource;
  onSourceChange: (source: InputSource) => void;
  example: ExampleName | "";
  onExampleChange: (name: ExampleName) => void;
  dataset: string;
  datasets: Dataset[];
  onDatasetChange: (name: string) => void;
  pickedBackends: (Backend | undefined)[];
  datasetMenuOpen: boolean;
  onDatasetMenuOpenChange: (open: boolean) => void;
  busy: boolean;
  remaining: number | null;
  batchSize: string;
  onBatchSizeChange: (value: string) => void;
  onNextItem: () => void;
  onRunBatch: (all: boolean) => void;
  batchRunning: boolean;
  onStop: () => void;
  onEdit: () => void;
}

export function InputBar(props: InputBarProps) {
  const { source, dataset, busy, remaining } = props;
  const setExhausted = remaining === 0;
  const allLabel = remaining === null ? "All" : remaining ? `All ${remaining}` : "All done";

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-rule pt-3.5">
      <div className="mr-2.5 inline-flex rounded-full border border-rule p-0.5">
        {(["examples", "dataset"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => props.onSourceChange(option)}
            className={cx(
              "rounded-full border-0 px-3 py-[3px] text-[13px]",
              source === option ? "bg-code text-ink" : "bg-transparent text-dim",
            )}
          >
            {option === "examples" ? "Examples" : "Dataset"}
          </button>
        ))}
      </div>

      {source === "examples" &&
        EXAMPLE_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className={chipButton(name === props.example)}
            onClick={() => props.onExampleChange(name)}
          >
            {name}
          </button>
        ))}

      {source === "dataset" && (
        <>
          <Dropdown
            compact
            active={!!dataset}
            open={props.datasetMenuOpen}
            onOpenChange={props.onDatasetMenuOpenChange}
            button={dataset || "Choose a set"}
          >
            <MenuHeading>Public datasets</MenuHeading>
            {props.datasets.map((set) => {
              const blocker = blockingBackend(set, props.pickedBackends);
              return (
                <MenuItem
                  key={set.name}
                  label={set.name}
                  title={set.about}
                  selected={set.name === dataset}
                  disabled={!!blocker}
                  onSelect={() => props.onDatasetChange(set.name)}
                  highlightDetail={set.local && !blocker}
                  detail={
                    blocker
                      ? `pick 1 of ${set.options} · ${blocker.label} takes ${blocker.max}`
                      : answerShape(set) + (set.local ? " · on disk" : " · download")
                  }
                />
              );
            })}
          </Dropdown>
          {dataset && (
            <>
              <button
                type="button"
                className={chipButton()}
                disabled={busy}
                onClick={props.onNextItem}
              >
                Next item
              </button>
              <input
                type="number"
                min={1}
                value={props.batchSize}
                onChange={(event) => props.onBatchSizeChange(event.target.value)}
                disabled={busy || setExhausted}
                aria-label="Items in the batch"
                className="ml-2 w-16 rounded-full border border-rule bg-paper px-2 py-1 text-center font-mono text-[13.5px] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-good"
              />
              <button
                type="button"
                className={chipButton()}
                disabled={busy || setExhausted}
                onClick={() => props.onRunBatch(false)}
              >
                Run batch
              </button>
              <button
                type="button"
                className={chipButton()}
                disabled={busy || setExhausted}
                onClick={() => props.onRunBatch(true)}
              >
                {allLabel}
              </button>
              {props.batchRunning && (
                <button type="button" className={chipButton()} onClick={props.onStop}>
                  Stop
                </button>
              )}
            </>
          )}
        </>
      )}

      <button type="button" className={cx(chipButton(), "ml-auto")} onClick={props.onEdit}>
        Edit input
      </button>
    </div>
  );
}
