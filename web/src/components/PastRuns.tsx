import {
  ArrowDown,
  ArrowsDownUp,
  ArrowsSplit,
  ArrowUp,
  ClockCounterClockwise,
  Columns,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  Trophy,
} from "@phosphor-icons/react";
import { useState } from "react";

import { usePersistentState } from "../hooks/usePersistentState";
import { chipButton, cn, labelText, monoDim, tableCell, tableHead } from "../styles";
import type { RunKind, SavedRun } from "../types";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { type KindFilter, RunFilter } from "./RunFilter";
import { Skeleton } from "./Skeleton";
import { Surface } from "./Surface";
import { Tip } from "./Tip";

export type { KindFilter } from "./RunFilter";

const PAGE_SIZE = 20;
const SHOWN_MODELS = 3; // the rest sit behind "+N more", so a row never wraps or cuts a score
const pagerButton =
  "rounded-md border border-rule bg-transparent px-3 py-1.5 text-ink hover:enabled:border-dim max-[600px]:min-h-11 max-[600px]:flex-1";

const accuracy = (run: SavedRun, backend: string) => {
  const [correct, total] = run.score?.[backend] ?? [0, 0];
  return total ? correct / total : -1;
};

type SortColumn = "when" | "input" | "models" | "items";
interface Sort {
  column: SortColumn;
  descending: boolean;
}

const isSort = (value: unknown): value is Sort =>
  typeof value === "object" &&
  value !== null &&
  ["when", "input", "models", "items"].includes((value as Sort).column) &&
  typeof (value as Sort).descending === "boolean";

/** Ascending order for one column; run names start with their timestamp, so they sort by time. */
function compare(a: SavedRun, b: SavedRun, column: SortColumn) {
  if (column === "input") return a.dataset.localeCompare(b.dataset);
  if (column === "models") return a.backends.length - b.backends.length;
  if (column === "items") return a.items - b.items;
  return a.name.localeCompare(b.name);
}

export /** Whether two runs have an item in common; a big run and a small one are checked when opened. */
function shareItems(a: SavedRun, b: SavedRun) {
  if (a.dataset !== b.dataset) return false;
  if (a.keys && b.keys) return a.keys.some((key) => b.keys?.includes(key));
  if (a.digest && b.digest) return a.digest === b.digest;
  return true;
}

const STAMP = /^(\d{4})-(\d\d)-(\d\d)-(\d\d)-(\d\d)-(\d\d)/;
const SHORT_TIME = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const FULL_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "long" });

