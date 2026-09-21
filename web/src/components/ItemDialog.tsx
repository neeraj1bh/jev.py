import { fastestIndexes, scoreResponse } from "../scoring";
import { cn, labelText } from "../styles";
import type { PanelState, Row, Side } from "../types";
import { Answers } from "./Answers";
import { CheckMark } from "./CheckMark";
import { CompareTable } from "./CompareTable";
import { Modal } from "./Modal";

const iconButton =
  "grid size-8 place-items-center rounded-md border border-rule bg-transparent p-0 text-lg leading-none text-dim transition-colors hover:enabled:border-dim hover:enabled:text-ink";

const asPanel = (side: Side, fastest: boolean): PanelState => ({
  status: "done",
  fastest,
  ms: side.ms,
  response: side.response.error ? undefined : side.response,
  footer: side.response.error?.message ?? "",
});

function SideHeading({
  name,
  side,
  truth,
}: {
  name: string;
  side: Side;
  truth?: Record<string, string>;
}) {
  const [correct, total] = truth ? scoreResponse(side.response, truth) : [0, 0];
  const allRight = correct === total;
  return (
    <h3 className="mt-0 mb-1 flex items-center gap-2.5 text-sm font-semibold">
      {name}
      {total > 0 && (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[13px] font-medium tabular-nums",
            allRight ? "text-good" : "text-warn",
          )}
        >
          <CheckMark ok={allRight} />
          {correct}/{total} right
        </span>
      )}
      <span className="ml-auto font-mono text-[13px] font-medium text-dim tabular-nums">
        {side.ms} ms
      </span>
    </h3>
  );
}

interface ItemDialogProps {
  open: boolean;
  index: number;
  direction: "" | "forward" | "back";
  rows: Row[];
  columns: string[];
  dataset: string;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function ItemDialog(props: ItemDialogProps) {
  const { open, index, direction, rows, columns, dataset, onClose, onNavigate } = props;
  const row = rows[index];
  if (!row) return null;
  const { item, sides } = row;
  const truth = Object.keys(item.truth).length > 0 ? item.truth : undefined;
  const isFirst = index === 0;
  const isLast = index === rows.length - 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      holdFocus
      step={index}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest("summary, pre")) return;
        if (event.key === "ArrowLeft" && !isFirst) onNavigate(index - 1);
        else if (event.key === "ArrowRight" && !isLast) onNavigate(index + 1);
      }}
      className="mx-auto h-auto max-h-[calc(88vh-32px)] w-[min(1100px,calc(100vw-32px))] px-[26px] pt-[22px] pb-3.5 [inset:12vh_0_auto] backdrop:animate-fade focus:outline-none open:flex open:animate-pop open:flex-col motion-reduce:animate-none"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="m-0 text-base font-semibold tabular-nums">
            Item {index + 1} of {rows.length}
          </h2>
          <p className={cn(labelText, "mt-1 mb-0 truncate")} title={item.source}>
            {dataset} · {item.source}
          </p>
        </div>
        <div className="flex flex-none gap-1.5">
          <button
            type="button"
            className={iconButton}
            aria-label="Previous item"
            title="Previous (←)"
            disabled={isFirst}
            onClick={() => onNavigate(index - 1)}
          >
            ‹
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label="Next item"
            title="Next (→)"
            disabled={isLast}
            onClick={() => onNavigate(index + 1)}
          >
            ›
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label="Close"
            title="Close (Esc)"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>

      <details className="mt-3.5 text-dim">
        <summary className={cn(labelText, "w-fit cursor-pointer")}>Input</summary>
        <pre className="mt-2 max-h-[180px] min-h-0 overflow-auto">
          {typeof item.state === "string" ? item.state : JSON.stringify(item.state, null, 2)}
        </pre>
      </details>

      <div
        key={index}
        className={cn(
          "mt-4 min-h-0 flex-[0_1_auto] overflow-y-auto border-t border-rule pt-1",
          direction === "forward" && "animate-from-r motion-reduce:animate-none",
          direction === "back" && "animate-from-l motion-reduce:animate-none",
        )}
      >
        {sides.length > 2 ? (
          <CompareTable
            bare
            names={columns}
            panels={sides.map((side, k) =>
              asPanel(side, fastestIndexes(sides.map((s) => s.ms)).includes(k)),
            )}
            questionIds={Object.keys(item.questions)}
            truth={truth}
          />
        ) : (
          <div className="grid grid-cols-2 max-[860px]:grid-cols-1">
            {columns.map((column, k) => {
              const side = sides[k];
              if (!side) return null;
              return (
                <div
                  key={column}
                  className={cn(
                    "min-w-0 pt-3.5",
                    k === 0
                      ? "pr-5 max-[860px]:pr-0"
                      : "border-l border-rule pl-5 max-[860px]:mt-3.5 max-[860px]:border-t max-[860px]:border-l-0 max-[860px]:pl-0",
                  )}
                >
                  <SideHeading name={column} side={side} truth={truth} />
                  {side.response.error ? (
                    <p className="text-[13px] text-warn">{side.response.error.message}</p>
                  ) : (
                    <Answers response={side.response} truth={truth} toggleable />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={cn(labelText, "mt-2 flex justify-between gap-3 border-t border-rule pt-3")}>
        <span>
          <kbd>←</kbd> <kbd>→</kbd> previous / next
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </Modal>
  );
}
