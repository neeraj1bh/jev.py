import type { ReactNode } from "react";

import { answerLabel, percent, scoreResponse } from "../scoring";
import { cx, labelText, panelBox } from "../styles";
import type { Answer, Row } from "../types";

interface ColumnStats {
  correct: number;
  total: number;
  fullyRight: number;
  averageMs: number;
  medianMs: number;
}

function columnStats(rows: Row[], column: number): ColumnStats {
  let correct = 0;
  let total = 0;
  let fullyRight = 0;
  const times: number[] = [];
  for (const row of rows) {
    const side = row.sides[column];
    if (!side) continue;
    times.push(side.ms);
    const [c, n] = scoreResponse(side.response, row.item.truth);
    correct += c;
    total += n;
    if (c === n) fullyRight++;
  }
  times.sort((a, b) => a - b);
  const averageMs = times.length
    ? Math.round(times.reduce((sum, ms) => sum + ms, 0) / times.length)
    : 0;
  return { correct, total, fullyRight, averageMs, medianMs: times[times.length >> 1] ?? 0 };
}

function agreementRate(rows: Row[]) {
  let same = 0;
  let compared = 0;
  for (const row of rows) {
    for (const id of Object.keys(row.item.truth)) {
      const answers = row.sides.map((side) => side.response.answers[id]);
      const present = answers.filter((answer): answer is Answer => answer !== undefined);
      if (present.length < answers.length) continue;
      compared++;
      if (new Set(present.map(answerLabel)).size === 1) same++;
    }
  }
  return percent(same, compared);
}

interface StatRowProps {
  label: string;
  columns: string[];
  values: number[];
  cell: (column: number) => ReactNode;
  higherIsBetter?: boolean;
}

function StatRow({ label, columns, values, cell, higherIsBetter = true }: StatRowProps) {
  const best = higherIsBetter ? Math.max(...values) : Math.min(...values);
  const singleBest = values.filter((value) => value === best).length === 1;
  return (
    <tr>
      <td className="border-t border-rule py-[7px] pr-2 text-dim">{label}</td>
      {columns.map((column, k) => (
        <td key={column} className="border-t border-rule px-2 py-[7px] tabular-nums">
          <b className={singleBest && values[k] === best ? "text-good" : "text-ink"}>{cell(k)}</b>
        </td>
      ))}
    </tr>
  );
}

interface SummaryProps {
  rows: Row[];
  columns: string[];
  dataset: string;
}

export function Summary({ rows, columns, dataset }: SummaryProps) {
  const [first] = rows;
  if (!first) return null;
  const stats = columns.map((_, k) => columnStats(rows, k));
  const stat = (k: number) => stats[k] ?? columnStats([], k);
  const byQuestion = Object.keys(first.item.truth).length > 1 || stat(0).total > rows.length;

  return (
    <div className={cx(panelBox, "mb-3.5 animate-fade motion-reduce:animate-none")}>
      <table className="w-full border-collapse text-sm">
        <tbody>
          <tr>
            <th className="pr-2 pb-2 text-left font-normal text-dim">
              {dataset} · {rows.length} items
            </th>
            {columns.map((column) => (
              <th key={column} className="px-2 pb-2 text-left font-semibold text-ink">
                {column}
              </th>
            ))}
          </tr>
          <StatRow
            label={byQuestion ? "Questions right" : "Right"}
            columns={columns}
            values={stats.map((s) => (s.total ? s.correct / s.total : 0))}
            cell={(k) => (
              <>
                {percent(stat(k).correct, stat(k).total)}{" "}
                <span className={labelText}>
                  {stat(k).correct}/{stat(k).total}
                </span>
              </>
            )}
          />
          {byQuestion && (
            <StatRow
              label="Items fully right"
              columns={columns}
              values={stats.map((s) => s.fullyRight)}
              cell={(k) => `${stat(k).fullyRight}/${rows.length}`}
            />
          )}
          <StatRow
            label="Average time"
            columns={columns}
            values={stats.map((s) => s.averageMs)}
            cell={(k) => `${stat(k).averageMs.toLocaleString()} ms`}
            higherIsBetter={false}
          />
          <StatRow
            label="Median time"
            columns={columns}
            values={stats.map((s) => s.medianMs)}
            cell={(k) => `${stat(k).medianMs.toLocaleString()} ms`}
            higherIsBetter={false}
          />
        </tbody>
      </table>
      <p className="mt-3 mb-0 text-sm text-dim">
        {columns.length > 2 ? `All ${columns.length} gave` : "They gave"} the same answer on{" "}
        {agreementRate(rows)} of {byQuestion ? "questions" : "items"}. Click a row to open it.
      </p>
    </div>
  );
}
