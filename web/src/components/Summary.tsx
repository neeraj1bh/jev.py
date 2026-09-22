import { answerLabel, percent, scoreResponse } from "../scoring";
import { cn, labelText, tableCell, tableHead } from "../styles";
import type { Answer, Row } from "../types";
import { InfoTip } from "./InfoTip";
import { Tip } from "./Tip";

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
    for (const id of Object.keys(row.item.questions)) {
      const answers = row.sides.map((side) => side.response.answers[id]);
      const present = answers.filter((answer): answer is Answer => answer !== undefined);
      if (present.length < answers.length) continue;
      compared++;
      if (new Set(present.map(answerLabel)).size === 1) same++;
    }
  }
  return percent(same, compared);
}

const INFO = {
  right:
    "How often the model's answer matched the dataset's own label, which people wrote. Higher is better.",
  whole: "Items where every question on it was answered right.",
  average: "Time from sending the item to getting every answer back, averaged over the batch.",
  median:
    "The middle time: half the items were faster. One slow request moves it less than the average.",
};

/** Index of the single best value, or -1 when there is a tie. */
function bestIndex(values: number[], higherIsBetter: boolean) {
  const best = higherIsBetter ? Math.max(...values) : Math.min(...values);
  return values.filter((value) => value === best).length === 1 ? values.indexOf(best) : -1;
}

function StatLine({
  label,
  info,
  value,
  best,
}: {
  label: string;
  info: string;
  value: string;
  best: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-rule py-2 text-[13px]">
      <span className="inline-flex items-center gap-1 text-dim">
        {label}
        <InfoTip>{info}</InfoTip>
      </span>
      <span className={cn("font-medium tabular-nums", best ? "text-good" : "text-ink")}>
        {value}
      </span>
    </div>
  );
}

const CARDS = 3; // more models than this read better as one ranked table than as a wall of cards

interface Best {
  share: number;
  whole: number;
  average: number;
  median: number;
}

interface RankTableProps {
  rows: Row[];
  columns: string[];
  stats: ColumnStats[];
  best: Best;
  labelled: boolean;
  byQuestion: boolean;
}

