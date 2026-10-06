import { expect, it } from "vitest";

import { mergeRuns } from "./savedRuns";
import type { SavedRun, Side } from "./types";

const side = (ms: number): Side => ({ ms, response: { answers: {} } });

/** One saved row, as fetchRun returns it; start and at are missing from older runs. */
const stored = (n: number, sides: Record<string, Side>) => ({
  item: { source: `row ${n}`, state: { text: n }, questions: {}, truth: {} },
  start: undefined,
  at: undefined,
  sides,
});

const runA: SavedRun = {
  name: "run-a",
  mode: "cmp",
  dataset: "X",
  backends: ["m1", "m2"],
  items: 2,
};
const runB: SavedRun = { name: "run-b", mode: "cmp", dataset: "X", backends: ["m1"], items: 1 };

it("gives a model in both runs a column per run, and joins rows by item", () => {
  const { columns, rows } = mergeRuns(
    [runA, runB],
    [
      [stored(1, { m1: side(1), m2: side(2) }), stored(2, { m1: side(3), m2: side(4) })],
      [stored(1, { m1: side(5) })],
    ],
  );
  expect(columns.map((column) => column.id)).toEqual(["m1@run-a", "m2", "m1@run-b"]);
  expect(rows.map((row) => [row.item.source, Object.keys(row.sides)])).toEqual([
    ["row 1", ["m1@run-a", "m2", "m1@run-b"]],
    ["row 2", ["m1@run-a", "m2"]],
  ]);
});
