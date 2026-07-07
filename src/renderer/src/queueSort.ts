// Parallel copy of src/main/core/queueSort.ts (the UI bundle cannot import core/).
// Keep in sync; test/queueSort-parity.test.ts enforces identical ordering.
export type QueueSortKey = "activity" | "repo";
export type QueueSortDir = "asc" | "desc";
export interface QueueSort {
  key: QueueSortKey;
  dir: QueueSortDir;
}
export const DEFAULT_QUEUE_SORT: QueueSort = { key: "activity", dir: "desc" };

export interface SortableRow {
  key: string;
  repo: string;
  number: number;
  updatedAt: string;
}

export function compareRows(a: SortableRow, b: SortableRow, s: QueueSort): number {
  const dir = s.dir === "desc" ? -1 : 1;
  let primary: number;
  if (s.key === "activity") {
    primary = (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0);
  } else {
    primary = a.repo.localeCompare(b.repo) || a.number - b.number;
  }
  if (primary !== 0) return dir * primary;
  return a.key.localeCompare(b.key);
}

export function sortRows<T extends SortableRow>(rows: readonly T[], s: QueueSort): T[] {
  return [...rows].sort((a, b) => compareRows(a, b, s));
}
