import { describe, it, expect } from "vitest";
import { decideWork, repoAllowed, authorAwaitingReview, keysToProbe } from "../src/main/core/poller";
import type { PrRecord, PostProgress } from "../src/main/core/schema";
import type { SearchPr, ReviewThread } from "../src/main/core/gh";

const thread = (isResolved: boolean, authors: string[]): ReviewThread => ({
  id: "t", isResolved,
  comments: authors.map((a) => ({ databaseId: 1, authorLogin: a, body: "x", path: "a.go", line: 1 })),
});

describe("authorAwaitingReview", () => {
  it("true when the author has the last word in my unresolved thread", () => {
    expect(authorAwaitingReview([thread(false, ["me", "author"])], "me")).toBe(true);
  });
  it("false when I replied last — ball is in the author's court", () => {
    expect(authorAwaitingReview([thread(false, ["me", "author", "me"])], "me")).toBe(false);
  });
  it("true again once the author replies after my follow-up", () => {
    expect(authorAwaitingReview([thread(false, ["me", "author", "me", "author"])], "me")).toBe(true);
  });
  it("false for a resolved thread", () => {
    expect(authorAwaitingReview([thread(true, ["me", "author"])], "me")).toBe(false);
  });
  it("false for a thread I did not start", () => {
    expect(authorAwaitingReview([thread(false, ["author", "me"])], "me")).toBe(false);
  });
  it("false when only my own opening comment exists", () => {
    expect(authorAwaitingReview([thread(false, ["me"])], "me")).toBe(false);
  });
  it("true if any one of several threads awaits me", () => {
    expect(authorAwaitingReview(
      [thread(false, ["me", "me"]), thread(false, ["me", "author"])], "me")).toBe(true);
  });
});

const pr = (number: number): SearchPr => ({ url: `http://x/O/R/pull/${number}`, owner: "O", repo: "R", number, title: `t${number}` });
const key = (n: number) => `github.com/O/R#${n}`;

function existing(number: number, over: Partial<PrRecord>): [string, PrRecord] {
  return [key(number), { key: key(number), host: "github.com", owner: "O", repo: "R", number,
    url: "x", title: "t", author: "a", baseRef: "develop", state: "NEEDS_REVIEW", mode: "first-review",
    headSha: "SHA1", draftVersion: 1, draft: null, feedbackHistory: [], postResult: null,
    postProgress: null, error: null, discoveredAt: "t", generatedAt: "t", updatedAt: "t", doneAt: null, ...over } as PrRecord];
}