/** Many models as one table, best first: the same numbers as the cards, one row each. */
function RankTable({ rows, columns, stats, best, labelled, byQuestion }: RankTableProps) {
  const head = (label: string, info: string, right = true) => (
    <th className={cn(tableHead, right && "text-right")}>
      <span className="inline-flex items-center gap-1">
        {label}
        <InfoTip>{info}</InfoTip>
      </span>
    </th>
  );
  const number = (value: string, isBest: boolean) => (
    <td
      className={cn(
        tableCell,
        "text-right font-mono tabular-nums",
        isBest ? "text-good" : "text-ink",
      )}
    >
      {value}
    </td>
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-rule bg-panel px-4 py-2">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={cn(tableHead, "w-8")}>#</th>
            <th className={tableHead}>Model</th>
            {labelled && head("Right", INFO.right)}
            {labelled && byQuestion && head("Items fully right", INFO.whole)}
            {head("Average", INFO.average)}
            {head("Median", INFO.median)}
          </tr>
        </thead>
        <tbody>
          {columns.map((column, k) => {
            const s = stats[k];
            if (!s) return null;
            const share = s.total ? s.correct / s.total : 0;
            return (
              <tr key={column}>
                <td className={cn(tableCell, "font-mono text-xs text-dim")}>{k + 1}</td>
                <td className={cn(tableCell, "max-w-none font-semibold text-ink")}>{column}</td>
                {labelled && (
                  <td className={cn(tableCell, "w-[34%] max-w-none")}>
                    <span className="flex items-center justify-end gap-3">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bar">
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            best.share === k ? "bg-good" : "bg-dim",
                          )}
                          style={{ width: `${share * 100}%` }}
                        />
                      </span>
                      <span
                        className={cn(
                          "w-14 text-right font-mono font-semibold tabular-nums",
                          best.share === k ? "text-good" : "text-ink",
                        )}
                      >
                        {percent(s.correct, s.total)}
                      </span>
                      <span className="w-24 text-right font-mono text-xs text-dim tabular-nums">
                        {s.correct.toLocaleString()}/{s.total.toLocaleString()}
                      </span>
                    </span>
                  </td>
                )}
                {labelled &&
                  byQuestion &&
                  number(
                    `${s.fullyRight.toLocaleString()}/${rows.length.toLocaleString()}`,
                    best.whole === k,
                  )}
                {number(`${s.averageMs.toLocaleString()} ms`, best.average === k)}
                {number(`${s.medianMs.toLocaleString()} ms`, best.median === k)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface SummaryProps {
  rows: Row[];
  columns: string[];
  dataset: string;
}

/** One card per model: its share right up front, then the details, the best of each in green. */
export function Summary({ rows, columns, dataset }: SummaryProps) {
  const [first] = rows;
  if (!first) return null;
  const stats = columns.map((_, k) => columnStats(rows, k));
  const labelled = (stats[0]?.total ?? 0) > 0;
  const byQuestion = Object.keys(first.item.questions).length > 1;
  const shares = stats.map((s) => (s.total ? s.correct / s.total : 0));
  const best = {
    share: bestIndex(shares, true),
    whole: bestIndex(
      stats.map((s) => s.fullyRight),
      true,
    ),
    average: bestIndex(
      stats.map((s) => s.averageMs),
      false,
    ),
    median: bestIndex(
      stats.map((s) => s.medianMs),
      false,
    ),
  };

  return (
    <section className="mb-3.5 animate-fade motion-reduce:animate-none">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="m-0 text-sm font-semibold text-ink">
          {dataset}{" "}
          <span className="font-normal text-dim">
            · {rows.length} {rows.length === 1 ? "item" : "items"}
          </span>
        </h2>
        <p className={cn(labelText, "m-0")}>
          {columns.length > 2 ? `All ${columns.length} gave` : "They gave"} the same answer on{" "}
          {agreementRate(rows)} of {byQuestion ? "questions" : "items"}
        </p>
      </div>
      {columns.length > CARDS ? (
        <RankTable
          rows={rows}
          columns={columns}
          stats={stats}
          best={best}
          labelled={labelled}
          byQuestion={byQuestion}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
          {columns.map((column, k) => {
            const s = stats[k];
            if (!s) return null;
            return (
              <article
                key={column}
                className="rounded-lg border border-rule bg-panel px-4 pt-3.5 pb-1.5"
              >
                <Tip content={column}>
                  <h3 className="m-0 truncate text-sm font-semibold text-ink">{column}</h3>
                </Tip>
                {labelled ? (
                  <>
                    <p className="mt-2.5 mb-0 flex items-baseline gap-2">
                      <span
                        className={cn(
                          "text-[26px] leading-none font-semibold tabular-nums",
                          best.share === k ? "text-good" : "text-ink",
                        )}
                      >
                        {percent(s.correct, s.total)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[13px] whitespace-nowrap text-dim">
                        {s.correct}/{s.total} right
                        <InfoTip>{INFO.right}</InfoTip>
                      </span>
                    </p>
                    <span className="mt-2.5 mb-3 block h-1 overflow-hidden rounded-full bg-bar">
                      <span
                        className={cn(
                          "block h-full rounded-full transition-[width] duration-500",
                          best.share === k ? "bg-good" : "bg-dim",
                        )}
                        style={{ width: `${(shares[k] ?? 0) * 100}%` }}
                      />
                    </span>
                    {byQuestion && (
                      <StatLine
                        label="Items fully right"
                        info={INFO.whole}
                        value={`${s.fullyRight}/${rows.length}`}
                        best={best.whole === k}
                      />
                    )}
                  </>
                ) : (
                  <p className={cn(labelText, "mt-2 mb-3")}>No labels to score against</p>
                )}
                <StatLine
                  label="Average time"
                  info={INFO.average}
                  value={`${s.averageMs.toLocaleString()} ms`}
                  best={best.average === k}
                />
                <StatLine
                  label="Median time"
                  info={INFO.median}
                  value={`${s.medianMs.toLocaleString()} ms`}
                  best={best.median === k}
                />
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
