import {
  ArrowRightIcon,
  ChatTextIcon,
  PencilSimpleIcon,
  QueueIcon,
  StackIcon,
  StopIcon,
} from "@phosphor-icons/react";
import { EXAMPLE_NAMES, EXAMPLES, type ExampleName } from "../../lib/examples";
import { chipButton, cn, numberInput } from "../../lib/styles";
import type { Backend, Dataset } from "../../lib/types";
import { Icon } from "../ui/Icon";
import { Dropdown, MenuHeading, MenuItem } from "../ui/Menu";
import { SegmentPill, segmentTrack } from "../ui/Segment";
import { DatasetMenu } from "./DatasetMenu";

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
    <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-0 border-t border-dashed border-rule pt-3.5">
      <div className={cn(segmentTrack, "mr-2.5")}>
        {(["examples", "dataset"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => props.onSourceChange(option)}
            className={cn(
              "relative rounded-full border-0 bg-transparent px-3 py-0.75 text-[13px] transition-colors",
              source === option ? "text-ink" : "text-dim hover:text-ink",
            )}
          >
            {source === option && <SegmentPill group="source" />}
            <span className="relative">{option === "examples" ? "Examples" : "Dataset"}</span>
          </button>
        ))}
      </div>

      {source === "examples" && (
        <Dropdown
          compact
          active={!!props.example}
          icon={ChatTextIcon}
          open={props.exampleMenuOpen}
          onOpenChange={props.onExampleMenuOpenChange}
          button={props.example || "Choose an example"}
        >
          <MenuHeading>Built-in examples</MenuHeading>
          {EXAMPLE_NAMES.map((name) => (
            <MenuItem
              key={name}
              label={name}
              icon={ChatTextIcon}
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
                <Icon icon={ArrowRightIcon} size={12} />
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
                <Icon icon={QueueIcon} size={12} />
                Run batch
              </button>
              <button
                type="button"
                className={chipButton()}
                disabled={busy || setExhausted}
                onClick={() => props.onRunBatch(true)}
              >
                <Icon icon={StackIcon} size={12} />
                {allLabel}
              </button>
              {props.batchRunning && (
                <button type="button" className={chipButton()} onClick={props.onStop}>
                  <Icon icon={StopIcon} size={12} />
                  Stop
                </button>
              )}
            </>
          )}
        </>
      )}

      <button type="button" className={cn(chipButton(), "ml-auto")} onClick={props.onEdit}>
        <Icon icon={PencilSimpleIcon} size={12} />
        Edit input
      </button>
    </div>
  );
}
