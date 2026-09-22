import type { RunKind, SavedRun } from "../types";
import { Dropdown, MenuHeading, MenuItem } from "./Menu";

export type KindFilter = RunKind | "";

export const KIND_LABELS: Record<KindFilter, string> = {
  "": "All runs",
  cmp: "Compare",
  gen: "Generate vs readout",
};

const runCount = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;

interface RunFilterProps {
  runs: SavedRun[];
  kind: KindFilter;
  onKindChange: (kind: KindFilter) => void;
  /** The set shown; "" is every set, offered only when `allSets` is on. */
  set: string;
  onSetChange: (set: string) => void;
  allSets: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** One menu for which saved runs to show: their kind, then their set, each with its count. */
export function RunFilter({
  runs,
  kind,
  onKindChange,
  set,
  onSetChange,
  allSets,
  open,
  onOpenChange,
}: RunFilterProps) {
  const ofKind = (run: SavedRun) => !kind || run.mode === kind;
  const ofSet = (run: SavedRun) => !set || run.dataset === set;
  const sets = [...new Set(runs.map((run) => run.dataset))]
    .map(
      (name) => [name, runs.filter((run) => ofKind(run) && run.dataset === name).length] as const,
    )
    .sort((a, b) => b[1] - a[1]);
  const label =
    [set || (allSets ? "" : "No runs yet"), kind && KIND_LABELS[kind]]
      .filter(Boolean)
      .join(" · ") || KIND_LABELS[""];

  return (
    <Dropdown
      open={open}
      onOpenChange={onOpenChange}
      button={label}
      menuClassName="right-0 left-auto w-72"
    >
      <MenuHeading>Kind</MenuHeading>
      {(Object.keys(KIND_LABELS) as KindFilter[]).map((option) => (
        <MenuItem
          key={option || "all"}
          label={KIND_LABELS[option]}
          detail={runCount(
            runs.filter((run) => ofSet(run) && (!option || run.mode === option)).length,
          )}
          selected={option === kind}
          onSelect={() => onKindChange(option)}
        />
      ))}
      <MenuHeading>Set</MenuHeading>
      {allSets && (
        <MenuItem
          label="All sets"
          detail={runCount(runs.filter(ofKind).length)}
          selected={!set}
          onSelect={() => onSetChange("")}
        />
      )}
      {sets.map(([name, count]) => (
        <MenuItem
          key={name}
          label={name}
          detail={runCount(count)}
          selected={name === set}
          disabled={count === 0}
          onSelect={() => onSetChange(name)}
        />
      ))}
    </Dropdown>
  );
}
