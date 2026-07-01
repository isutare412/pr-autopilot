import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/main/core/store";
import { Orchestrator } from "../src/main/core/orchestrator";
import type { Draft, PrRecord } from "../src/main/core/schema";

const draft: Draft = { overallEn: "o", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };

function mkOrch() {
  const store = new Store(mkdtempSync(join(tmpdir(), "orch-")));
  const gh: any = {
    login: async () => "me",
    view: async () => ({ title: "t", body: "", author: "kim", baseRefName: "develop", headRefName: "f", headRefOid: "SHA1", state: "OPEN" }),
    headSha: async () => "SHA1",
    reviewThreads: async () => [],
    prStatus: async () => ({ state: "OPEN", headSha: "SHA1" }),
    postReview: vi.fn(async () => ({ html_url: "http://x/r/1" })),
    requestReviewer: vi.fn(async () => {}),
  };
  const orch = new Orchestrator({
    store, gh,
    generate: vi.fn(async () => draft),
    notifier: { send: vi.fn(async () => {}) },
    nowIso: () => "2026-06-29T00:00:00Z",
    login: "me",
    retentionDays: 30,
    concurrency: 2,
    host: "git.linecorp.com",
    language: () => "en",
    effort: () => "high",
    operatingMode: () => "supervised",
  });
  return { orch, store };
}

function seed(store: Store, number: number, state: PrRecord["state"], over: Partial<PrRecord> = {}): string {
  const key = `git.linecorp.com/O/R#${number}`;
  store.put({
    key, host: "git.linecorp.com", owner: "O", repo: "R", number,
    url: "http://x/O/R/pull/" + number, title: "t", author: "kim", baseRef: "develop",
    state, mode: "first-review", headSha: "SHA1", draftVersion: 0, draft: null,
    feedbackHistory: [], postResult: null, postProgress: null, error: null,
    discoveredAt: "t", generatedAt: null, updatedAt: "t", doneAt: null, ...over,
  } as PrRecord);
  return key;
}

describe("Orchestrator", () => {
  it("runGeneration writes a NEEDS_REVIEW record with the draft", async () => {
    const { orch, store } = mkOrch();
    await orch.runGeneration("git.linecorp.com/O/R#65", "first-review", "SHA1",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });
    const rec = store.get("git.linecorp.com/O/R#65")!;
    expect(rec.state).toBe("NEEDS_REVIEW");
    expect(rec.draft).not.toBeNull();
    expect(rec.draftVersion).toBe(1);
  });

  it("runGeneration records ERROR when generate throws", async () => {
    const { orch, store } = mkOrch();
    (orch as any).generate = async () => { throw new Error("boom"); };
    await orch.runGeneration("git.linecorp.com/O/R#65", "first-review", "SHA1",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });
    expect(store.get("git.linecorp.com/O/R#65")!.state).toBe("ERROR");
  });

  it("poll/generation cycle never posts", async () => {
    const { orch, store } = mkOrch();
    const gh = (orch as any).d.gh;
    await orch.runGeneration("git.linecorp.com/O/R#65", "first-review", "SHA1",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });
    const rec = store.get("git.linecorp.com/O/R#65")!;
    expect(rec.state).toBe("NEEDS_REVIEW");
    expect(gh.postReview).not.toHaveBeenCalled();
    expect(gh.requestReviewer).not.toHaveBeenCalled();
  });

  it("passes the configured comment language into generation", async () => {
    const store = new Store(mkdtempSync(join(tmpdir(), "orch-")));
    const gh: any = {
      view: async () => ({ title: "t", body: "", author: "kim", baseRefName: "develop", headRefName: "f", headRefOid: "SHA1", state: "OPEN" }),
    };
    let capturedInput: any;
    const orch = new Orchestrator({
      store, gh,
      generate: vi.fn(async (input: any) => { capturedInput = input; return draft; }),
      notifier: { send: vi.fn(async () => {}) },
      nowIso: () => "2026-06-29T00:00:00Z",
      login: "me",
      retentionDays: 30,
      concurrency: 2,
      host: "git.linecorp.com",
      language: () => "en",
      effort: () => "max",
      operatingMode: () => "supervised",
    });
    await orch.runGeneration("git.linecorp.com/O/R#65", "first-review", "SHA1",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });
    expect(capturedInput.language).toBe("en");
    expect(capturedInput.effort).toBe("max");
  });
});

