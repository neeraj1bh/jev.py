import { CheckIcon, GaugeIcon, StackIcon, TrophyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { fetchPresets, type Preset } from "../../lib/api";
import {
  dollarText,
  isOffline,
  itemsDollars,
  providerName,
  runDollars,
  statusText,
} from "../../lib/backends";
import { percent } from "../../lib/scoring";
import {
  cn,
  labelText,
  numberInput,
  rankChip,
  solidButton,
  tableCell,
  tableHead,
} from "../../lib/styles";
import type { Backend, Dataset, RunKind, SavedRun } from "../../lib/types";
import { type LocalModelActions, ModelMenu } from "../models/ModelMenu";
import { PickedModels } from "../models/ModelsPicker";
import { type KindFilter, RunFilter } from "../past/RunFilter";
import { DatasetMenu } from "../run/DatasetMenu";
import { EmptyState } from "../ui/EmptyState";
import { Icon } from "../ui/Icon";
import { Dropdown } from "../ui/Menu";
import { Surface } from "../ui/Surface";

const FREE = "free";
const TOP_MAKERS = 6; // the rest are one click away in the model menu, under their maker

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

interface MakerChipProps {
  label: string;
  count: number;
  on: boolean;
  onToggle: () => void;
}

function MakerChip({ label, count, on, onToggle }: MakerChipProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-transparent px-3 py-1 text-[13.5px] transition-colors",
        on ? "border-ink text-ink" : "border-rule text-dim hover:border-dim hover:text-ink",
      )}
    >
      {on && <Icon icon={CheckIcon} size={14} />}
      {label}
      <span className="font-mono text-xs text-dim tabular-nums">{count}</span>
    </button>
  );
}

interface BenchmarkProps {
  backends: Backend[];
  datasets: Dataset[];
  runs: SavedRun[];
  backendLabel: (id: string, kind: RunKind) => string;
  onSetUp: (models: string[], dataset: string, items: number) => void;
  local: LocalModelActions;
}

