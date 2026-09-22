import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactElement, useEffect, useRef } from "react";

import { answerLabel, inputSnippet, matchesLabel, scoreResponse } from "../scoring";
import { cn, labelText, monoDim, panelBox, tableCell, tableHead } from "../styles";
import type { Response, Row } from "../types";
import { CheckMark } from "./CheckMark";
import { Tip } from "./Tip";

/** One model's answer to one item; with many columns the time moves into the tooltip. */
function ResultCell({
  response,
  truth,
  ms,
  compact,
}: {
  response: Response;
  truth: Record<string, string>;
  ms: number;
  compact: boolean;
}) {
  if (response.error) return <td className={cn(tableCell, "text-warn")}>error</td>;
  const time = compact ? null : <span className={cn(monoDim, "ml-2")}>{ms} ms</span>;
  const withTime = (cell: ReactElement) =>
    compact ? <Tip content={`${ms.toLocaleString()} ms`}>{cell}</Tip> : cell;
  const ids = Object.keys(truth);
  if (ids.length === 0) {
    const count = Object.keys(response.answers).length;
    return (
      <td className={cn(tableCell, "text-dim")}>
        {count} {count === 1 ? "answer" : "answers"}
        {time}
      </td>
    );
  }
  const [onlyId] = ids;
  if (ids.length === 1 && onlyId !== undefined) {
    const answer = response.answers[onlyId];
    if (!answer) return <td className={tableCell}>–</td>;
    const label = answerLabel(answer);
    const probability =
      answer.type === "noul"
        ? label === "yes"
          ? answer.noul
          : 1 - answer.noul
        : answer.probabilities?.[label];
    const correct = matchesLabel(label, truth[onlyId]);
    return withTime(
      <td className={cn(tableCell, correct ? "text-good" : "text-warn")}>
        {label} <span className={monoDim}>{probability?.toFixed(2)}</span>{" "}
        {!compact && <CheckMark ok={correct} />}
        {time}
      </td>,
    );
  }
  const [correct, total] = scoreResponse(response, truth);
  return withTime(
    <td className={cn(tableCell, correct === total ? "text-good" : "text-warn")}>
      {correct}/{total}
      {!compact && " right"}
      {time}
    </td>,
  );
}

interface BatchTableProps {
  rows: Row[];
  columns: string[];
  note: string;
  file: { text: string; path: string };
  selected: number | null;
  follow: boolean;
  onOpen: (index: number) => void;
}

const ROW_PX = 35; // every row is one line and pinned to this height, so the scroll never corrects itself
const NEW_ROWS = 6; // only the rows that just arrived rise in, not every row scrolled back into view
const STRIP_AFTER = 6; // more models than this get one square each instead of a column each

/** Every model's result on one item as a row of squares, in the ranked order, details on hover. */
function StripCell({ row, columns }: { row: Row; columns: string[] }) {
  let right = 0;
  const squares = row.sides.map((side, k) => {
    const [correct, total] = scoreResponse(side.response, row.item.truth);
    const ok = total > 0 && correct === total;
    if (ok) right++;
    const ids = Object.keys(row.item.truth);
    const only = ids.length === 1 && ids[0] ? side.response.answers[ids[0]] : undefined;
    const detail = side.response.error
      ? "error"
      : only
        ? `${answerLabel(only)} (${ok ? "right" : `label: ${Object.values(row.item.truth)[0]}`})`
        : `${correct}/${total} right`;
    return (
      <Tip key={columns[k]} content={`${columns[k]} · ${detail} · ${side.ms.toLocaleString()} ms`}>
        <span
          className={cn(
            "h-3.5 w-2 flex-none rounded-[2px] transition-transform duration-150 hover:scale-y-[1.3]",
            side.response.error ? "bg-bar" : ok ? "bg-good" : "bg-warn",
          )}
        />
      </Tip>
    );
  });
  return (
    <td className={cn(tableCell, "max-w-none")}>
      <span className="flex items-center gap-4">
        <span className="flex flex-wrap gap-[2px]">{squares}</span>
        <span className="ml-auto font-mono text-xs text-dim tabular-nums">
          {right}/{row.sides.length}
        </span>
      </span>
    </td>
  );
}

