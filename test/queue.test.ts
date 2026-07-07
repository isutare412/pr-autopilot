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

  it("setConcurrency raise pumps queued jobs up to the new limit immediately", async () => {
    const q = new JobQueue(1);
    let active = 0, maxActive = 0;
    const mk = () => async () => { active++; maxActive = Math.max(maxActive, active); await tick(30); active--; };
    for (const id of ["a", "b", "c"]) q.submit(id, mk());
    await tick(5);
    expect(active).toBe(1);       // concurrency 1 → only "a" running
    q.setConcurrency(3);          // must pump "b" and "c" right away
    await tick(5);
    expect(active).toBe(3);
    await q.onIdle();
    expect(maxActive).toBe(3);
  });

  it("setConcurrency lower drains running jobs without preemption and holds new starts", async () => {
    const q = new JobQueue(3);
    let active = 0, maxActive = 0;
    const mk = () => async () => { active++; maxActive = Math.max(maxActive, active); await tick(30); active--; };
    for (const id of ["a", "b", "c"]) q.submit(id, mk());
    await tick(5);
    expect(active).toBe(3);       // all three running
    q.setConcurrency(1);          // no preemption — the three keep running
    expect(active).toBe(3);
    q.submit("d", mk());          // must wait: running(3) >= limit(1)
    await tick(5);
    expect(active).toBe(3);       // "d" has not started
    await q.onIdle();
    expect(maxActive).toBe(3);
  });

  it("setConcurrency ignores invalid values", async () => {
    const q = new JobQueue(2);
    let active = 0, maxActive = 0;
    const mk = () => async () => { active++; maxActive = Math.max(maxActive, active); await tick(20); active--; };
    for (const id of ["a", "b", "c", "d"]) q.submit(id, mk());
    q.setConcurrency(0);
    q.setConcurrency(-1);
    q.setConcurrency(1.5);
    await q.onIdle();
    expect(maxActive).toBe(2);    // limit unchanged
  });
});