describe("recoverInFlight", () => {
  it("re-enqueues GENERATING and POSTING records and ignores the rest", () => {
    const { orch, store } = mkOrch();
    const g = seed(store, 1, "GENERATING");
    const p = seed(store, 2, "POSTING");
    seed(store, 3, "NEEDS_REVIEW");
    seed(store, 4, "DONE");
    seed(store, 5, "ERROR");
    seed(store, 6, "STALE");

    // Spy on the queue entry points (public arrow-properties, so overwriting the
    // instance property is what `this.enqueueGen` inside the method resolves to).
    const genSpy = vi.fn();
    const postSpy = vi.fn();
    (orch as any).enqueueGen = genSpy;
    (orch as any).enqueuePost = postSpy;

    const result = orch.recoverInFlight();

    expect(result).toEqual({ regenerated: [g], resumedPost: [p] });
    expect(genSpy).toHaveBeenCalledTimes(1);
    expect(genSpy).toHaveBeenCalledWith(g);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(p);
  });

  it("returns empty lists when the store has no records", () => {
    const { orch } = mkOrch();
    expect(orch.recoverInFlight()).toEqual({ regenerated: [], resumedPost: [] });
  });
});

describe("Orchestrator — automated mode", () => {
  it("auto-posts a fresh draft and suppresses the Draft-ready notification", async () => {
    const { orch, store } = mkOrch();
    (orch as any).d.operatingMode = () => "automated";
    const postSpy = vi.fn();
    (orch as any).enqueuePost = postSpy;
    const notifier = (orch as any).d.notifier;

    await orch.runGeneration("git.linecorp.com/O/R#65", "first-review", "SHA1",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });

    const rec = store.get("git.linecorp.com/O/R#65")!;
    expect(rec.draft).not.toBeNull();
    expect(rec.state).toBe("POSTING");
    expect(postSpy).toHaveBeenCalledWith("git.linecorp.com/O/R#65", true);
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it("supervised generation still notifies and does not post", async () => {
    const { orch, store } = mkOrch();
    const postSpy = vi.fn();
    (orch as any).enqueuePost = postSpy;
    const notifier = (orch as any).d.notifier;

    await orch.runGeneration("git.linecorp.com/O/R#65", "first-review", "SHA1",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });

    expect(store.get("git.linecorp.com/O/R#65")!.state).toBe("NEEDS_REVIEW");
    expect(postSpy).not.toHaveBeenCalled();
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it("autoPostReady posts only NEEDS_REVIEW records", () => {
    const { orch, store } = mkOrch();
    const nr = seed(store, 10, "NEEDS_REVIEW");
    seed(store, 11, "GENERATING");
    seed(store, 12, "DONE");
    const postSpy = vi.fn();
    (orch as any).enqueuePost = postSpy;

    const keys = orch.autoPostReady();

    expect(keys).toEqual([nr]);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(nr, true);
    expect(store.get(nr)!.state).toBe("POSTING");
  });

  it("runPost notifies on an auto post but not on a manual post", async () => {
    const { orch, store } = mkOrch();
    const key = seed(store, 20, "NEEDS_REVIEW", { draft });
    const notifier = (orch as any).d.notifier;

    await orch.runPost(key, false);
    expect(notifier.send).not.toHaveBeenCalled();
    expect(store.get(key)!.state).toBe("DONE"); // empty draft → LGTM approve

    const key2 = seed(store, 21, "NEEDS_REVIEW", { draft });
    await orch.runPost(key2, true);
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect(notifier.send).toHaveBeenCalledWith("PR Autopilot", "Posted review: R #21", "http://x/O/R/pull/21");
  });

  it("auto-post of a merged PR yields CLOSED and does not notify", async () => {
    const { orch, store } = mkOrch();
    const key = seed(store, 22, "NEEDS_REVIEW", { draft });
    (orch as any).d.gh.prStatus = async () => ({ state: "MERGED", headSha: "SHA1" });
    const notifier = (orch as any).d.notifier;

    await orch.runPost(key, true);

    expect(store.get(key)!.state).toBe("CLOSED");
    expect(notifier.send).not.toHaveBeenCalled();
  });
});