/** A saved run's name starts with the UTC time it was saved at. */
function runDate(name: string) {
  const parts = STAMP.exec(name)?.slice(1).map(Number);
  if (!parts || parts.length < 6) return null;
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = parts;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

/** When a run was saved, in the viewer's own time zone and clock style. */
export const runTime = (name: string) => {
  const date = runDate(name);
  return date ? SHORT_TIME.format(date) : name;
};

const runTimeInFull = (name: string) => {
  const date = runDate(name);
  return date ? FULL_TIME.format(date) : undefined;
};

interface PastRunsProps {
  runs: SavedRun[];
  loading: boolean;
  page: number;
  kind: KindFilter;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onKindChange: (kind: KindFilter) => void;
  onPageChange: (page: number) => void;
  onOpenRun: (name: string) => void;
  onCompareRuns: (names: string[]) => void;
  backendLabel: (id: string, kind: RunKind) => string;
}

export function PastRuns(props: PastRunsProps) {
  const { runs, kind } = props;
  const [sort, setSort] = usePersistentState<Sort>(
    "runs-sort",
    { column: "when", descending: true },
    isSort,
  );
  const [query, setQuery] = useState("");
  const [set, setSet] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const pickedRuns = runs.filter((run) => picked.includes(run.name));
  const canPick = (run: SavedRun) => pickedRuns.every((other) => shareItems(run, other));
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const searchText = (run: SavedRun) =>
    [
      run.dataset,
      run.item ?? "",
      runTime(run.name),
      ...run.backends.flatMap((backend) => [backend, props.backendLabel(backend, run.mode)]),
    ]
      .join(" ")
      .toLowerCase();
  const togglePicked = (name: string) =>
    setPicked((names) =>
      names.includes(name) ? names.filter((other) => other !== name) : [...names, name],
    );
  const matching = runs
    .filter((run) => (!kind || run.mode === kind) && (!set || run.dataset === set))
    .filter((run) => words.every((word) => searchText(run).includes(word)))
    .sort((a, b) => (sort.descending ? -1 : 1) * compare(a, b, sort.column));
  const header = (column: SortColumn, label: string) => {
    const active = sort.column === column;
    return (
      <th
        className={cn(tableHead, column === "items" && "text-right")}
        aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
      >
        <button
          type="button"
          onClick={() =>
            setSort({ column, descending: active ? !sort.descending : column !== "input" })
          }
          className={cn(
            "group inline-flex items-center gap-1 border-0 bg-transparent p-0 font-medium transition-colors hover:text-ink",
            active ? "text-ink" : "text-dim",
          )}
        >
          {label}
          <Icon
            icon={active ? (sort.descending ? ArrowDown : ArrowUp) : ArrowsDownUp}
            size={14}
            className={cn(!active && "opacity-40 transition-opacity group-hover:opacity-100")}
          />
        </button>
      </th>
    );
  };
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const page = Math.min(props.page, pageCount);
  const shown = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const first = (page - 1) * PAGE_SIZE + 1;

  return (
    <Surface
      icon={ClockCounterClockwise}
      bodyClassName="flex flex-col"
      title={
        <>
          Past runs{" "}
          <span className={cn(labelText, "font-normal")}>
            saved in results/logs/demo · opening one sends no requests
          </span>
        </>
      }
      aside={
        <div className="flex flex-wrap items-center gap-2">
          {picked.length > 0 && (
            <>
              <button
                type="button"
                className={chipButton(picked.length >= 2)}
                disabled={picked.length < 2}
                onClick={() => props.onCompareRuns(picked)}
              >
                {picked.length < 2 ? "Pick one more to compare" : `Compare ${picked.length} runs`}
              </button>
              <button type="button" className={chipButton()} onClick={() => setPicked([])}>
                Clear
              </button>
            </>
          )}
          <label className="flex items-center gap-2 rounded-md border border-rule bg-paper px-2.5 py-1.5 text-dim focus-within:border-dim">
            <Icon icon={MagnifyingGlass} size={14} />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                props.onPageChange(1);
              }}
              placeholder="Search input, model or date"
              aria-label="Search past runs"
              className="w-52 border-0 bg-transparent p-0 text-sm text-ink outline-none placeholder:text-dim max-[600px]:w-full"
            />
          </label>
          <RunFilter
            runs={runs}
            kind={kind}
            onKindChange={props.onKindChange}
            set={set}
            onSetChange={(name) => {
              setSet(name);
              props.onPageChange(1);
              props.onMenuOpenChange(false);
            }}
            allSets
            open={props.menuOpen}
            onOpenChange={props.onMenuOpenChange}
          />
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={tableHead}>
                <span className="sr-only">Pick to compare</span>
              </th>
              {header("when", "When")}
              {header("input", "Input")}
              {header("models", "Models")}
              {header("items", "Items")}
            </tr>
          </thead>
          <tbody>
            {props.loading &&
              ["a", "b", "c", "d", "e", "f"].map((key) => (
                <tr key={key}>
                  {["w-4", "w-20", "w-32", "w-56", "w-8"].map((width) => (
                    <td key={width} className={tableCell}>
                      <Skeleton className={width} />
                    </td>
                  ))}
                </tr>
              ))}
            {!props.loading && shown.length === 0 && (
              <tr>
                <td colSpan={5}>
                  {runs.length === 0 ? (
                    <EmptyState
                      icon={ClockCounterClockwise}
                      around={[Columns, ArrowsSplit, Trophy]}
                      title="No runs yet"
                    >
                      Every batch you run in Compare, Generate vs readout or Benchmark is saved
                      here, and reopens without sending a request.
                    </EmptyState>
                  ) : (
                    <EmptyState
                      icon={MagnifyingGlassMinus}
                      title="No run matches"
                      action={{
                        label: "Clear search and filters",
                        onClick: () => {
                          setQuery("");
                          setSet("");
                          props.onKindChange("");
                        },
                      }}
                    >
                      Nothing saved fits {words.length ? `"${query}"` : "this filter"}
                      {words.length && (kind || set) ? " with this filter" : ""}.
                    </EmptyState>
                  )}
                </td>
              </tr>
            )}
            {shown.map((run) => {
              const best = Math.max(...run.backends.map((backend) => accuracy(run, backend)));
              const singleBest =
                run.backends.filter((backend) => accuracy(run, backend) === best).length === 1;
              const score = (backend: string) => {
                const [correct, total] = run.score?.[backend] ?? [0, 0];
                const won = singleBest && total > 0 && accuracy(run, backend) === best;
                return (
                  <i className={cn("font-mono text-xs not-italic", won ? "text-good" : "text-dim")}>
                    {total ? `${((100 * correct) / total).toFixed(1)}%` : ""}
                  </i>
                );
              };
              return (
                <tr
                  key={run.name}
                  onClick={() => props.onOpenRun(run.name)}
                  className="cursor-pointer transition-colors hover:bg-lift [&>td:first-child]:rounded-l-md [&>td:last-child]:rounded-r-md"
                >
                  <td className={tableCell}>
                    <Tip
                      content={
                        picked.includes(run.name) || canPick(run)
                          ? "Pick runs that share items to compare them side by side"
                          : "No item in common with the runs already picked"
                      }
                    >
                      <span className="inline-flex">
                        <input
                          type="checkbox"
                          checked={picked.includes(run.name)}
                          disabled={!picked.includes(run.name) && !canPick(run)}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => togglePicked(run.name)}
                          aria-label={`Pick the ${run.dataset} run of ${runTime(run.name)} to compare`}
                          className="size-4 accent-current disabled:opacity-30"
                        />
                      </span>
                    </Tip>
                  </td>
                  <td className={tableCell}>
                    <Tip content={runTimeInFull(run.name)}>
                      <span className={cn(monoDim, "whitespace-nowrap")}>{runTime(run.name)}</span>
                    </Tip>
                  </td>
                  <td className={tableCell}>
                    {run.dataset}
                    {run.item && (
                      <Tip content={run.item}>
                        <span className={cn(monoDim, "ml-1.5")}>
                          {run.item
                            .split("·")
                            .pop()
                            ?.trim()
                            .replace(/^\w+ row/, "row")}
                        </span>
                      </Tip>
                    )}
                  </td>
                  <td className={cn(tableCell, "max-w-none")}>
                    {run.backends.slice(0, SHOWN_MODELS).map((backend) => (
                      <span key={backend} className="mr-3.5 whitespace-nowrap">
                        {props.backendLabel(backend, run.mode)} {score(backend)}
                      </span>
                    ))}
                    {run.backends.length > SHOWN_MODELS && (
                      <Tip
                        content={
                          <span className="grid gap-1">
                            {run.backends.slice(SHOWN_MODELS).map((backend) => (
                              <span key={backend} className="flex justify-between gap-5">
                                {props.backendLabel(backend, run.mode)} {score(backend)}
                              </span>
                            ))}
                          </span>
                        }
                      >
                        <span className="cursor-default text-[13px] text-dim transition-colors hover:text-ink">
                          · {run.backends.length - SHOWN_MODELS} more
                        </span>
                      </Tip>
                    )}
                  </td>
                  <td className={cn(tableCell, "text-right font-mono tabular-nums")}>
                    {run.items.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 pt-3 max-[600px]:flex-col max-[600px]:items-stretch">
        <span className={labelText}>
          {matching.length > 0 && `${first}–${first + shown.length - 1} of ${matching.length}`}
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            className={pagerButton}
            disabled={page <= 1}
            onClick={() => props.onPageChange(page - 1)}
          >
            ‹ Prev
          </button>
          <button
            type="button"
            className={pagerButton}
            disabled={page >= pageCount}
            onClick={() => props.onPageChange(page + 1)}
          >
            Next ›
          </button>
        </span>
      </div>
    </Surface>
  );
}
