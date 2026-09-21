import { cn, labelText, monoDim, panelBox, tableCell, tableHead } from "../styles";
import type { RunKind, SavedRun } from "../types";
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

const runTime = (name: string) => name.slice(5, 16).replace(/-(\d\d)-(\d\d)$/, " $1:$2");

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
  backendLabel: (id: string, kind: RunKind) => string;
}

export function PastRuns(props: PastRunsProps) {
  const { runs, kind } = props;
  const matching = runs.filter((run) => !kind || run.mode === kind);
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
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={tableHead}>When</th>
              <th className={tableHead}>Input</th>
              <th className={tableHead}>Models</th>
              <th className={tableHead}>Items</th>
            </tr>
          </thead>
          <tbody>
            {props.loading &&
              ["a", "b", "c", "d", "e", "f"].map((key) => (
                <tr key={key}>
                  {["w-20", "w-32", "w-56", "w-8"].map((width) => (
                    <td key={width} className={tableCell}>
                      <Skeleton className={width} />
                    </td>
                  ))}
                </tr>
              ))}
            {!props.loading && shown.length === 0 && (
              <tr>
                <td colSpan={4} className={tableCell}>
                  Nothing saved yet{kind && " of this kind"}.
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
                    <span className={monoDim}>{runTime(run.name)}</span>
                  </td>
                  <td className={tableCell}>{run.dataset}</td>
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
