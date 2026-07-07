import type { QueueSort } from "./schema";

export interface SortableRow {
  key: string;
  repo: string;
  number: number;
  updatedAt: string;
}

/** Compare two rows under the given sort. Direction flips the primary key only;
 *  ties break on `key` for a stable, direction-independent order. */
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

/** Return a new array sorted per `s`; never mutates `rows`. */
export function sortRows<T extends SortableRow>(rows: readonly T[], s: QueueSort): T[] {
  return [...rows].sort((a, b) => compareRows(a, b, s));
}
