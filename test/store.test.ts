import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/main/core/store";
import type { PrRecord } from "../src/main/core/schema";

function rec(over: Partial<PrRecord> = {}): PrRecord {
  return {
    key: "git.linecorp.com/O/R#65", host: "git.linecorp.com", owner: "O", repo: "R",
    number: 65, url: "http://x", title: "t", author: "a", baseRef: "develop",
    state: "NEEDS_REVIEW", mode: "first-review", headSha: "abc", draftVersion: 1,
    draft: { overallEn: "o", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] },
    feedbackHistory: [], postResult: null, postProgress: null, error: null,
    discoveredAt: "2026-01-01T00:00:00Z", generatedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z", doneAt: null, ...over,
  };
}

describe("Store", () => {
  it("put then get round-trips", () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    s.put(rec());
    expect(s.get("git.linecorp.com/O/R#65")?.title).toBe("t");
  });

  it("get returns null for unknown key", () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    expect(s.get("git.linecorp.com/O/R#999")).toBeNull();
  });

  it("list returns all records", () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    s.put(rec());
    s.put(rec({ key: "git.linecorp.com/O/R#66", number: 66 }));
    expect(s.list().length).toBe(2);
  });

  it("snapshot writes a versioned file", () => {
    const dir = mkdtempSync(join(tmpdir(), "store-"));
    const s = new Store(dir);
    s.put(rec({ draftVersion: 3 }));
    s.snapshot(s.get("git.linecorp.com/O/R#65")!);
    const snaps = readdirSync(join(dir, "snapshots"));
    expect(snaps.some((f) => f.includes("__65.v3"))).toBe(true);
  });

  it("prune removes terminal records older than retention", () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    s.put(rec({ state: "DONE", doneAt: "2026-01-01T00:00:00Z" }));
    s.put(rec({ key: "git.linecorp.com/O/R#66", number: 66, state: "NEEDS_REVIEW", doneAt: null }));
    const pruned = s.prune(30, "2026-03-01T00:00:00Z");
    expect(pruned).toEqual(["git.linecorp.com/O/R#65"]);
    expect(s.get("git.linecorp.com/O/R#65")).toBeNull();
    expect(s.get("git.linecorp.com/O/R#66")).not.toBeNull();
  });

  it("withLock serializes async work per key", async () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    const order: number[] = [];
    const a = s.withLock("k", async () => { await new Promise(r => setTimeout(r, 20)); order.push(1); });
    const b = s.withLock("k", async () => { order.push(2); });
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
  });

  it("releases the lock-map entry after a lock completes", async () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    await s.withLock("k", async () => {});
    expect((s as any).locks.has("k")).toBe(false);
  });

  it("withLock runs the next queued call even if the previous throws", async () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    const order: string[] = [];
    const a = s.withLock("k", async () => { order.push("a"); throw new Error("boom"); }).catch(() => order.push("a-caught"));
    const b = s.withLock("k", async () => { order.push("b"); });
    await Promise.all([a, b]);
    expect(order).toEqual(["a", "a-caught", "b"]);
  });

  it("prune removes DISMISSED and POSTED_AWAITING_AUTHOR records too", () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    s.put(rec({ key: "git.linecorp.com/O/R#70", number: 70, state: "DISMISSED", doneAt: "2026-01-01T00:00:00Z" }));
    s.put(rec({ key: "git.linecorp.com/O/R#71", number: 71, state: "POSTED_AWAITING_AUTHOR", doneAt: null, updatedAt: "2026-01-01T00:00:00Z" }));
    const pruned = s.prune(30, "2026-03-01T00:00:00Z").sort();
    expect(pruned).toEqual(["git.linecorp.com/O/R#70", "git.linecorp.com/O/R#71"]);
  });

  it("prune removes an old ERROR record (falls back to updatedAt; doneAt null)", () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    s.put(rec({ key: "git.linecorp.com/O/R#72", number: 72, state: "ERROR", doneAt: null, updatedAt: "2026-01-01T00:00:00Z" }));
    const pruned = s.prune(30, "2026-03-01T00:00:00Z");
    expect(pruned).toEqual(["git.linecorp.com/O/R#72"]);
    expect(s.get("git.linecorp.com/O/R#72")).toBeNull();
  });

  it("prune removes an old dismissed record even with a non-terminal state", () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    s.put(rec({ key: "git.linecorp.com/O/R#73", number: 73, state: "NEEDS_REVIEW", dismissed: true, doneAt: null, updatedAt: "2026-01-01T00:00:00Z" }));
    const pruned = s.prune(30, "2026-03-01T00:00:00Z");
    expect(pruned).toEqual(["git.linecorp.com/O/R#73"]);
    expect(s.get("git.linecorp.com/O/R#73")).toBeNull();
  });

  it("delete removes the record file and updates the index", () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    s.put(rec());
    s.put(rec({ key: "git.linecorp.com/O/R#66", number: 66 }));
    s.delete("git.linecorp.com/O/R#65");
    expect(s.get("git.linecorp.com/O/R#65")).toBeNull();
    expect(s.list().map((r) => r.number)).toEqual([66]);
  });

  it("delete is a no-op for an unknown key", () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    expect(() => s.delete("git.linecorp.com/O/R#999")).not.toThrow();
  });

  it("withLock keeps the map entry while a later caller is still queued", async () => {
    const s = new Store(mkdtempSync(join(tmpdir(), "store-")));
    let releaseA!: () => void;
    const a = s.withLock("k", async () => { await new Promise<void>((res) => { releaseA = res; }); });
    const b = s.withLock("k", async () => {});
    await new Promise((r) => setTimeout(r, 5));
    expect((s as any).locks.has("k")).toBe(true);
    releaseA();
    await Promise.all([a, b]);
    expect((s as any).locks.has("k")).toBe(false);
  });
});