export function Benchmark(props: BenchmarkProps) {
  const { backends, datasets, runs, backendLabel, onSetUp, local } = props;
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
  const [picked, setPicked] = useState<string[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  useEffect(() => {
    fetchPresets().then(setPresets);
  }, []);
  const known = new Set(backends.map((backend) => backend.id));
  // The page lists one llama.cpp server, not each GGUF in a list, so only listed models count.
  const pickable = (preset: Preset) => preset.models.filter((id) => known.has(id));
  const presetOn = (preset: Preset) => pickable(preset).every((id) => picked.includes(id));
  const [menu, setMenu] = useState("");
  const menuHandler = (name: string) => (open: boolean) => setMenu(open ? name : "");
  const [dataset, setDataset] = useState("");
  const set = dataset || (datasets[0]?.name ?? "");
  const chosenSet = datasets.find((candidate) => candidate.name === set);
  const sizeNote = chosenSet?.tokens
    ? `, about ${chosenSet.tokens.toLocaleString("en-US")} input tokens each`
    : "";
  const [chosenItems, setItems] = useState(50);
  const items = chosenSet?.items ?? chosenItems; // a frozen benchmark is always asked whole
  const chosen = backends.filter((backend) => picked.includes(backend.id));
  const toggleModel = (id: string) =>
    setPicked((all) => (all.includes(id) ? all.filter((other) => other !== id) : [...all, id]));
  const makerIds = (maker: string) =>
    gateway
      .filter((backend) => (maker === FREE ? backend.free : backend.provider === maker))
      .map((backend) => backend.id);
  const makerOn = (maker: string) => makerIds(maker).every((id) => picked.includes(id));
  const toggleMaker = (maker: string) => {
    const ids = makerIds(maker);
    const on = makerOn(maker);
    setPicked((all) =>
      on ? all.filter((id) => !ids.includes(id)) : [...new Set([...all, ...ids])],
    );
  };
  // Models on this machine cost nothing; hosted ones without a listed price are named, not guessed.
  const onMachine = (backend: Backend) => backend.group === "local" || backend.group === "server";
  const unpriced = chosen.filter((backend) => !onMachine(backend) && runDollars(backend) === null);
  const dollars = chosen.reduce(
    (sum, backend) =>
      sum + (onMachine(backend) ? 0 : (itemsDollars(backend, items, chosenSet) ?? 0)),
    0,
  );
  const unpricedNote = unpriced.length
    ? `; ${unpriced.map((backend) => backend.label).join(", ")} ${unpriced.length === 1 ? "has no listed price here and is" : "have no listed price here and are"} not counted`
    : "";

  const inputs = [...new Set(runs.map((run) => run.dataset))];
  const [chosenBoard, setBoard] = useState("");
  // Past runs may arrive after the tab opens, so the default is picked from whatever is there now.
  const board = inputs.includes(chosenBoard)
    ? chosenBoard
    : inputs.includes("Frozen eval set")
      ? "Frozen eval set"
      : (inputs[0] ?? "");
  const [boardKind, setBoardKind] = useState<KindFilter>("");
  const table = standings(
    runs.filter((run) => !boardKind || run.mode === boardKind),
    board,
    backendLabel,
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5">
      <Surface
        icon={GaugeIcon}
        title={
          <>
            Benchmark{" "}
            <span className={cn(labelText, "font-normal")}>
              many models, one set · the cost is shown before anything runs
            </span>
          </>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Dropdown
            open={menu === "models"}
            onOpenChange={menuHandler("models")}
            icon={picked.length ? undefined : StackIcon}
            buttonClassName={cn("max-w-[min(560px,80vw)]", picked.length > 0 && "pl-1")}
            menuClassName="w-[360px]"
            button={<PickedModels picked={chosen} />}
          >
            <ModelMenu
              backends={backends}
              showChecks
              hint="Any number · click to add or remove"
              isSelected={(backend) => picked.includes(backend.id)}
              isDisabled={isOffline}
              detail={statusText}
              onSelect={toggleModel}
              lists={presets.map((preset) => ({
                name: preset.name,
                count: pickable(preset).length,
                on: presetOn(preset),
                // Lists add to the picks and remove only their own, so several can be on at once.
                onToggle: () => {
                  const models = pickable(preset);
                  if (presetOn(preset)) {
                    setPicked(picked.filter((id) => !models.includes(id)));
                    return;
                  }
                  setPicked([...picked, ...models.filter((id) => !picked.includes(id))]);
                  setDataset(preset.dataset);
                },
              }))}
              {...local}
            />
          </Dropdown>
          <DatasetMenu
            datasets={datasets}
            value={set}
            onChange={(name) => {
              setDataset(name);
              setMenu("");
            }}
            pickedBackends={chosen}
            open={menu === "set"}
            onOpenChange={menuHandler("set")}
          />
          {chosenSet?.items ? (
            <span className={labelText}>
              all {chosenSet.items.toLocaleString("en-US")} items, the same for every model
            </span>
          ) : (
            <>
              <input
                type="number"
                min={1}
                value={items}
                onChange={(event) => setItems(Math.max(1, Number(event.target.value) || 1))}
                aria-label="Items per model"
                className={numberInput}
              />
              <span className={labelText}>items each</span>
            </>
          )}
        </div>
        {makers.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={labelText}>Add all from</span>
            {freeCount > 0 && (
              <MakerChip
                label="Free"
                count={freeCount}
                on={makerOn(FREE)}
                onToggle={() => toggleMaker(FREE)}
              />
            )}
            {makers.map(([maker, count]) => (
              <MakerChip
                key={maker}
                label={providerName(maker)}
                count={count}
                on={makerOn(maker)}
                onToggle={() => toggleMaker(maker)}
              />
            ))}
            {picked.length > 0 && (
              <button
                type="button"
                className="border-0 bg-transparent px-1.5 py-1 text-[13px] text-dim hover:text-ink"
                onClick={() => setPicked([])}
              >
                Clear
              </button>
            )}
          </div>
        )}
        <p className="mt-4 mb-3 font-mono text-[28px] leading-none font-semibold text-ink tabular-nums">
          {picked.length ? `≈ ${dollarText(dollars)}` : "—"}
        </p>
        <p className={cn(labelText, "mb-4")}>
          {picked.length
            ? `${picked.length} models × ${items} items${sizeNote}. Models on this machine and free ones cost nothing${unpricedNote}.`
            : "Pick models to see what the run would cost."}
        </p>
        <button
          type="button"
          className={solidButton}
          disabled={!picked.length || !set}
          onClick={() => onSetUp(picked, set, items)}
        >
          Set up in Compare
        </button>
        <span className={cn(labelText, "ml-3")}>
          nothing is sent until you press Run batch there
        </span>
      </Surface>

      <Surface
        icon={TrophyIcon}
        title={
          <>
            Leaderboard{" "}
            <span className={cn(labelText, "font-normal")}>
              from Past runs · each model's largest run on the set
            </span>
          </>
        }
        aside={
          <RunFilter
            runs={runs}
            kind={boardKind}
            onKindChange={(kind) => {
              setBoardKind(kind);
              setMenu("");
            }}
            set={board}
            onSetChange={(name) => {
              setBoard(name);
              setMenu("");
            }}
            allSets={false}
            open={menu === "board"}
            onOpenChange={menuHandler("board")}
          />
        }
      >
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
                  <td colSpan={5}>
                    <EmptyState icon={TrophyIcon} title="Nothing to rank yet">
                      Run a batch on this set and every model in it is ranked here, best first.
                    </EmptyState>
                  </td>
                </tr>
              )}
              {table.map((standing, k) => (
                <tr key={standing.name}>
                  <td className={tableCell}>
                    <span className={rankChip(k + 1)}>{k + 1}</span>
                  </td>
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
      </Surface>
    </div>
  );
}