describe("decideWork", () => {
  it("enqueues a brand-new PR as first-review", () => {
    const work = decideWork({ queue: [pr(65)], existing: new Map(), liveHeads: new Map([[key(65), "SHA1"]]), authorRepliedKeys: new Set() });
    expect(work).toEqual([{ key: key(65), mode: "first-review", sha: "SHA1", pr: pr(65) }]);
  });

  it("skips a known PR with the same head and no author reply", () => {
    const work = decideWork({ queue: [pr(65)], existing: new Map([existing(65, { headSha: "SHA1", state: "NEEDS_REVIEW" })]),
      liveHeads: new Map([[key(65), "SHA1"]]), authorRepliedKeys: new Set() });
    expect(work).toEqual([]);
  });

  it("re-generates when the head SHA advanced", () => {
    const work = decideWork({ queue: [pr(65)], existing: new Map([existing(65, { headSha: "SHA1" })]),
      liveHeads: new Map([[key(65), "SHA2"]]), authorRepliedKeys: new Set() });
    expect(work.length).toBe(1);
    expect(work[0].sha).toBe("SHA2");
    expect(work[0].mode).toBe("first-review");
  });

  it("does not re-enqueue a PR already posting", () => {
    const work = decideWork({ queue: [pr(65)], existing: new Map([existing(65, { state: "POSTING", headSha: "SHA1" })]),
      liveHeads: new Map([[key(65), "SHA2"]]), authorRepliedKeys: new Set() });
    expect(work).toEqual([]);
  });

  it("re-reviews a POSTED PR when the head SHA advanced even without an author reply", () => {
    const work = decideWork({ queue: [pr(65)], existing: new Map([existing(65, { state: "POSTED_AWAITING_AUTHOR", headSha: "SHA1" })]),
      liveHeads: new Map([[key(65), "SHA2"]]), authorRepliedKeys: new Set() });
    expect(work).toEqual([{ key: key(65), mode: "re-review", sha: "SHA2", pr: pr(65) }]);
  });

  it("preserves re-review mode when a re-reviewed PR's SHA advances", () => {
    const work = decideWork({ queue: [pr(65)], existing: new Map([existing(65, { headSha: "SHA1", mode: "re-review" })]),
      liveHeads: new Map([[key(65), "SHA2"]]), authorRepliedKeys: new Set() });
    expect(work[0].mode).toBe("re-review");
  });

  it("re-reviews when an author replied to an open thread (posted state)", () => {
    const work = decideWork({ queue: [pr(65)], existing: new Map([existing(65, { state: "POSTED_AWAITING_AUTHOR", headSha: "SHA1" })]),
      liveHeads: new Map([[key(65), "SHA1"]]), authorRepliedKeys: new Set([key(65)]) });
    expect(work).toEqual([{ key: key(65), mode: "re-review", sha: "SHA1", pr: pr(65) }]);
  });

  it("never re-reviews a dismissed PR, even when the head advances", () => {
    const work = decideWork({ queue: [pr(65)], existing: new Map([existing(65, { dismissed: true, headSha: "SHA1" })]),
      liveHeads: new Map([[key(65), "SHA2"]]), authorRepliedKeys: new Set() });
    expect(work).toEqual([]);
  });

  it("re-reviews a restored (non-dismissed) PR once its head advances", () => {
    const work = decideWork({ queue: [pr(65)], existing: new Map([existing(65, { dismissed: false, state: "NEEDS_REVIEW", headSha: "SHA1" })]),
      liveHeads: new Map([[key(65), "SHA2"]]), authorRepliedKeys: new Set() });
    expect(work.map((w) => w.key)).toEqual([key(65)]);
  });

  it("does not re-enqueue a PR already generating", () => {
    const work = decideWork({ queue: [pr(65)], existing: new Map([existing(65, { state: "GENERATING", headSha: "SHA1" })]),
      liveHeads: new Map([[key(65), "SHA2"]]), authorRepliedKeys: new Set() });
    expect(work).toEqual([]);
  });

  const postProgress = (o: {
    repliedTargets?: number[]; resolvedThreads?: string[];
    pendingReviewId?: string | null; threadsAdded?: string[]; threadsFailed?: string[];
    reviewPosted?: boolean; reviewerRequested?: boolean;
  } = {}): PostProgress => ({
    sent: { repliedTargets: o.repliedTargets ?? [], resolvedThreads: o.resolvedThreads ?? [] },
    review: {
      pendingReviewId: o.pendingReviewId ?? null,
      threadsAdded: o.threadsAdded ?? [],
      threadsFailed: o.threadsFailed ?? [],
    },
    reviewPosted: o.reviewPosted ?? false,
    reviewerRequested: o.reviewerRequested ?? false,
  });

  it("does not auto-regenerate an ERROR record whose postProgress ledger is non-empty, even when the head advances (FINDING I-2)", () => {
    const work = decideWork({
      queue: [pr(65)],
      existing: new Map([existing(65, { state: "ERROR", headSha: "SHA1", postProgress: postProgress({ repliedTargets: [111] }) })]),
      liveHeads: new Map([[key(65), "SHA2"]]), authorRepliedKeys: new Set(),
    });
    expect(work).toEqual([]);
  });

  it("still auto-regenerates an ERROR record whose postProgress is null when the head advances", () => {
    const work = decideWork({
      queue: [pr(65)],
      existing: new Map([existing(65, { state: "ERROR", headSha: "SHA1", postProgress: null })]),
      liveHeads: new Map([[key(65), "SHA2"]]), authorRepliedKeys: new Set(),
    });
    expect(work.length).toBe(1);
    expect(work[0].sha).toBe("SHA2");
  });

  /** The gate is the ledger, not the mere presence of a postProgress. runGeneration's
   *  own catch preserves the previous cycle's progress, so gating on `postProgress
   *  != null` would freeze a record whose review already landed and whose next
   *  generation merely hiccuped — it would never be re-reviewed again. */
  it("re-reviews a POSTED_AWAITING_AUTHOR record whose ledger is SPENT (reviewPosted) when the author pushes", () => {
    const work = decideWork({
      queue: [pr(65)],
      existing: new Map([existing(65, { state: "POSTED_AWAITING_AUTHOR", headSha: "SHA1",
        postProgress: postProgress({ repliedTargets: [111], resolvedThreads: ["N1"], reviewPosted: true }) })]),
      liveHeads: new Map([[key(65), "SHA2"]]), authorRepliedKeys: new Set(),
    });
    expect(work.map((w) => w.key)).toEqual([key(65)]);
    expect(work[0].mode).toBe("re-review");
  });

  it("does not re-review a POSTED_AWAITING_AUTHOR record whose ledger is UNSPENT when the author pushes", () => {
    const work = decideWork({
      queue: [pr(65)],
      existing: new Map([existing(65, { state: "POSTED_AWAITING_AUTHOR", headSha: "SHA1",
        postProgress: postProgress({ repliedTargets: [111] }) })]),
      liveHeads: new Map([[key(65), "SHA2"]]), authorRepliedKeys: new Set(),
    });
    expect(work).toEqual([]);
  });

  it("does not auto-regenerate a STALE record holding an unspent ledger (the round-4 hole, poller side)", () => {
    const work = decideWork({
      queue: [pr(65)],
      existing: new Map([existing(65, { state: "STALE", headSha: "SHA1",
        postProgress: postProgress({ pendingReviewId: "PRR_1", threadsAdded: ["f1"] }) })]),
      liveHeads: new Map([[key(65), "SHA2"]]), authorRepliedKeys: new Set(),
    });
    expect(work).toEqual([]);
  });

  it("repoAllowed: empty allow = all, allow restricts, deny wins, owner/repo matches", () => {
    expect(repoAllowed("O", "R", [], [])).toBe(true);
    expect(repoAllowed("O", "R", ["R"], [])).toBe(true);
    expect(repoAllowed("O", "R", ["X"], [])).toBe(false);
    expect(repoAllowed("O", "R", ["O/R"], [])).toBe(true);
    expect(repoAllowed("O", "R", [], ["R"])).toBe(false);
    expect(repoAllowed("O", "R", ["R"], ["R"])).toBe(false); // deny wins
  });

  it("decideWork honors repoAllow / repoDeny", () => {
    const base = { existing: new Map(), liveHeads: new Map([[key(65), "SHA1"]]), authorRepliedKeys: new Set<string>() };
    expect(decideWork({ queue: [pr(65)], ...base, repoAllow: ["other"] })).toEqual([]);
    expect(decideWork({ queue: [pr(65)], ...base, repoDeny: ["R"] })).toEqual([]);
    expect(decideWork({ queue: [pr(65)], ...base, repoAllow: ["R"] }).length).toBe(1);
  });
});

describe("keysToProbe", () => {
  it("returns lingering, non-dismissed records absent from the open set", () => {
    const ex = new Map([
      existing(1, { state: "NEEDS_REVIEW" }),
      existing(2, { state: "POSTED_AWAITING_AUTHOR" }),
      existing(3, { state: "NEEDS_REVIEW" }),                    // in open set → excluded
      existing(4, { state: "GENERATING" }),                      // in-flight → excluded
      existing(5, { state: "DONE" }),                            // terminal → excluded
      existing(6, { state: "NEEDS_REVIEW", dismissed: true }),   // dismissed → excluded
    ]);
    const openKeys = new Set([key(3)]);
    expect(keysToProbe(ex, openKeys).sort()).toEqual([key(1), key(2)].sort());
  });

  it("returns nothing when records are open, in-flight, terminal, or dismissed", () => {
    const ex = new Map([
      existing(1, { state: "POSTING" }),
      existing(2, { state: "ERROR" }),
      existing(3, { state: "STALE" }),
      existing(4, { state: "CLOSED" }),
    ]);
    expect(keysToProbe(ex, new Set())).toEqual([]);
  });
});
