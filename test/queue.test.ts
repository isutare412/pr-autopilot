import { describe, it, expect } from "vitest";
import { JobQueue } from "../src/main/core/queue";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("JobQueue", () => {
  it("dedups by id", () => {
    const q = new JobQueue(2);
    let runs = 0;
    q.submit("a", async () => { runs++; await tick(20); });
    q.submit("a", async () => { runs++; await tick(20); });
    expect(q.has("a")).toBe(true);
    expect(q.size).toBe(1);
  });

  it("respects concurrency", async () => {
    const q = new JobQueue(2);
    let active = 0, maxActive = 0;
    for (const id of ["a", "b", "c", "d"]) {
      q.submit(id, async () => { active++; maxActive = Math.max(maxActive, active); await tick(20); active--; });
    }
    await q.onIdle();
    expect(maxActive).toBe(2);
  });

  it("clears id after completion so it can run again", async () => {
    const q = new JobQueue(1);
    q.submit("a", async () => { await tick(5); });
    await q.onIdle();
    expect(q.has("a")).toBe(false);
  });
});
