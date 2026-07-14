import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/main/core/store";
import { Orchestrator, POST_STALLED_MID_CYCLE } from "../src/main/core/orchestrator";
import type { Draft, PrRecord, VerifyItem } from "../src/main/core/schema";

const draft: Draft = { overallEn: "o", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };

function mkOrch() {
  const store = new Store(mkdtempSync(join(tmpdir(), "orch-")));
  const gh: any = {
    login: async () => "me",
    view: async () => ({ title: "t", body: "", author: "kim", baseRefName: "develop", headRefName: "f", headRefOid: "SHA1", state: "OPEN" }),
    headSha: async () => "SHA1",
    reviewThreads: async () => [],
    prStatus: async () => ({ state: "OPEN", headSha: "SHA1" }),
    searchReviewRequested: async () => [],
    prState: async () => "OPEN",
    postReview: vi.fn(async () => ({ html_url: "http://x/r/1" })),
    requestReviewer: vi.fn(async () => {}),
    // execute()'s zero-specs fast path asks GitHub directly before trusting our
    // own bookkeeping (FINDING I-1) — a clean post with no pendingReviewId still
    // calls this once to confirm no orphaned pending review is live.
    findPendingReview: vi.fn(async () => null),
  };
  const orch = new Orchestrator({
    store, gh,
    generate: vi.fn(async () => draft),
    notifier: { send: vi.fn(async () => {}) },
    nowIso: () => "2026-06-29T00:00:00Z",
    login: "me",
    retentionDays: () => 30,
    concurrency: 2,
    host: "github.com",
    language: () => "en",
    effort: () => "high",
    operatingMode: () => "supervised",
  });
  return { orch, store };
}

