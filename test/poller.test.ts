import { describe, it, expect } from "vitest";
import { decideWork, repoAllowed, authorAwaitingReview } from "../src/main/core/poller";
import type { PrRecord } from "../src/main/core/schema";
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
const key = (n: number) => `git.linecorp.com/O/R#${n}`;

function existing(number: number, over: Partial<PrRecord>): [string, PrRecord] {
  return [key(number), { key: key(number), host: "git.linecorp.com", owner: "O", repo: "R", number,
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
