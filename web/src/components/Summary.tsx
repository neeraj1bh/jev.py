import { motion } from "motion/react";

import { dollars, dollarText } from "../backends";
import { makerIcon } from "../logos";
import { answerLabel, percent, scoreResponse } from "../scoring";
import { cn, inset, labelText, rankChip, shell, tableCell } from "../styles";
import type { Answer, Backend, Row } from "../types";
import { FluxBar } from "./FluxBar";
import { Icon } from "./Icon";
import { InfoTip } from "./InfoTip";
import { Tip } from "./Tip";

interface ColumnStats {
  correct: number;
  total: number;
  averageMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Dollars billed, when the provider said so for every answer. */
  billed: number | null;
}

function columnStats(rows: Row[], column: number): ColumnStats {
  let correct = 0;
  let total = 0;
  let ms = 0;
  let answered = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let billed: number | null = null;
  let unbilled = false;
  for (const row of rows) {
    const side = row.sides[column];
    if (!side) continue;
    const [c, n] = scoreResponse(side.response, row.item.truth);
    correct += c;
    total += n;
    ms += side.ms;
    answered++;
    inputTokens += side.response.usage?.input_tokens ?? 0;
    outputTokens += side.response.usage?.output_tokens ?? 0;
    // a failed request has no usage and no bill, so it is left out rather than counted unknown
    const cost = side.response.usage?.cost;
    if (typeof cost === "number") billed = (billed ?? 0) + cost;
    else if (side.response.usage) unbilled = true;
  }
  return {
    correct,
    total,
    averageMs: answered ? Math.round(ms / answered) : 0,
    inputTokens,
    outputTokens,
    billed: unbilled ? null : billed,
  };
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
  correctness:
    "How often the model's answer matched the dataset's own label, which people wrote. The bar is filled that far out of 100%.",
  average: "Time from sending the item to getting every answer back, averaged over the batch.",
  cost: "What the run cost: the provider's own bill where it gives one (OpenRouter), otherwise ~ its reported tokens at today's list price, which cached input can make lower. Models on this machine are free.",
};

interface Cost {
  dollars: number;
  /** An estimate from tokens and list price, not the provider's bill. */
  estimate: boolean;
}

/** What a column's run cost, or null when its price or token counts are unknown. */
function columnCost(backend: Backend | undefined, s: ColumnStats): Cost | null {
  if (s.billed !== null) return { dollars: s.billed, estimate: false };
  if (!backend) return null;
  if (backend.group === "local" || backend.free) return { dollars: 0, estimate: false };
  const listed = s.inputTokens ? dollars(backend, s.inputTokens, s.outputTokens) : null;
  return listed === null ? null : { dollars: listed, estimate: true };
}

function costText(cost: Cost | null) {
  if (!cost) return "—";
  if (cost.dollars === 0) return "free";
  const text = cost.dollars < 0.01 ? "<$0.01" : dollarText(cost.dollars);
  return cost.estimate ? `~${text}` : text;
}

/** The smallest of 1, 2, 2.5 or 5 times a power of ten that holds the value: what a full bar
 * stands for. Bars keep this scale while values arrive and only re-scale when one outgrows it. */
function fullBar(value: number) {
  if (value <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 2.5, 5].find((step) => step * power >= value) ?? 10) * power;
}

const head =
  "px-2 py-2 text-left text-[13px] font-semibold text-ink shadow-[inset_0_-1px_0_var(--color-rule)]";

interface SummaryTableProps {
  rows: Row[];
  columns: string[];
  priceOf: (column: string) => Backend | undefined;
  /** Rows are still arriving: the bars grow with them instead of drawing in once. */
  live?: boolean;
}

/** Every model in one row, fastest first: its average time, what it cost and how often it was
 * right, each as a bar. The same table while a batch runs, replays and once it is done. */
