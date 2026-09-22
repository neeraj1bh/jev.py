import { fastestIndexes } from "../scoring";
import { cn, labelText } from "../styles";
import type { PanelState, Row, Side } from "../types";
import { CompareTable } from "./CompareTable";
import { Modal } from "./Modal";
import { Tip } from "./Tip";

const iconButton =
  "grid size-8 place-items-center rounded-md border border-rule bg-transparent p-0 text-lg leading-none text-dim transition-colors hover:enabled:border-dim hover:enabled:text-ink";

const asPanel = (side: Side, fastest: boolean): PanelState => ({
  status: "done",
  fastest,
  ms: side.ms,
  response: side.response.error ? undefined : side.response,
  footer: side.response.error?.message ?? "",
});

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
  const fastest = fastestIndexes(sides.map((side) => side.ms));
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
          <Tip content={item.source}>
            <p className={cn(labelText, "mt-1 mb-0 truncate")}>
              {dataset} · {item.source}
            </p>
          </Tip>
        </div>
        <div className="flex flex-none gap-1.5">
          <Tip content="Previous (←)">
            <button
              type="button"
              className={iconButton}
              aria-label="Previous item"
              disabled={isFirst}
              onClick={() => onNavigate(index - 1)}
            >
              ‹
            </button>
          </Tip>
          <Tip content="Next (→)">
            <button
              type="button"
              className={iconButton}
              aria-label="Next item"
              disabled={isLast}
              onClick={() => onNavigate(index + 1)}
            >
              ›
            </button>
          </Tip>
          <Tip content="Close (Esc)">
            <button type="button" className={iconButton} aria-label="Close" onClick={onClose}>
              ×
            </button>
          </Tip>
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
        <CompareTable
          key={index}
          bare
          names={columns}
          panels={sides.map((side, k) => asPanel(side, fastest.includes(k)))}
          questionIds={Object.keys(item.questions)}
          truth={truth}
        />
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
