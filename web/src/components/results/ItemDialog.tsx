import {
  CaretLeftIcon,
  CaretRightIcon,
  RowsIcon,
  TextAlignLeftIcon,
  XIcon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";

import { fastestIndexes, inputSnippet, rankColumns, scoreResponse } from "../../lib/scoring";
import { cn } from "../../lib/styles";
import type { PanelState, Row, Side } from "../../lib/types";
import { Reveal } from "../run/AnswerCells";
import { CompareTable } from "../run/CompareTable";
import { ModelRowsTable } from "../run/ModelRowsTable";
import { Icon, IconTile } from "../ui/Icon";
import { Kbd } from "../ui/Menu";
import { DialogFrame, Modal, RoundButton } from "../ui/Modal";
import { Tip } from "../ui/Tip";

const asPanel = (side: Side, fastest: boolean): PanelState => ({
  status: "done",
  fastest,
  ms: side.ms,
  response: side.response.error ? undefined : side.response,
  footer: side.response.error?.message ?? "",
});

function InputCard({ state }: { state: unknown }) {
  const [open, setOpen] = useState(false);
  const text = typeof state === "string" ? state : JSON.stringify(state, null, 2);
  return (
    <div className="rounded-xl bg-lift/60 ring-1 ring-rule">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 rounded-xl border-0 bg-transparent px-3 py-2 text-left"
      >
        <IconTile icon={TextAlignLeftIcon} />
        <span className="text-[10.5px] font-medium tracking-[0.08em] text-dim uppercase">
          Input
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] text-ink transition-opacity",
            open && "opacity-0",
          )}
        >
          {inputSnippet(state)}
        </span>
        <Icon
          icon={CaretRightIcon}
          size={12}
          className={cn("text-dim transition-transform duration-150", open && "rotate-90")}
        />
      </button>
      <Reveal open={open}>
        {/* Opens at most 220px tall and drags taller from its corner; a new item opens anew. */}
        <pre
          key={text}
          ref={(pre) => {
            if (pre) pre.style.height = `${Math.min(pre.scrollHeight, 220)}px`;
          }}
          className="mx-3 mb-3 max-h-[75vh] min-h-0 resize-y overflow-auto border-0 bg-panel"
        >
          {text}
        </pre>
      </Reveal>
    </div>
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
  const reduce = useReducedMotion();
  // The same winner-first order as the summary and the table behind it.
  const order = useMemo(() => rankColumns(rows, columns.length), [rows, columns.length]);
  const row = rows[index];
  if (!row) return null;
  const { item } = row;
  const sides = order.flatMap((k) => (row.sides[k] ? [row.sides[k]] : []));
  const names = order.map((k) => columns[k] ?? "");
  const truth = Object.keys(item.truth).length > 0 ? item.truth : undefined;
  const fastest = fastestIndexes(sides.map((side) => side.ms));
  const panels = sides.map((side, k) => asPanel(side, fastest.includes(k)));
  const isFirst = index === 0;
  const isLast = index === rows.length - 1;
  const right = truth
    ? sides.filter((side) => {
        const [correct, total] = scoreResponse(side.response, item.truth);
        return total > 0 && correct === total;
      }).length
    : null;
  const shift = direction === "forward" ? 6 : direction === "back" ? -6 : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      holdFocus
      step={index}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest("pre")) return;
        if (event.key === "ArrowLeft" && !isFirst) onNavigate(index - 1);
        else if (event.key === "ArrowRight" && !isLast) onNavigate(index + 1);
      }}
      className="mx-auto h-auto max-h-[calc(92vh-16px)] w-[min(1280px,calc(100vw-32px))] bg-lift p-1.5 inset-[5vh_0_auto] backdrop:animate-fade focus:outline-none open:flex open:animate-pop open:flex-col motion-reduce:animate-none"
    >
      <DialogFrame
        icon={RowsIcon}
        title={`Item ${(index + 1).toLocaleString()}`}
        badge={`${(index + 1).toLocaleString()} / ${rows.length.toLocaleString()}`}
        subtitle={
          <Tip content={item.source}>
            <span>
              {dataset} · {item.source}
            </span>
          </Tip>
        }
        actions={
          <>
            <Tip content="Previous (←)">
              <RoundButton
                label="Previous item"
                disabled={isFirst}
                onClick={() => onNavigate(index - 1)}
              >
                <Icon icon={CaretLeftIcon} size={14} />
              </RoundButton>
            </Tip>
            <Tip content="Next (→)">
              <RoundButton
                label="Next item"
                disabled={isLast}
                onClick={() => onNavigate(index + 1)}
              >
                <Icon icon={CaretRightIcon} size={14} />
              </RoundButton>
            </Tip>
            <span className="mx-1 h-5 w-px bg-rule" />
            <Tip content="Close (Esc)">
              <RoundButton label="Close" onClick={onClose}>
                <Icon icon={XIcon} size={14} />
              </RoundButton>
            </Tip>
          </>
        }
        bodyClassName="px-4 pt-3.5 pb-2"
        footer={
          <>
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
            <span className="mr-2">Previous / next</span>
            <Kbd>esc</Kbd>
            <span>Close</span>
            <span className="ml-auto">
              {right !== null && (
                <>
                  <span
                    className={cn("font-medium", right === sides.length ? "text-good" : "text-ink")}
                  >
                    {right} of {sides.length}
                  </span>{" "}
                  models right ·{" "}
                </>
              )}
              click a {names.length > 4 ? "model" : "question"} for every option
            </span>
          </>
        }
      >
        <InputCard state={item.state} />
        <motion.div
          key={index}
          initial={reduce ? false : { opacity: 0, x: shift }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
          className="mt-3"
        >
          {names.length > 4 ? (
            <ModelRowsTable
              names={names}
              panels={panels}
              questionIds={Object.keys(item.questions)}
              truth={truth}
            />
          ) : (
            <CompareTable
              bare
              names={names}
              panels={panels}
              questionIds={Object.keys(item.questions)}
              truth={truth}
            />
          )}
        </motion.div>
      </DialogFrame>
    </Modal>
  );
}