function seed(store: Store, number: number, state: PrRecord["state"], over: Partial<PrRecord> = {}): string {
  const key = `github.com/O/R#${number}`;
  store.put({
    key, host: "github.com", owner: "O", repo: "R", number,
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
    await orch.runGeneration("github.com/O/R#65", "first-review",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });
    const rec = store.get("github.com/O/R#65")!;
    expect(rec.state).toBe("NEEDS_REVIEW");
    expect(rec.draft).not.toBeNull();
    expect(rec.draftVersion).toBe(1);
  });

  it("regeneration records the current live head, not a frozen SHA (breaks the STALE→GENERATING loop)", async () => {
    const { orch, store } = mkOrch();
    const gh = (orch as any).d.gh;
    // A record left STALE by a post that saw the head advance.
    const key = seed(store, 40, "STALE", { headSha: "SHA1", draft, draftVersion: 1 });
    // The author has pushed: the live head is now SHA2.
    gh.headSha = async () => "SHA2";

    // The STALE-recovery path (enqueueGen) passes the *stale* rec.headSha. Whatever
    // is passed, the regenerated record must record the live head it reviewed against.
    await orch.runGeneration(key, "re-review",
      { url: "http://x/O/R/pull/40", owner: "O", repo: "R", number: 40, title: "t" });

    const rec = store.get(key)!;
    expect(rec.state).toBe("NEEDS_REVIEW");
    expect(rec.headSha).toBe("SHA2"); // was frozen at SHA1 → endless STALE loop
  });

  it("regeneration clears the previous post cycle's ledger (stale postProgress must not skip the new post)", async () => {
    const { orch, store } = mkOrch();
    // A record whose *first* review already completed: postProgress marks the
    // review as posted and the reviewer re-requested, postResult holds that
    // review's URL, and a disposition was chosen. If any of this leaks into the
    // re-review draft, execute() would skip posting the new finding as "already done".
    const key = seed(store, 41, "POSTED_AWAITING_AUTHOR", {
      draft, draftVersion: 1, mode: "re-review",
      postProgress: {
        sent: { repliedTargets: [], resolvedThreads: [] },
        review: { pendingReviewId: null, threadsAdded: [], threadsFailed: [] },
        reviewPosted: true, reviewerRequested: true,
      },
      postResult: { reviewUrl: "http://x/r/first", postedAt: "t", resolvedThreadIds: [] },
      postVerdict: "comment",
    });

    await orch.runGeneration(key, "re-review",
      { url: "http://x/O/R/pull/41", owner: "O", repo: "R", number: 41, title: "t" });

    const rec = store.get(key)!;
    expect(rec.state).toBe("NEEDS_REVIEW");
    expect(rec.postProgress).toBeNull();
    expect(rec.postResult).toBeNull();
    expect(rec.postVerdict).toBeUndefined();
  });

  it("runGeneration records ERROR when generate throws", async () => {
    const { orch, store } = mkOrch();
    (orch as any).generate = async () => { throw new Error("boom"); };
    await orch.runGeneration("github.com/O/R#65", "first-review",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });
    expect(store.get("github.com/O/R#65")!.state).toBe("ERROR");
  });

  it("poll/generation cycle never posts", async () => {
    const { orch, store } = mkOrch();
    const gh = (orch as any).d.gh;
    await orch.runGeneration("github.com/O/R#65", "first-review",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });
    const rec = store.get("github.com/O/R#65")!;
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
      retentionDays: () => 30,
      concurrency: 2,
      host: "github.com",
      language: () => "en",
      effort: () => "max",
      operatingMode: () => "supervised",
    });
    await orch.runGeneration("github.com/O/R#65", "first-review",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });
    expect(capturedInput.language).toBe("en");
    expect(capturedInput.effort).toBe("max");
  });

  it("persists the full activity feed, not just the last 10, while generating", async () => {
    const { orch, store } = mkOrch();
    let captured: string[] | undefined;
    orch.generate = vi.fn(async (_input, onActivity) => {
      onActivity?.(Array.from({ length: 20 }, (_, i) => `step ${i}`));
      captured = store.get("github.com/O/R#65")?.genActivity;
      return draft;
    });
    await orch.runGeneration("github.com/O/R#65", "first-review",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });
    expect(captured).toHaveLength(20);
    expect(captured?.[0]).toBe("step 0");
    expect(captured?.[19]).toBe("step 19");
  });

  it("caps the persisted activity feed at 500 lines", async () => {
    const { orch, store } = mkOrch();
    let captured: string[] | undefined;
    orch.generate = vi.fn(async (_input, onActivity) => {
      onActivity?.(Array.from({ length: 600 }, (_, i) => `step ${i}`));
      captured = store.get("github.com/O/R#65")?.genActivity;
      return draft;
    });
    await orch.runGeneration("github.com/O/R#65", "first-review",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });
    expect(captured).toHaveLength(500);
    expect(captured?.[0]).toBe("step 100"); // last 500 of 600 begins at index 100
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

describe("runForceApprove", () => {
  it("posts LGTM and marks DONE, ignoring the prior post ledger", async () => {
    const { orch, store } = mkOrch();
    const key = seed(store, 50, "POSTING", { draft, draftVersion: 1, forceApprove: true,
      postProgress: {
        sent: { repliedTargets: [], resolvedThreads: [] },
        review: { pendingReviewId: null, threadsAdded: [], threadsFailed: [] },
        reviewPosted: true, reviewerRequested: true,
      } });
    await orch.runForceApprove(key);
    const rec = store.get(key)!;
    expect(rec.state).toBe("DONE");
    expect(rec.postResult?.reviewUrl).toBe("http://x/r/1");
    expect(rec.forceApprove).toBe(false);
  });

  it("records ERROR with step force-approve when postReview throws", async () => {
    const { orch, store } = mkOrch();
    (orch as any).d.gh.postReview = vi.fn(async () => { throw new Error("boom"); });
    const key = seed(store, 51, "POSTING", { draft, draftVersion: 1, forceApprove: true });
    await orch.runForceApprove(key);
    const rec = store.get(key)!;
    expect(rec.state).toBe("ERROR");
    expect(rec.error?.step).toBe("force-approve");
    expect(rec.forceApprove).toBe(false);
  });
});

describe("runGeneration terminal guard (force-approve race)", () => {
  it("skipIfTerminal does not resurrect a DONE record (force-approve won the race)", async () => {
    const { orch, store } = mkOrch();
    const genSpy = vi.fn(async () => draft);
    orch.generate = genSpy;
    const key = seed(store, 70, "DONE", { draft, draftVersion: 1, doneAt: "t",
      postResult: { reviewUrl: "http://x/r/1", postedAt: "t", resolvedThreadIds: [] } });
    await orch.runGeneration(key, "re-review",
      { url: "http://x/O/R/pull/70", owner: "O", repo: "R", number: 70, title: "t" }, undefined, true);
    expect(genSpy).not.toHaveBeenCalled();
    expect(store.get(key)!.state).toBe("DONE");
  });

  it("poll-driven regeneration (no flag) still re-reviews a DONE record whose head advanced", async () => {
    const { orch, store } = mkOrch();
    const key = seed(store, 71, "DONE", { draft, draftVersion: 1, doneAt: "t" });
    await orch.runGeneration(key, "re-review",
      { url: "http://x/O/R/pull/71", owner: "O", repo: "R", number: 71, title: "t" });
    expect(store.get(key)!.state).toBe("NEEDS_REVIEW");
  });
});

describe("recoverInFlight — force-approve routing", () => {
  it("routes a POSTING+forceApprove record to the force-approve lane, plain POSTING to normal post", () => {
    const { orch, store } = mkOrch();
    const plain = seed(store, 60, "POSTING");
    const forced = seed(store, 61, "POSTING", { forceApprove: true });
    const postSpy = vi.fn();
    const faSpy = vi.fn();
    (orch as any).enqueuePost = postSpy;
    (orch as any).enqueueForceApprove = faSpy;

    orch.recoverInFlight();

    expect(postSpy).toHaveBeenCalledWith(plain);
    expect(postSpy).not.toHaveBeenCalledWith(forced);
    expect(faSpy).toHaveBeenCalledWith(forced);
    expect(faSpy).not.toHaveBeenCalledWith(plain);
  });
});

describe("Orchestrator — automated mode", () => {
  it("auto-posts a fresh draft and suppresses the Draft-ready notification", async () => {
    const { orch, store } = mkOrch();
    (orch as any).d.operatingMode = () => "automated";
    const postSpy = vi.fn();
    (orch as any).enqueuePost = postSpy;
    const notifier = (orch as any).d.notifier;

    await orch.runGeneration("github.com/O/R#65", "first-review",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });

    const rec = store.get("github.com/O/R#65")!;
    expect(rec.draft).not.toBeNull();
    expect(rec.state).toBe("POSTING");
    expect(postSpy).toHaveBeenCalledWith("github.com/O/R#65", true);
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it("supervised generation still notifies and does not post", async () => {
    const { orch, store } = mkOrch();
    const postSpy = vi.fn();
    (orch as any).enqueuePost = postSpy;
    const notifier = (orch as any).d.notifier;

    await orch.runGeneration("github.com/O/R#65", "first-review",
      { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t" });

    expect(store.get("github.com/O/R#65")!.state).toBe("NEEDS_REVIEW");
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

  it("runPost ERROR path keeps the postProgress persisted by execute()'s onProgress, not the stale pre-execute snapshot", async () => {
    const { orch, store } = mkOrch();
    const draftWithFinding = {
      overallEn: "o", counts: { critical: 1, major: 0, minor: 0, nit: 0 },
      findings: [{ id: "f1", ref: "#1", path: "a.go", line: 10, side: "RIGHT", startLine: null,
        startSide: null, anchorable: true, priority: "Critical", body: "**[Critical]** leak",
        suggestion: null, included: true, editedBody: null }],
      verify: [],
    };
    const key = seed(store, 23, "NEEDS_REVIEW", { draft: draftWithFinding as any });
    const gh = (orch as any).d.gh;
    // Progress this far: pending review opened and the one finding attached as a
    // thread — both persisted via execute()'s onProgress before submitReview fails.
    gh.prStatus = async () => ({ state: "OPEN", headSha: "SHA1", nodeId: "PR_node1" });
    gh.findPendingReview = async () => null;   // no pending review yet → reconciliation creates one
    gh.createPendingReview = async () => "PRR_1";
    gh.addReviewThread = async () => {};
    gh.submitReview = async () => { throw new Error("submit boom"); };

    await orch.runPost(key, false);

    const rec = store.get(key)!;
    expect(rec.state).toBe("ERROR");
    expect(rec.error?.step).toBe("post");
    // The bug: spreading the pre-execute `rec` snapshot instead of re-reading the
    // store would wipe these back to the initial empty progress (null pendingReviewId,
    // empty threadsAdded), losing track of the orphaned pending review.
    expect(rec.postProgress?.review.pendingReviewId).toBe("PRR_1");
    expect(rec.postProgress?.review.threadsAdded).toEqual(["f1"]);
  });
});

describe("Orchestrator — poll sweep", () => {
  it("marks a lingering record CLOSED when its PR is merged", async () => {
    const { orch, store } = mkOrch();
    const key = seed(store, 30, "NEEDS_REVIEW", { draft });
    (orch as any).d.gh.prState = async () => "MERGED";
    await orch.runPoll();
    expect(store.get(key)!.state).toBe("CLOSED");
  });

  it("leaves a lingering record untouched when its PR is still open", async () => {
    const { orch, store } = mkOrch();
    const key = seed(store, 31, "NEEDS_REVIEW", { draft });
    (orch as any).d.gh.prState = async () => "OPEN";
    await orch.runPoll();
    expect(store.get(key)!.state).toBe("NEEDS_REVIEW");
  });

  it("leaves a record unchanged when the state probe throws", async () => {
    const { orch, store } = mkOrch();
    const key = seed(store, 32, "NEEDS_REVIEW", { draft });
    (orch as any).d.gh.prState = async () => { throw new Error("boom"); };
    await orch.runPoll();
    expect(store.get(key)!.state).toBe("NEEDS_REVIEW");
  });
});

describe("Orchestrator — live settings", () => {
  it("setConcurrency forwards to both the gen and post queues", () => {
    const { orch } = mkOrch();
    const genSpy = vi.spyOn(orch.genQueue, "setConcurrency");
    const postSpy = vi.spyOn(orch.postQueue, "setConcurrency");
    orch.setConcurrency(5);
    expect(genSpy).toHaveBeenCalledWith(5);
    expect(postSpy).toHaveBeenCalledWith(5);
  });

  it("pruneNow reads the current retentionDays getter on each call", () => {
    const store = new Store(mkdtempSync(join(tmpdir(), "orch-")));
    const pruneSpy = vi.spyOn(store, "prune").mockReturnValue([]);
    let days = 30;
    const orch = new Orchestrator({
      store, gh: {} as any,
      generate: vi.fn(async () => draft),
      notifier: { send: vi.fn(async () => {}) },
      nowIso: () => "2026-06-29T00:00:00Z",
      login: "me", retentionDays: () => days, concurrency: 2, host: "h",
      language: () => "en", effort: () => "high", operatingMode: () => "supervised",
    });
    orch.pruneNow();
    expect(pruneSpy).toHaveBeenLastCalledWith(30, expect.any(String));
    days = 7;
    orch.pruneNow();
    expect(pruneSpy).toHaveBeenLastCalledWith(7, expect.any(String));
  });

  it("runPoll reads the repoAllow/repoDeny getters on each poll", async () => {
    const { orch } = mkOrch();
    const allow = vi.fn(() => [] as string[]);
    const deny = vi.fn(() => [] as string[]);
    (orch as any).d.repoAllow = allow;
    (orch as any).d.repoDeny = deny;
    await orch.runPoll();
    expect(allow).toHaveBeenCalled();
    expect(deny).toHaveBeenCalled();
  });
});

/** The class of bug this whole split exists to kill: a draft regenerated in the
 *  middle of a post cycle used to take the idempotency ledger down with it, so the
 *  next post re-sent replies GitHub already had. The sent half is keyed by GitHub's
 *  own ids and now survives a re-draft; the review half, keyed by the old draft's
 *  finding ids, does not. */
describe("Orchestrator — the post ledger across a re-draft", () => {
  /** Same GitHub thread (N1 / reply target 111) in two different drafts, wearing a
   *  different *local* id each time — exactly what a regeneration produces. */
  const verify = (id: string): VerifyItem => ({
    id, ref: "V1", threadNodeId: "N1", replyTargetDatabaseId: 111, path: "a.go", line: 1,
    verdict: "follow-up", rationaleEn: "still open", replyBody: "**[Major]** still open",
    included: true, editedBody: null,
  });
  const draftWith = (v: VerifyItem): Draft => ({
    overallEn: "o", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [v],
  });

  it("carries the sent half into the new draft, so a reply already on GitHub is not sent twice", async () => {
    const { orch, store } = mkOrch();
    const gh = (orch as any).d.gh;
    gh.postReply = vi.fn(async () => {});

    // A cycle that landed the reply to thread 111 and then died before the review.
    const key = seed(store, 80, "ERROR", {
      draft: draftWith(verify("v1")), draftVersion: 1, mode: "re-review", headSha: "SHA1",
      postProgress: {
        sent: { repliedTargets: [111], resolvedThreads: [] },
        review: { pendingReviewId: null, threadsAdded: [], threadsFailed: [] },
        reviewPosted: false, reviewerRequested: false,
      },
    });

    // The draft is regenerated. The same GitHub thread comes back with a *new* local id.
    orch.generate = vi.fn(async () => draftWith(verify("v-REGENERATED")));
    await orch.runGeneration(key, "re-review", { url: "http://x/O/R/pull/80", owner: "O", repo: "R", number: 80, title: "t" });

    const regenerated = store.get(key)!;
    expect(regenerated.state).toBe("NEEDS_REVIEW");
    expect(regenerated.draft!.verify[0].id).toBe("v-REGENERATED");   // a genuinely new local id…
    expect(regenerated.postProgress!.sent.repliedTargets).toEqual([111]);   // …but GitHub's id is remembered
    // the review half belongs to the old draft's findings and is reset
    expect(regenerated.postProgress!.review).toEqual({ pendingReviewId: null, threadsAdded: [], threadsFailed: [] });

    await orch.runPost(key);

    expect(gh.postReply).not.toHaveBeenCalled();   // the reply GitHub already has is not re-sent
  });

  it("a SPENT cycle (reviewPosted) starts the next one clean, so a re-review can reply to the same thread again", async () => {
    const { orch, store } = mkOrch();
    const gh = (orch as any).d.gh;
    gh.postReply = vi.fn(async () => {});

    // The previous cycle completed: its reply belongs to a review that already landed.
    const key = seed(store, 81, "POSTED_AWAITING_AUTHOR", {
      draft: draftWith(verify("v1")), draftVersion: 1, mode: "re-review", headSha: "SHA1",
      postProgress: {
        sent: { repliedTargets: [111], resolvedThreads: ["N1"] },
        review: { pendingReviewId: null, threadsAdded: [], threadsFailed: [] },
        reviewPosted: true, reviewerRequested: true,
      },
    });

    orch.generate = vi.fn(async () => draftWith(verify("v2")));
    await orch.runGeneration(key, "re-review", { url: "http://x/O/R/pull/81", owner: "O", repo: "R", number: 81, title: "t" });

    expect(store.get(key)!.postProgress).toBeNull();   // spent → the next cycle starts from scratch

    await orch.runPost(key);

    expect(gh.postReply).toHaveBeenCalledTimes(1);   // the new round of review may speak in that thread again
    expect(store.get(key)!.postProgress!.sent.repliedTargets).toEqual([111]);
  });
});

/** The round-4 hole: execute() returns STALE by spreading `rec`, so an unspent
 *  postProgress rides along into the STALE record — and runPost's STALE recovery
 *  used to hand that straight to enqueueGen. */
describe("Orchestrator — runPost STALE recovery is gated on the ledger", () => {
  const findingDraft = (): Draft => ({
    overallEn: "o", counts: { critical: 1, major: 0, minor: 0, nit: 0 },
    findings: [{ id: "f1", ref: "#1", path: "a.go", line: 10, side: "RIGHT", startLine: null,
      startSide: null, anchorable: true, priority: "Critical", body: "**[Critical]** leak",
      suggestion: null, included: true, editedBody: null }],
    verify: [{ id: "v1", ref: "V1", threadNodeId: "N1", replyTargetDatabaseId: 111, path: "a.go",
      line: 1, verdict: "follow-up", rationaleEn: "open", replyBody: "**[Major]** open",
      included: true, editedBody: null }],
  });

  it("a half-landed post + an author push → no regeneration, an actionable error instead", async () => {
    const { orch, store } = mkOrch();
    const gh = (orch as any).d.gh;
    const genSpy = vi.fn();

    gh.prStatus = async () => ({ state: "OPEN", headSha: "SHA1", nodeId: "PR_node1" });
    gh.postReply = vi.fn(async () => {});
    gh.resolveThread = vi.fn(async () => {});
    gh.findPendingReview = async () => null;
    gh.createPendingReview = async () => "PRR_1";
    gh.addReviewThread = async () => {};
    gh.submitReview = async () => { throw new Error("submit boom"); };

    const key = seed(store, 90, "POSTING", { draft: findingDraft(), draftVersion: 1, headSha: "SHA1", mode: "re-review" });

    // 1. The post partly lands: the reply goes out, then the submit fails.
    await orch.runPost(key);
    const errored = store.get(key)!;
    expect(errored.state).toBe("ERROR");
    expect(gh.postReply).toHaveBeenCalledTimes(1);
    expect(errored.postProgress!.sent.repliedTargets).toEqual([111]);

    // 2. The author pushes while we sit in ERROR.
    gh.prStatus = async () => ({ state: "OPEN", headSha: "SHA2", nodeId: "PR_node1" });
    gh.headSha = async () => "SHA2";

    // 3. The user hits Retry post. execute() sees the moved head and returns STALE.
    (orch as any).enqueueGen = genSpy;
    await orch.runPost(key);

    // The bug: STALE used to enqueue a regeneration, which would drop the pending
    // review we opened (orphaning it on the PR) and re-post the reply already sent.
    expect(genSpy).not.toHaveBeenCalled();

    const stalled = store.get(key)!;
    expect(stalled.state).toBe("ERROR");                       // an escapable state, not a silent STALE
    expect(stalled.error).toEqual({ step: "post", message: POST_STALLED_MID_CYCLE });
    expect(stalled.postProgress!.sent.repliedTargets).toEqual([111]);   // the ledger is intact
    expect(gh.postReply).toHaveBeenCalledTimes(1);             // and nothing was re-sent
  });

  it("still regenerates a STALE record whose ledger is empty — the ordinary catch-up path", async () => {
    const { orch, store } = mkOrch();
    const gh = (orch as any).d.gh;
    const genSpy = vi.fn();
    (orch as any).enqueueGen = genSpy;

    // Nothing has landed: a plain approve whose head moved before the first mutation.
    gh.prStatus = async () => ({ state: "OPEN", headSha: "SHA2", nodeId: "PR_node1" });
    const key = seed(store, 91, "POSTING", { draft, draftVersion: 1, headSha: "SHA1" });

    await orch.runPost(key);

    expect(genSpy).toHaveBeenCalledWith(key);
    expect(store.get(key)!.state).toBe("STALE");
  });
});
