import { describe, it, expect } from "vitest";
import { draftLocked as core } from "../../src/main/core/api";
import { draftLocked as ui } from "../../src/renderer/src/components/Detail";
import type { PrRecord, PostProgress, PrState } from "../../src/main/core/schema";
import type { UiRecord } from "../../src/renderer/src/types";

// Lives under test/renderer/ (as a .tsx) rather than alongside the other
// hand-synced-pair parity tests at the top of test/, because Detail.tsx is a
// JSX component and only tsconfig.web.json's program can type-check it; a
// plain .ts file under tsconfig.node.json cannot import it. Same idea as
// test/queueSort-parity.test.ts and test/guard-shim.test.ts for their own
// hand-synced pairs — api.ts's draftLocked (gating toggleItem / editItem /
// submitFeedback) and Detail.tsx's draftLocked (gating the equivalent
// renderer controls) must always agree.
function progress(over: Partial<PostProgress> = {}): PostProgress {
  return {
    repliesPosted: [], threadsResolved: [], reviewPosted: false, reviewerRequested: false,
    pendingReviewId: null, threadsAdded: [], threadsFailed: [], ...over,
  };
}

/** Only `state` and `postProgress` are read by either copy — everything else
 *  is irrelevant to the predicate, so the minimal shared shape is cast to
 *  each side's full record type. */
function check(state: PrState, postProgress: PostProgress | null, expected: boolean) {
  const rec = { state, postProgress } as unknown as PrRecord;
  const uiRec = { state, postProgress } as unknown as UiRecord;
  expect(core(rec)).toBe(expected);
  expect(ui(uiRec)).toBe(expected);
  expect(core(rec)).toBe(ui(uiRec));
}

describe("draftLocked parity: api.ts vs Detail.tsx", () => {
  it("unlocked with no postProgress", () => check("NEEDS_REVIEW", null, false));

  it("locked whenever state is POSTING, even with no postProgress yet", () => check("POSTING", null, true));

  it("locked once a pending review exists on GitHub, even with nothing attached (FINDING C-1)", () =>
    check("NEEDS_REVIEW", progress({ pendingReviewId: "PRR_1" }), true));

  it("locked once a pending review holds an attached finding", () =>
    check("NEEDS_REVIEW", progress({ pendingReviewId: "PRR_1", threadsAdded: ["f1"] }), true));

  it("locked once a pending review holds a permanently-failed finding", () =>
    check("NEEDS_REVIEW", progress({ pendingReviewId: "PRR_1", threadsFailed: ["f1"] }), true));

  it("locked once a reply has posted, even with no pendingReviewId", () =>
    check("NEEDS_REVIEW", progress({ repliesPosted: ["v1"] }), true));

  it("locked once a thread has resolved, even with no pendingReviewId", () =>
    check("NEEDS_REVIEW", progress({ threadsResolved: ["v1"] }), true));

  it("unlocked once the review has been submitted, no matter what landed beforehand", () =>
    check("POSTED_AWAITING_AUTHOR", progress({
      pendingReviewId: "PRR_1", threadsAdded: ["f1"], threadsFailed: ["f2"],
      repliesPosted: ["v1"], threadsResolved: ["v1"], reviewPosted: true,
    }), false));

  it("unlocked in ERROR with an empty-shaped postProgress object (nothing landed)", () =>
    check("ERROR", progress(), false));
});
