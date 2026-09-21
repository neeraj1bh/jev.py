import { scoreResponse } from "../scoring";
import { cx, labelText } from "../styles";
import type { Row } from "../types";
import { Answers } from "./Answers";
import { CheckMark } from "./CheckMark";
import { Modal } from "./Modal";

const iconButton =
  "grid size-8 place-items-center rounded-md border border-rule bg-transparent p-0 text-lg leading-none text-dim hover:enabled:border-dim hover:enabled:text-ink";

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

export function ItemDialog({
  open,
  index,
  direction,
  rows,
  columns,
  dataset,
  onClose,
  onNavigate,
}: ItemDialogProps) {
  const row = rows[index];
  if (!row) return null;
  const { item, sides } = row;
  const perRow = Math.min(sides.length, 3);
  const isFirst = index === 0;
  const isLast = index === rows.length - 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest("summary, pre")) return;
        if (event.key === "ArrowLeft" && !isFirst) onNavigate(index - 1);
        else if (event.key === "ArrowRight" && !isLast) onNavigate(index + 1);
      }}
      className="[inset:12vh_0_auto] mx-auto h-auto max-h-[calc(100vh-12vh-32px)] w-[min(1100px,calc(100vw-32px))] px-[26px] pt-[22px] pb-3.5 backdrop:animate-fade open:flex open:animate-pop open:flex-col motion-reduce:animate-none"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="m-0 text-base font-semibold tabular-nums">
            Item {index + 1} of {rows.length}
          </h2>
          <p className={cx(labelText, "mt-1 mb-0 truncate")} title={item.source}>
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
        <summary className={cx(labelText, "w-fit cursor-pointer")}>Input</summary>
        <pre className="mt-2 max-h-[180px] min-h-0 overflow-auto">
          {typeof item.state === "string" ? item.state : JSON.stringify(item.state, null, 2)}
        </pre>
      </details>
      <div
        key={index}
        style={{ "--per-row": perRow } as React.CSSProperties}
        className={cx(
          "mt-[18px] grid min-h-0 flex-[0_1_auto] grid-cols-[repeat(var(--per-row),minmax(0,1fr))] content-start overflow-auto border-t border-rule max-[860px]:grid-cols-1",
          direction === "forward" && "animate-from-r motion-reduce:animate-none",
          direction === "back" && "animate-from-l motion-reduce:animate-none",
        )}
      >
        {columns.map((column, k) => {
          const side = sides[k];
          if (!side) return null;
          const [correct, total] = scoreResponse(side.response, item.truth);
          const allRight = correct === total;
          return (
            <div
              key={column}
              className={cx(
                "min-w-0 pt-3.5 max-[860px]:border-l-0 max-[860px]:px-0",
                k % perRow === 0 ? "pr-5 pl-0" : "border-l border-rule px-5",
                k > 0 && "max-[860px]:mt-3.5 max-[860px]:border-t max-[860px]:border-rule",
              )}
            >
              <h3 className="mt-0 mb-1 flex items-center gap-2.5 text-sm font-semibold">
                {column}
                <span
                  className={cx(
                    "rounded-full border border-current px-2 py-0.5 font-mono text-xs font-medium",
                    allRight ? "text-good" : "text-warn",
                  )}
                >
                  <CheckMark ok={allRight} /> {correct}/{total}
                </span>
                <span className="ml-auto font-mono text-[13px] font-medium text-dim">
                  {side.ms} ms
                </span>
              </h3>
              <div className="min-w-0">
                {side.response.error ? (
                  side.response.error.message
                ) : (
                  <Answers response={side.response} truth={item.truth} toggleable />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className={cx(labelText, "mt-2 flex justify-between gap-3 border-t border-rule pt-3")}>
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