export function SummaryTable({ rows, columns, priceOf, live = false }: SummaryTableProps) {
  const stats = columns.map((_, k) => columnStats(rows, k));
  const costs = columns.map((column, k) => columnCost(priceOf(column), stats[k] as ColumnStats));
  const labelled = rows.some((row) => Object.keys(row.item.truth).length > 0);
  const shares = stats.map((s) => (s.total ? s.correct / s.total : 0));
  const times = stats.map((s) => s.averageMs);
  const fullTime = fullBar(Math.max(0, ...times));
  // an unknown cost has no bar
  const fullCost = fullBar(Math.max(0, ...costs.map((cost) => cost?.dollars ?? 0)));
  // a model with no answer yet waits at the bottom rather than leading on a time of zero
  const order = columns
    .map((_, k) => k)
    .sort(
      (a, b) => (times[a] || Number.POSITIVE_INFINITY) - (times[b] || Number.POSITIVE_INFINITY),
    );
  /** A column of bars: its name and, once there is one, what a full bar stands for. */
  const heading = (label: string, info: string, full: string) => (
    <th className={cn(head, "w-[22%]")}>
      <span className="inline-flex items-center gap-1">
        {label}
        <InfoTip>{info}</InfoTip>
        {full && (
          <span className="ml-1 font-mono text-[11px] font-normal text-dim tabular-nums">
            0–{full}
          </span>
        )}
      </span>
    </th>
  );
  const bar = (share: number, text: string) => (
    <td className={cn(tableCell, "max-w-none py-2.5 align-middle!")}>
      <span className="flex items-center gap-3">
        <span aria-hidden className="w-32 flex-none">
          <FluxBar share={share} label={text} settled={!live} className="h-3" />
        </span>
        <span className="font-mono text-xs text-ink tabular-nums">{text}</span>
      </span>
    </td>
  );

  return (
    <table className="w-full min-w-[640px] border-collapse text-[13px]">
      <thead>
        <tr>
          <th className={cn(head, "w-8")}>#</th>
          <th className={head}>Model</th>
          {heading("Average time", INFO.average, fullTime ? `${fullTime.toLocaleString()} ms` : "")}
          {heading("Cost", INFO.cost, fullCost ? dollarText(fullCost) : "")}
          {labelled && heading("Correctness", INFO.correctness, "100%")}
        </tr>
      </thead>
      <tbody>
        {order.map((k, place) => {
          const s = stats[k];
          const column = columns[k];
          if (!s || column === undefined) return null;
          const cost = costs[k] ?? null;
          const Mark = makerIcon(column);
          return (
            <motion.tr
              key={column}
              layout
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
            >
              <td className={cn(tableCell, "align-middle!")}>
                <span className={rankChip(place + 1)}>{place + 1}</span>
              </td>
              <Tip content={column}>
                <td className={cn(tableCell, "align-middle! font-semibold text-ink")}>
                  <span className="flex items-center gap-2">
                    {Mark && <Icon icon={Mark} size={16} />}
                    <span className="truncate">{column}</span>
                  </span>
                </td>
              </Tip>
              {bar(
                fullTime ? s.averageMs / fullTime : 0,
                s.averageMs ? `${s.averageMs.toLocaleString()} ms` : "—",
              )}
              {bar(fullCost && cost ? cost.dollars / fullCost : 0, costText(cost))}
              {labelled && bar(shares[k] ?? 0, s.total ? percent(s.correct, s.total) : "—")}
            </motion.tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface SummaryProps {
  rows: Row[];
  columns: string[];
  dataset: string;
  priceOf: (column: string) => Backend | undefined;
}

/** A finished batch: its name and size, how often the models agreed, and the table. */
export function Summary({ rows, columns, dataset, priceOf }: SummaryProps) {
  if (rows.length === 0) return null;
  const byQuestion = Object.keys(rows[0]?.item.questions ?? {}).length > 1;
  return (
    <section className="mb-3.5 animate-fade motion-reduce:animate-none">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="m-0 text-sm font-semibold text-ink">
          {dataset}{" "}
          <span className="font-normal text-dim">
            · {rows.length} {rows.length === 1 ? "item" : "items"}
          </span>
        </h2>
        {columns.length > 1 && (
          <p className={cn(labelText, "m-0")}>
            {columns.length > 2 ? `All ${columns.length} gave` : "They gave"} the same answer on{" "}
            {agreementRate(rows)} of {byQuestion ? "questions" : "items"}
          </p>
        )}
      </div>
      <div className={shell}>
        <div className={cn(inset, "overflow-x-auto px-4 pt-2 pb-2")}>
          <SummaryTable rows={rows} columns={columns} priceOf={priceOf} />
        </div>
      </div>
    </section>
  );
}
