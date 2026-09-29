import { dollars, dollarText } from "../backends";
import { answerLabel, percent, scoreResponse } from "../scoring";
import { cn, inset, labelText, rankChip, shell, tableCell } from "../styles";
import type { Answer, Backend, Row } from "../types";
import { InfoTip } from "./InfoTip";
import { Tip } from "./Tip";

const DASHES = 60; // a long run is grouped into this many dashes, as a status page groups days

interface Dash {
  first: number;
  last: number;
  correct: number;
  total: number;
  averageMs: number;
}

interface ColumnStats {
  dashes: Dash[];
  averageMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Dollars billed, when the provider said so for every answer. */
  billed: number | null;
}

function columnStats(rows: Row[], column: number): ColumnStats {
  const size = Math.ceil(rows.length / DASHES);
  const dashes: Dash[] = [];
  let ms = 0;
  let answered = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let billed: number | null = null;
  let unbilled = false;
  rows.forEach((row, index) => {
    const side = row.sides[column];
    if (!side) return;
    if (index % size === 0)
      dashes.push({ first: index, last: index, correct: 0, total: 0, averageMs: 0 });
    const dash = dashes[dashes.length - 1] as Dash;
    const [c, n] = scoreResponse(side.response, row.item.truth);
    dash.correct += c;
    dash.total += n;
    // a running sum until the dash is closed below
    dash.averageMs += side.ms;
    dash.last = index;
    ms += side.ms;
    answered++;
    inputTokens += side.response.usage?.input_tokens ?? 0;
    outputTokens += side.response.usage?.output_tokens ?? 0;
    // a failed request has no usage and no bill, so it is left out rather than counted unknown
    const cost = side.response.usage?.cost;
    if (typeof cost === "number") billed = (billed ?? 0) + cost;
    else if (side.response.usage) unbilled = true;
  });
  for (const dash of dashes) dash.averageMs /= dash.last - dash.first + 1;
  return {
    dashes,
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

/** The middle time of every answer in the run, from every model: what "normal" means here. */
function runMedianMs(rows: Row[]) {
  const times = rows.flatMap((row) => row.sides.map((side) => side.ms)).sort((a, b) => a - b);
  return times[times.length >> 1] || 1;
}

// How much slower than the run's median a dash is before it changes colour, and to what.
const PACE = [
  { upTo: 1.5, fill: "bg-emerald-500", word: "normal" },
  { upTo: 3, fill: "bg-amber-400", word: "slower" },
  { upTo: 6, fill: "bg-orange-500", word: "slow" },
  { upTo: Number.POSITIVE_INFINITY, fill: "bg-rose-500", word: "very slow" },
];
const paceOf = (ms: number, normalMs: number) =>
  PACE.find((pace) => ms / normalMs <= pace.upTo) ?? (PACE.at(-1) as (typeof PACE)[number]);

const INFO = {
  correctness:
    "One dash per stretch of items, in order. Its height is how often the model matched the dataset's own label there; its colour is how long it took against this run's median time.",
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

/** Index of the single best value, or -1 when there is a tie. */
function bestIndex(values: number[], higherIsBetter: boolean) {
  const best = higherIsBetter ? Math.max(...values) : Math.min(...values);
  return values.filter((value) => value === best).length === 1 ? values.indexOf(best) : -1;
}

/** A status-page strip: a dash per stretch of items, as tall as the share right, coloured by pace. */
function DashStrip({
  dashes,
  normalMs,
  labelled,
}: {
  dashes: Dash[];
  normalMs: number;
  labelled: boolean;
}) {
  return (
    <span className="flex h-7 items-end gap-[2px]">
      {dashes.map((dash) => {
        const share = labelled && dash.total ? dash.correct / dash.total : 1;
        const pace = paceOf(dash.averageMs, normalMs);
        const items =
          dash.first === dash.last
            ? `Item ${dash.first + 1}`
            : `Items ${dash.first + 1}–${dash.last + 1}`;
        const right = labelled ? ` · ${dash.correct}/${dash.total} right` : "";
        return (
          <Tip
            key={dash.first}
            content={`${items}${right} · ${Math.round(dash.averageMs).toLocaleString()} ms, ${pace.word}`}
          >
            <span className="flex h-full max-w-3.5 min-w-[3px] flex-1 items-end rounded-[2px] bg-ink/[0.06]">
              <span
                className={cn("block w-full rounded-[2px]", pace.fill)}
                style={{ height: `${Math.max(share * 100, 12)}%` }}
              />
            </span>
          </Tip>
        );
      })}
    </span>
  );
}

const head =
  "px-2 py-2 text-left text-[13px] font-semibold text-ink shadow-[inset_0_-1px_0_var(--color-rule)]";

interface SummaryProps {
  rows: Row[];
  columns: string[];
  dataset: string;
  priceOf: (column: string) => Backend | undefined;
}

/** Every model in one table, best first: how often it was right, how fast, and what it cost. */
export function Summary({ rows, columns, dataset, priceOf }: SummaryProps) {
  if (rows.length === 0) return null;
  const stats = columns.map((_, k) => columnStats(rows, k));
  const costs = columns.map((column, k) => columnCost(priceOf(column), stats[k] as ColumnStats));
  const labelled = rows.some((row) => Object.keys(row.item.truth).length > 0);
  const byQuestion = Object.keys(rows[0]?.item.questions ?? {}).length > 1;
  const normalMs = runMedianMs(rows);
  const fastest = bestIndex(
    stats.map((s) => s.averageMs),
    false,
  );
  // an unknown cost never counts as cheapest
  const cheapest = bestIndex(
    costs.map((cost) => cost?.dollars ?? Number.POSITIVE_INFINITY),
    false,
  );
  const heading = (label: string, info: string, right = false) => (
    <th className={cn(head, right && "text-right")}>
      <span className="inline-flex items-center gap-1">
        {label}
        <InfoTip>{info}</InfoTip>
      </span>
    </th>
  );
  const number = (value: string, best: boolean) => (
    <td
      className={cn(
        tableCell,
        "align-middle text-right font-mono tabular-nums",
        best ? "text-good" : "text-ink",
      )}
    >
      {value}
    </td>
  );

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
        <div className={cn(inset, "overflow-x-auto px-4 pt-2 pb-3")}>
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={cn(head, "w-8")}>#</th>
                <th className={cn(head, "w-[28%]")}>Model</th>
                {heading(labelled ? "Correctness" : "Time per item", INFO.correctness)}
                {heading("Average time", INFO.average, true)}
                {heading("Cost", INFO.cost, true)}
              </tr>
            </thead>
            <tbody>
              {columns.map((column, k) => {
                const s = stats[k];
                if (!s) return null;
                return (
                  <tr key={column}>
                    <td className={cn(tableCell, "align-middle")}>
                      <span className={rankChip(k + 1)}>{k + 1}</span>
                    </td>
                    <Tip content={column}>
                      <td className={cn(tableCell, "align-middle font-semibold text-ink")}>
                        {column}
                      </td>
                    </Tip>
                    <td className={cn(tableCell, "w-[52%] max-w-none py-2 align-middle")}>
                      <DashStrip dashes={s.dashes} normalMs={normalMs} labelled={labelled} />
                    </td>
                    {number(`${s.averageMs.toLocaleString()} ms`, fastest === k)}
                    {number(costText(costs[k] ?? null), cheapest === k)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={cn(labelText, "mt-2.5 mb-0 flex flex-wrap items-center gap-x-3 gap-y-1")}>
            {labelled && <span>Taller is more often right.</span>}
            {PACE.map((pace) => (
              <span key={pace.word} className="inline-flex items-center gap-1.5">
                <span className={cn("size-2 rounded-[2px]", pace.fill)} />
                {pace.word}
              </span>
            ))}
            <span>against the run's median of {normalMs.toLocaleString()} ms</span>
          </p>
        </div>
      </div>
    </section>
  );
}
