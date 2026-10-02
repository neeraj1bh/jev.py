import type { fetchRun } from "./api";
import type { Item, SavedRun, Side } from "./types";

type StoredRow = Awaited<ReturnType<typeof fetchRun>>[number];

const itemKey = (item: Item) =>
  [item.source, JSON.stringify(item.state), JSON.stringify(item.questions)].join("|");

/** Saved runs as one table: a row per item, a column per model of each run. A model in more than
 * one of the runs gets a column per run, told apart by the run's name. */
export function mergeRuns(chosen: SavedRun[], everyRun: StoredRow[][]) {
  const repeated = (backend: string) =>
    chosen.filter((run) => run.backends.includes(backend)).length > 1;
  const columns = chosen.flatMap((run) =>
    run.backends.map((backend) => ({
      run,
      backend,
      id: repeated(backend) ? `${backend}@${run.name}` : backend,
    })),
  );
  const merged = new Map<string, { item: Item; sides: Record<string, Side> }>();
  everyRun.forEach((stored, k) => {
    for (const row of stored) {
      const entry = merged.get(itemKey(row.item)) ?? { item: row.item, sides: {} };
      for (const column of columns.filter((c) => c.run === chosen[k])) {
        const side = row.sides[column.backend];
        if (side) entry.sides[column.id] = side;
      }
      merged.set(itemKey(row.item), entry);
    }
  });
  return { columns, rows: [...merged.values()] };
}
