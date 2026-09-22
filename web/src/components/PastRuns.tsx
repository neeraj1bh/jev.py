import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { useState } from "react";

import { usePersistentState } from "../hooks/usePersistentState";
import { chipButton, cn, labelText, monoDim, panelBox, tableCell, tableHead } from "../styles";
import type { RunKind, SavedRun } from "../types";
import { Icon } from "./Icon";
import { Dropdown, MenuItem } from "./Menu";
import { Skeleton } from "./Skeleton";

export type KindFilter = RunKind | "";

const KIND_LABELS: Record<KindFilter, string> = {
  "": "All runs",
  cmp: "Compare",
  gen: "Generate vs readout",
};
const PAGE_SIZE = 20;
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

export const runTime = (name: string) => name.slice(5, 16).replace(/-(\d\d)-(\d\d)$/, " $1:$2");

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
  const [picked, setPicked] = useState<string[]>([]);
  const pickedInput = runs.find((run) => run.name === picked[0])?.dataset;
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
    .filter((run) => !kind || run.mode === kind)
    .filter((run) => words.every((word) => searchText(run).includes(word)))
    .sort((a, b) => (sort.descending ? -1 : 1) * compare(a, b, sort.column));
  const header = (column: SortColumn, label: string) => {
    const active = sort.column === column;
    return (
      <th
        className={tableHead}
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
            icon={active ? (sort.descending ? ArrowDown : ArrowUp) : ArrowUpDown}
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
    <div className={cn(panelBox, "flex flex-col")}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-sm font-semibold text-ink">
          Past runs{" "}
          <span className={cn(labelText, "font-normal")}>
            saved in results/logs/demo · opening one sends no requests
          </span>
        </h2>
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
            <Icon icon={Search} size={14} />
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
          <Dropdown
            open={props.menuOpen}
            onOpenChange={props.onMenuOpenChange}
            button={KIND_LABELS[kind]}
            menuClassName="right-0 left-auto w-60"
          >
            {(Object.keys(KIND_LABELS) as KindFilter[]).map((option) => (
              <MenuItem
                key={option}
                label={KIND_LABELS[option]}
                detail={runs.filter((run) => !option || run.mode === option).length}
                selected={option === kind}
                onSelect={() => props.onKindChange(option)}
              />
            ))}
          </Dropdown>
        </div>
      </div>
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
                <td colSpan={5} className={tableCell}>
                  {words.length
                    ? "No run matches the search"
                    : `Nothing saved yet${kind && " of this kind"}`}
                  .
                </td>
              </tr>
            )}
            {shown.map((run) => {
              const best = Math.max(...run.backends.map((backend) => accuracy(run, backend)));
              const singleBest =
                run.backends.filter((backend) => accuracy(run, backend) === best).length === 1;
              return (
                <tr
                  key={run.name}
                  onClick={() => props.onOpenRun(run.name)}
                  className="cursor-pointer transition-colors hover:bg-lift [&>td:first-child]:rounded-l-md [&>td:last-child]:rounded-r-md"
                >
                  <td className={tableCell}>
                    <input
                      type="checkbox"
                      checked={picked.includes(run.name)}
                      disabled={
                        !picked.includes(run.name) && !!pickedInput && run.dataset !== pickedInput
                      }
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => togglePicked(run.name)}
                      aria-label={`Pick the ${run.dataset} run of ${runTime(run.name)} to compare`}
                      title="Runs on the same input can be compared"
                      className="size-4 accent-current disabled:opacity-30"
                    />
                  </td>
                  <td className={tableCell}>
                    <span className={monoDim}>{runTime(run.name)}</span>
                  </td>
                  <td className={tableCell}>
                    {run.dataset}
                    {run.item && (
                      <span className={cn(monoDim, "ml-1.5")} title={run.item}>
                        {run.item
                          .split("·")
                          .pop()
                          ?.trim()
                          .replace(/^\w+ row/, "row")}
                      </span>
                    )}
                  </td>
                  <td className={tableCell}>
                    {run.backends.map((backend) => {
                      const [correct, total] = run.score?.[backend] ?? [0, 0];
                      const won = singleBest && total > 0 && accuracy(run, backend) === best;
                      return (
                        <span key={backend} className="mr-3.5 whitespace-nowrap">
                          {props.backendLabel(backend, run.mode)}{" "}
                          <i
                            className={cn(
                              "font-mono text-xs not-italic",
                              won ? "text-good" : "text-dim",
                            )}
                          >
                            {total ? `${((100 * correct) / total).toFixed(1)}%` : ""}
                          </i>
                        </span>
                      );
                    })}
                  </td>
                  <td className={tableCell}>{run.items}</td>
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
    </div>
  );
}
