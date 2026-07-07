import { describe, it, expect } from "vitest";
import { compareRows, sortRows, type SortableRow } from "../src/main/core/queueSort";

const row = (over: Partial<SortableRow>): SortableRow => ({
  key: "k", repo: "r", number: 1, updatedAt: "2026-01-01T00:00:00Z", ...over,
});

describe("queueSort", () => {
  const a = row({ key: "a", repo: "alpha", number: 2, updatedAt: "2026-01-01T00:00:00Z" });
  const b = row({ key: "b", repo: "beta",  number: 1, updatedAt: "2026-03-01T00:00:00Z" });
  const c = row({ key: "c", repo: "alpha", number: 5, updatedAt: "2026-02-01T00:00:00Z" });

  it("activity desc = newest first", () => {
    expect(sortRows([a, b, c], { key: "activity", dir: "desc" }).map((r) => r.key)).toEqual(["b", "c", "a"]);
  });
  it("activity asc = oldest first", () => {
    expect(sortRows([a, b, c], { key: "activity", dir: "asc" }).map((r) => r.key)).toEqual(["a", "c", "b"]);
  });
  it("repo asc = repo A->Z then number low->high", () => {
    expect(sortRows([a, b, c], { key: "repo", dir: "asc" }).map((r) => r.key)).toEqual(["a", "c", "b"]);
  });
  it("repo desc = repo Z->A then number high->low", () => {
    expect(sortRows([a, b, c], { key: "repo", dir: "desc" }).map((r) => r.key)).toEqual(["b", "c", "a"]);
  });
  it("breaks ties on key, independent of direction", () => {
    const x = row({ key: "x", repo: "same", number: 1, updatedAt: "2026-01-01T00:00:00Z" });
    const y = row({ key: "y", repo: "same", number: 1, updatedAt: "2026-01-01T00:00:00Z" });
    expect(sortRows([y, x], { key: "activity", dir: "desc" }).map((r) => r.key)).toEqual(["x", "y"]);
    expect(sortRows([y, x], { key: "activity", dir: "asc" }).map((r) => r.key)).toEqual(["x", "y"]);
  });
  it("coerces empty/invalid updatedAt to 0 without throwing", () => {
    const p = row({ key: "p", updatedAt: "" });
    const q = row({ key: "q", updatedAt: "2026-05-01T00:00:00Z" });
    expect(sortRows([p, q], { key: "activity", dir: "desc" }).map((r) => r.key)).toEqual(["q", "p"]);
  });
  it("does not mutate the input array", () => {
    const input = [a, b, c];
    sortRows(input, { key: "activity", dir: "desc" });
    expect(input.map((r) => r.key)).toEqual(["a", "b", "c"]);
  });
});
