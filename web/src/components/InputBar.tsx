import { EXAMPLE_NAMES, EXAMPLES, type ExampleName } from "../examples";
import { chipButton, cn, numberInput } from "../styles";
import type { Backend, Dataset } from "../types";
import { DatasetMenu } from "./DatasetMenu";
import { Dropdown, MenuHeading, MenuItem } from "./Menu";

export type InputSource = "examples" | "dataset";

interface InputBarProps {
  source: InputSource;
  onSourceChange: (source: InputSource) => void;
  example: ExampleName | "";
  onExampleChange: (name: ExampleName) => void;
  exampleMenuOpen: boolean;
  onExampleMenuOpenChange: (open: boolean) => void;
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
            className={cn(
              "rounded-full border-0 px-3 py-[3px] text-[13px]",
              source === option ? "bg-lift text-ink" : "bg-transparent text-dim",
            )}
          >
            {option === "examples" ? "Examples" : "Dataset"}
          </button>
        ))}
      </div>

      {source === "examples" && (
        <Dropdown
          compact
          active={!!props.example}
          open={props.exampleMenuOpen}
          onOpenChange={props.onExampleMenuOpenChange}
          button={props.example || "Choose an example"}
        >
          <MenuHeading>Built-in examples</MenuHeading>
          {EXAMPLE_NAMES.map((name) => (
            <MenuItem
              key={name}
              label={name}
              detail={`${Object.keys(EXAMPLES[name].questions).length} questions`}
              selected={name === props.example}
              onSelect={() => props.onExampleChange(name)}
            />
          ))}
        </Dropdown>
      )}

      {source === "dataset" && (
        <>
          <DatasetMenu
            datasets={props.datasets}
            value={dataset}
            onChange={props.onDatasetChange}
            pickedBackends={props.pickedBackends}
            open={props.datasetMenuOpen}
            onOpenChange={props.onDatasetMenuOpenChange}
          />
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
                className={cn(numberInput, "ml-2")}
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

      <button type="button" className={cn(chipButton(), "ml-auto")} onClick={props.onEdit}>
        Edit input
      </button>
    </div>
  );
}
