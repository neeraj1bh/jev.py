import { useEffect, useRef } from "react";

import { answerLabel, inputSnippet, matchesLabel, scoreResponse } from "../scoring";
import { cx, labelText, monoDim, panelBox, tableCell, tableHead } from "../styles";
import type { Response, Row } from "../types";
import { CheckMark } from "./CheckMark";

function ResultCell({ response, truth }: { response: Response; truth: Record<string, string> }) {
  if (response.error) return <td className={cx(tableCell, "text-warn")}>error</td>;
  const ids = Object.keys(truth);
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
      <td className={cx(tableCell, correct ? "text-good" : "text-warn")}>
        {label} <span className={monoDim}>{probability?.toFixed(2)}</span>{" "}
        <CheckMark ok={correct} />
      </td>
    );
  }
  const [correct, total] = scoreResponse(response, truth);
  return (
    <td className={cx(tableCell, correct === total ? "text-good" : "text-warn")}>
      {correct}/{total} right
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

  // The table follows the item open in the item dialog.
  useEffect(() => {
    if (selected === null || !follow) return;
    bodyRef.current?.children[selected]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selected, follow]);

  return (
    <div className={cx(panelBox, "mt-3.5")}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-sm font-semibold text-ink">
          Batch results <span className="font-normal text-dim">{note}</span>
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
        </h2>
        <span className={labelText} title={file.path}>
          {file.text}
        </span>
      </div>
      <div className="max-h-[460px] overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={tableHead}>#</th>
              <th className={tableHead}>Input</th>
              <th className={tableHead}>Label</th>
              {columns.map((column) => (
                <th key={column} className={tableHead}>
                  {column}
                </th>
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
                  className={cx(
                    "cursor-pointer hover:bg-code",
                    selected === i && "bg-code",
                    row.isNew && "animate-rise motion-reduce:animate-none",
                  )}
                >
                  <td className={tableCell}>
                    <span className={monoDim}>{i + 1}</span>
                  </td>
                  <td className={cx(tableCell, "max-w-[380px] text-ink")} title={input}>
                    {input}
                  </td>
                  <td className={tableCell}>
                    {questionCount > 1 ? (
                      <span className={monoDim}>{questionCount} questions</span>
                    ) : (
                      Object.values(row.item.truth)[0]
                    )}
                  </td>
                  {columns.map((column, k) => {
                    const side = row.sides[k];
                    return (
                      side && (
                        <ResultCell key={column} response={side.response} truth={row.item.truth} />
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
