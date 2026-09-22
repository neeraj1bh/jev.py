import { useState } from "react";

import { dollarText, providerName, RUN_QUESTIONS, runDollars } from "../backends";
import { percent } from "../scoring";
import {
  chipButton,
  cn,
  labelText,
  monoDim,
  panelBox,
  solidButton,
  tableCell,
  tableHead,
} from "../styles";
import type { Backend, Dataset, RunKind, SavedRun } from "../types";

const FREE = "free";
const TOP_MAKERS = 12;

interface Standing {
  name: string;
  correct: number;
  total: number;
  runs: number;
}

/**
 * Every model's score on one input, from its largest saved run (the latest on a tie). Runs of one
 * set overlap, like a many-model run and a single model's own, so adding them would count twice.
 */
function standings(
  runs: SavedRun[],
  input: string,
  label: (id: string, kind: RunKind) => string,
): Standing[] {
  const byName = new Map<string, Standing>();
  for (const run of runs) {
    if (run.dataset !== input) continue;
    for (const backend of run.backends) {
      const [correct, total] = run.score?.[backend] ?? [0, 0];
      const name = label(backend, run.mode);
      const standing = byName.get(name);
      const larger = !standing || total > standing.total; // runs arrive newest first
      byName.set(name, {
        name,
        correct: larger ? correct : standing.correct,
        total: larger ? total : standing.total,
        runs: (standing?.runs ?? 0) + 1,
      });
    }
  }
  const share = (s: Standing) => (s.total ? s.correct / s.total : -1);
  return [...byName.values()].sort((a, b) => share(b) - share(a) || b.total - a.total);
}

interface BenchmarkProps {
  backends: Backend[];
  datasets: Dataset[];
  runs: SavedRun[];
  backendLabel: (id: string, kind: RunKind) => string;
  onSetUp: (models: string[], dataset: string, items: number) => void;
}

export function Benchmark({ backends, datasets, runs, backendLabel, onSetUp }: BenchmarkProps) {
  const gateway = backends.filter((backend) => backend.group === "gateway");
  const makers = Object.entries(
    gateway.reduce<Record<string, number>>((counts, backend) => {
      const maker = backend.provider ?? "";
      counts[maker] = (counts[maker] ?? 0) + 1;
      return counts;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_MAKERS);
  const freeCount = gateway.filter((backend) => backend.free).length;
  const [groups, setGroups] = useState<string[]>([]);
  const [dataset, setDataset] = useState(datasets[0]?.name ?? "");
  const [items, setItems] = useState(50);
  const picked = gateway.filter((backend) =>
    groups.some((group) => (group === FREE ? backend.free : backend.provider === group)),
  );
  const prices = picked.map(runDollars);
  const unknown = prices.filter((dollars) => dollars === null).length;
  const dollars =
    prices.reduce<number>((sum, run) => sum + (run ?? 0), 0) * (items / RUN_QUESTIONS);
  const toggle = (group: string) =>
    setGroups((all) => (all.includes(group) ? all.filter((g) => g !== group) : [...all, group]));

  const inputs = [...new Set(runs.map((run) => run.dataset))];
  const [chosenBoard, setBoard] = useState("");
  // Past runs may arrive after the tab opens, so the default is picked from whatever is there now.
  const board = inputs.includes(chosenBoard)
    ? chosenBoard
    : inputs.includes("Frozen eval set")
      ? "Frozen eval set"
      : (inputs[0] ?? "");
  const table = standings(runs, board, backendLabel);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
      <section className={panelBox}>
        <h2 className="m-0 text-sm font-semibold text-ink">
          Benchmark{" "}
          <span className={cn(labelText, "font-normal")}>
            many models, one set · the cost is shown before anything runs
          </span>
        </h2>
        <p className={cn(labelText, "mt-3 mb-2")}>OpenRouter models</p>
        <div className="flex flex-wrap gap-2">
          {freeCount > 0 && (
            <button
              type="button"
              className={chipButton(groups.includes(FREE))}
              onClick={() => toggle(FREE)}
            >
              All free · {freeCount}
            </button>
          )}
          {makers.map(([maker, count]) => (
            <button
              key={maker}
              type="button"
              className={chipButton(groups.includes(maker))}
              onClick={() => toggle(maker)}
            >
              {providerName(maker)} · {count}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={dataset}
            onChange={(event) => setDataset(event.target.value)}
            aria-label="Set to run"
            className="rounded-full border border-rule bg-paper px-3 py-1 text-[13.5px] text-ink"
          >
            {datasets.map((set) => (
              <option key={set.name}>{set.name}</option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={items}
            onChange={(event) => setItems(Math.max(1, Number(event.target.value) || 1))}
            aria-label="Items per model"
            className="w-20 rounded-full border border-rule bg-paper px-2 py-1 text-center font-mono text-[13.5px] text-ink"
          />
          <span className={labelText}>items each</span>
        </div>
        <p className="mt-4 mb-3 font-mono text-[28px] leading-none font-semibold text-ink tabular-nums">
          {picked.length ? `≈ ${dollarText(dollars)}` : "—"}
        </p>
        <p className={cn(labelText, "mb-4")}>
          {picked.length
            ? `${picked.length} models × ${items} items${unknown ? ` · ${unknown} without a listed price, not counted` : ""}. Free models cost nothing but are rate-limited.`
            : "Pick a group of models to see what the run would cost."}
        </p>
        <button
          type="button"
          className={solidButton}
          disabled={!picked.length || !dataset}
          onClick={() =>
            onSetUp(
              picked.map((backend) => backend.id),
              dataset,
              items,
            )
          }
        >
          Set up in Compare
        </button>
        <span className={cn(labelText, "ml-3")}>
          nothing is sent until you press Run batch there
        </span>
      </section>

      <section className={panelBox}>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="m-0 text-sm font-semibold text-ink">
            Leaderboard{" "}
            <span className={cn(labelText, "font-normal")}>
              from Past runs · each model's largest run on the set
            </span>
          </h2>
          <select
            value={board}
            onChange={(event) => setBoard(event.target.value)}
            aria-label="Leaderboard set"
            className="rounded-full border border-rule bg-paper px-3 py-1 text-[13.5px] text-ink"
          >
            {inputs.map((input) => (
              <option key={input}>{input}</option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={tableHead}>#</th>
                <th className={tableHead}>Model</th>
                <th className={cn(tableHead, "text-right")}>Right</th>
                <th className={cn(tableHead, "text-right")}>Questions</th>
                <th className={cn(tableHead, "text-right")}>Runs</th>
              </tr>
            </thead>
            <tbody>
              {table.length === 0 && (
                <tr>
                  <td colSpan={5} className={tableCell}>
                    No saved run on this set yet.
                  </td>
                </tr>
              )}
              {table.map((standing, k) => (
                <tr key={standing.name}>
                  <td className={cn(tableCell, monoDim)}>{k + 1}</td>
                  <td className={tableCell}>{standing.name}</td>
                  <td
                    className={cn(
                      tableCell,
                      "text-right font-mono tabular-nums",
                      k === 0 && "text-good",
                    )}
                  >
                    {standing.total ? percent(standing.correct, standing.total) : "—"}
                  </td>
                  <td className={cn(tableCell, "text-right font-mono tabular-nums")}>
                    {standing.correct}/{standing.total}
                  </td>
                  <td className={cn(tableCell, "text-right font-mono tabular-nums")}>
                    {standing.runs}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
