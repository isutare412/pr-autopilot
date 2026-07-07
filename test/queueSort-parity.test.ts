import { describe, it, expect } from "vitest";
import * as core from "../src/main/core/queueSort";
import * as ui from "../src/renderer/src/queueSort";
import type { SortableRow } from "../src/main/core/queueSort";

const rows: SortableRow[] = [
  { key: "a", repo: "alpha", number: 2, updatedAt: "2026-01-01T00:00:00Z" },
  { key: "b", repo: "beta",  number: 1, updatedAt: "2026-03-01T00:00:00Z" },
  { key: "c", repo: "alpha", number: 5, updatedAt: "2026-02-01T00:00:00Z" },
  { key: "d", repo: "alpha", number: 2, updatedAt: "2026-01-01T00:00:00Z" },
];

describe("queueSort parity: core vs renderer copy", () => {
  for (const key of ["activity", "repo"] as const) {
    for (const dir of ["desc", "asc"] as const) {
      it(`orders identically for ${key}/${dir}`, () => {
        const c = core.sortRows(rows, { key, dir }).map((r) => r.key);
        const u = ui.sortRows(rows, { key, dir }).map((r) => r.key);
        expect(u).toEqual(c);
      });
    }
  }
});
