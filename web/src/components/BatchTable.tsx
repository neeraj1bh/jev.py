import { useEffect, useRef } from "react";

import { answerLabel, inputSnippet, matchesLabel, scoreResponse } from "../scoring";
import { cn, labelText, monoDim, panelBox, tableCell, tableHead } from "../styles";
import type { Response, Row } from "../types";
import { CheckMark } from "./CheckMark";
import { Tip } from "./Tip";

function ResultCell({
  response,
  truth,
  ms,
}: {
  response: Response;
  truth: Record<string, string>;
  ms: number;
}) {
  if (response.error) return <td className={cn(tableCell, "text-warn")}>error</td>;
  const time = <span className={cn(monoDim, "ml-2")}>{ms} ms</span>;
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
    return (
      <td className={cn(tableCell, correct ? "text-good" : "text-warn")}>
        {label} <span className={monoDim}>{probability?.toFixed(2)}</span>{" "}
        <CheckMark ok={correct} />
        {time}
      </td>
    );
  }
  const [correct, total] = scoreResponse(response, truth);
  return (
    <td className={cn(tableCell, correct === total ? "text-good" : "text-warn")}>
      {correct}/{total} right
      {time}
    </td>
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

export function BatchTable({
  rows,
  columns,
  note,
  file,
  selected,
  follow,
  onOpen,
}: BatchTableProps) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const tally = columns.map((_, k) =>
    rows.reduce<[number, number]>(
      ([correct, total], row) => {
        const side = row.sides[k];
        if (!side) return [correct, total];
        const [c, n] = scoreResponse(side.response, row.item.truth);
        return [correct + c, total + n];
      },
      [0, 0],
    ),
  );
  const countsQuestions = (tally[0]?.[1] ?? 0) > rows.length;
  const labelled = (tally[0]?.[1] ?? 0) > 0;

  // The table follows the item open in the item dialog.
  useEffect(() => {
    if (selected === null || !follow) return;
    bodyRef.current?.children[selected]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selected, follow]);

  return (
    <div className={cn(panelBox, "mt-3.5")}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-sm font-semibold text-ink">
          Batch results <span className="font-normal text-dim">{note}</span>
          {labelled && (
            <span className="ml-2.5 text-[13px] font-normal text-dim">
              {columns.map((column, k) => (
                <span key={column}>
                  {k > 0 && " · "}
                  {column}{" "}
                  <b className="font-medium text-ink">
                    {tally[k]?.[0]}/{tally[k]?.[1]}
                  </b>
                </span>
              ))}
              {countsQuestions && " questions"}
            </span>
          )}
        </h2>
        <Tip content={file.path}>
          <span className={labelText}>{file.text}</span>
        </Tip>
      </div>
      <div className="max-h-[460px] overflow-auto">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-11" />
            <col className={columns.length > 3 ? "w-[26%]" : "w-[38%]"} />
            {labelled && <col className="w-28" />}
            {columns.map((column) => (
              <col key={column} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={tableHead}>#</th>
              <th className={tableHead}>Input</th>
              {labelled && <th className={tableHead}>Label</th>}
              {columns.map((column) => (
                <Tip key={column} content={column}>
                  <th className={cn(tableHead, "truncate")}>{column}</th>
                </Tip>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {rows.map((row, i) => {
              const questionCount = Object.keys(row.item.truth).length;
              const input = inputSnippet(row.item.state);
              return (
                <tr
                  key={row.item.source}
                  onClick={() => onOpen(i)}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-lift [&>td:first-child]:rounded-l-md [&>td:last-child]:rounded-r-md",
                    selected === i && "bg-lift",
                    row.isNew && "animate-rise motion-reduce:animate-none",
                  )}
                >
                  <td className={tableCell}>
                    <span className={monoDim}>{i + 1}</span>
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
                  {columns.map((column, k) => {
                    const side = row.sides[k];
                    return (
                      side && (
                        <ResultCell
                          key={column}
                          response={side.response}
                          truth={row.item.truth}
                          ms={side.ms}
                        />
                      )
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