export function BatchTable({
  rows,
  columns,
  note,
  file,
  selected,
  follow,
  onOpen,
}: BatchTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Only the rows in view are drawn, so a 3,000-item run opens and replays as fast as a short one.
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_PX,
    overscan: 12,
  });
  const drawn = virtual.getVirtualItems();
  const padTop = drawn[0]?.start ?? 0;
  const padBottom = virtual.getTotalSize() - (drawn.at(-1)?.end ?? 0);
  const labelled = rows.some((row) => Object.keys(row.item.truth).length > 0);
  const strip = columns.length > STRIP_AFTER;
  const span = 2 + (labelled ? 1 : 0) + (strip ? 1 : columns.length);

  // The table follows the item open in the item dialog, and the newest row during a replay.
  // The virtualizer is a new object every render, so it is read through a ref: depending on it
  // would scroll, render and scroll again without end.
  const virtualRef = useRef(virtual);
  virtualRef.current = virtual;
  useEffect(() => {
    if (selected === null || !follow) return;
    // While rows arrive the table glides to its end, so a stream of updates reads as one motion;
    // an item opened by hand is centred.
    const box = scrollRef.current;
    if (selected === rows.length - 1 && box)
      box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    else virtualRef.current.scrollToIndex(selected, { align: "center" });
  }, [selected, follow, rows.length]);

  return (
    <div className={cn(panelBox, "mt-3.5")}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-sm font-semibold text-ink">
          Batch results <span className="font-normal text-dim">{note}</span>
        </h2>
        <Tip content={file.path}>
          <span className={labelText}>{file.text}</span>
        </Tip>
      </div>
      <div ref={scrollRef} className="max-h-[460px] overflow-auto">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-14" />
            <col className={strip ? "w-[32%]" : columns.length > 3 ? "w-[26%]" : "w-[38%]"} />
            {labelled && <col className={strip ? "w-44" : "w-28"} />}
            {strip ? <col /> : columns.map((column) => <col key={column} />)}
          </colgroup>
          <thead>
            <tr>
              <th className={tableHead}>#</th>
              <th className={tableHead}>Input</th>
              {labelled && <th className={tableHead}>Label</th>}
              {strip ? (
                <th className={tableHead}>
                  {columns.length} models <span className="font-normal">· best first</span>
                </th>
              ) : (
                columns.map((column) => (
                  <Tip key={column} content={column}>
                    <th className={cn(tableHead, "truncate")}>{column}</th>
                  </Tip>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && (
              <tr>
                <td colSpan={span} style={{ height: padTop, padding: 0 }} />
              </tr>
            )}
            {drawn.map(({ index }) => {
              const row = rows[index];
              if (!row) return null;
              const questionCount = Object.keys(row.item.truth).length;
              const input = inputSnippet(row.item.state);
              return (
                <tr
                  key={index}
                  data-index={index}
                  style={{ height: ROW_PX }}
                  onClick={() => onOpen(index)}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-lift [&>td:first-child]:rounded-l-md [&>td:last-child]:rounded-r-md",
                    selected === index && "bg-lift",
                    row.isNew &&
                      index >= rows.length - NEW_ROWS &&
                      "animate-rise motion-reduce:animate-none",
                  )}
                >
                  <td className={tableCell}>
                    <span className={monoDim}>{index + 1}</span>
                  </td>
                  <Tip content={input}>
                    <td className={cn(tableCell, "max-w-none text-ink")}>{input}</td>
                  </Tip>
                  {labelled && (
                    <td className={tableCell}>
                      {questionCount > 1 ? (
                        <span className={monoDim}>{questionCount} questions</span>
                      ) : (
                        Object.values(row.item.truth)[0]
                      )}
                    </td>
                  )}
                  {strip ? (
                    <StripCell row={row} columns={columns} />
                  ) : (
                    columns.map((column, k) => {
                      const side = row.sides[k];
                      return (
                        side && (
                          <ResultCell
                            key={column}
                            response={side.response}
                            truth={row.item.truth}
                            ms={side.ms}
                            compact={columns.length > 4}
                          />
                        )
                      );
                    })
                  )}
                </tr>
              );
            })}
            {padBottom > 0 && (
              <tr>
                <td colSpan={span} style={{ height: padBottom, padding: 0 }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
