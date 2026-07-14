import { describe, it, expect } from "vitest";
import { GeneratedDraft, PrRecord, prKey, fileKey, LANGUAGE_LABEL, PostProgress, migrateRecord } from "../src/main/core/schema";

describe("GeneratedDraft", () => {
  it("applies defaults for user-only fields Claude omits", () => {
    const parsed = GeneratedDraft.parse({
      overallEn: "take",
      counts: { critical: 0, major: 0, minor: 0, nit: 1 },
      findings: [{
        id: "f1", ref: "#1", path: "a.go", line: 10, side: "RIGHT",
        anchorable: true, priority: "Nit", body: "**[Nit]** ...",
      }],
      verify: [],
    });
    expect(parsed.findings[0].included).toBe(true);
    expect(parsed.findings[0].editedBody).toBeNull();
    expect(parsed.findings[0].startLine).toBeNull();
  });

  it("rejects an invalid priority", () => {
    expect(() => GeneratedDraft.parse({
      overallEn: "t", counts: { critical: 0, major: 0, minor: 0, nit: 0 },
      findings: [{ id: "f1", ref: "#1", path: "a.go", line: 1, side: "RIGHT",
        anchorable: true, priority: "Blocker", body: "x" }],
      verify: [],
    })).toThrow();
  });
});

describe("keys", () => {
  it("builds prKey and fileKey", () => {
    expect(prKey("github.com", "O", "R", 65)).toBe("github.com/O/R#65");
    expect(fileKey("github.com", "O", "R", 65)).toBe("github.com__O__R__65");
  });
});

describe("PrRecord", () => {
  it("validates a minimal record", () => {
    const rec = PrRecord.parse({
      key: "github.com/O/R#65", host: "github.com",
      owner: "O", repo: "R", number: 65, url: "http://x", title: "t",
      author: "a", baseRef: "develop", state: "DISCOVERED", mode: "first-review",
      headSha: "abc", draftVersion: 0, draft: null, feedbackHistory: [],
      postResult: null, postProgress: null, error: null,
      discoveredAt: "2026-06-29T00:00:00Z", generatedAt: null,
      updatedAt: "2026-06-29T00:00:00Z", doneAt: null,
    });
    expect(rec.state).toBe("DISCOVERED");
  });
});

describe("Language labels", () => {
  it("maps codes to display names", () => {
    expect(LANGUAGE_LABEL).toEqual({ en: "English", ko: "Korean", ja: "Japanese" });
  });
});

describe("PostProgress", () => {
  it("round-trips the two halves", () => {
    const p = PostProgress.parse({
      sent: { repliedTargets: [111], resolvedThreads: ["N1"] },
      review: { pendingReviewId: "PRR_1", threadsAdded: ["f1"], threadsFailed: ["f2"] },
      reviewPosted: false, reviewerRequested: false,
    });
    expect(p.sent.repliedTargets).toEqual([111]);
    expect(p.sent.resolvedThreads).toEqual(["N1"]);
    expect(p.review.pendingReviewId).toBe("PRR_1");
    expect(p.review.threadsAdded).toEqual(["f1"]);
    expect(p.review.threadsFailed).toEqual(["f2"]);
  });
});

/** Records written by the shipping version keyed repliesPosted / threadsResolved by
 *  *local verify-item ids*. migrateRecord re-keys them onto the GitHub-side ids the
 *  mutations actually landed against, using the record's own draft. */
describe("migrateRecord — the pre-split postProgress", () => {
  const verifyItem = (id: string, threadNodeId: string, replyTargetDatabaseId: number) => ({
    id, ref: id.toUpperCase(), threadNodeId, replyTargetDatabaseId, path: "a.go", line: 1,
    verdict: "resolve", rationaleEn: "fixed", replyBody: "done", included: true, editedBody: null,
  });

  const oldRecord = (postProgress: unknown, verify: unknown[]) => ({
    key: "github.com/O/R#65", host: "github.com", owner: "O", repo: "R", number: 65,
    url: "http://x", title: "t", author: "a", baseRef: "develop", state: "ERROR",
    mode: "re-review", headSha: "SHA1", draftVersion: 1,
    draft: { overallEn: "o", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify },
    feedbackHistory: [], postResult: null, postProgress, error: null,
    discoveredAt: "t", generatedAt: "t", updatedAt: "t", doneAt: null,
  });

  it("re-keys local verify ids onto replyTargetDatabaseId / threadNodeId", () => {
    const rec = PrRecord.parse(migrateRecord(oldRecord(
      { repliesPosted: ["v1", "v2"], threadsResolved: ["v1"], reviewPosted: false, reviewerRequested: false,
        pendingReviewId: "PRR_1", threadsAdded: ["f1"], threadsFailed: [] },
      [verifyItem("v1", "N1", 111), verifyItem("v2", "N2", 222)],
    )));

    // the sent half now speaks GitHub's ids, so it survives the next re-draft
    expect(rec.postProgress!.sent.repliedTargets).toEqual([111, 222]);
    expect(rec.postProgress!.sent.resolvedThreads).toEqual(["N1"]);
    // the review half is carried across as-is — it is already keyed by finding ids
    expect(rec.postProgress!.review.pendingReviewId).toBe("PRR_1");
    expect(rec.postProgress!.review.threadsAdded).toEqual(["f1"]);
  });

  it("defaults the review half when the record predates the pending-review fields", () => {
    const rec = PrRecord.parse(migrateRecord(oldRecord(
      { repliesPosted: ["v1"], threadsResolved: [], reviewPosted: false, reviewerRequested: false },
      [verifyItem("v1", "N1", 111)],
    )));
    expect(rec.postProgress!.sent.repliedTargets).toEqual([111]);
    expect(rec.postProgress!.review).toEqual({ pendingReviewId: null, threadsAdded: [], threadsFailed: [] });
  });

  it("fails safe on an unmappable id: every thread in the draft counts as already sent", () => {
    // "vGONE" is in the ledger but not in the draft — we know a reply landed, but not
    // on which thread. Skipping a reply is recoverable; sending a second copy is not.
    const rec = PrRecord.parse(migrateRecord(oldRecord(
      { repliesPosted: ["vGONE"], threadsResolved: ["vGONE"], reviewPosted: false, reviewerRequested: false },
      [verifyItem("v1", "N1", 111), verifyItem("v2", "N2", 222)],
    )));
    expect([...rec.postProgress!.sent.repliedTargets].sort()).toEqual([111, 222]);
    expect([...rec.postProgress!.sent.resolvedThreads].sort()).toEqual(["N1", "N2"]);
  });

  it("leaves an already-migrated record alone", () => {
    const already = {
      sent: { repliedTargets: [111], resolvedThreads: [] },
      review: { pendingReviewId: null, threadsAdded: [], threadsFailed: [] },
      reviewPosted: true, reviewerRequested: true,
    };
    const rec = PrRecord.parse(migrateRecord(oldRecord(already, [verifyItem("v1", "N1", 999)])));
    expect(rec.postProgress).toEqual(already);   // not re-keyed against the draft again
  });

  it("leaves a record with no postProgress alone", () => {
    const rec = PrRecord.parse(migrateRecord(oldRecord(null, [])));
    expect(rec.postProgress).toBeNull();
  });

  it("never reports an empty sent half when the old ledger was non-empty but the draft is gone", () => {
    // Same "something landed, but we can't say what" situation as the unmappable-id
    // case above — except here there is no draft at all to fall back onto, so the
    // usual "mark every thread in the draft as sent" fallback has nothing to mark.
    // Coming back with an *empty* sent half would silently forget the mutation ever
    // happened — the one direction migratePostProgress must never take.
    const raw = { ...oldRecord(
      { repliesPosted: ["v1"], threadsResolved: ["v1"], reviewPosted: false, reviewerRequested: false },
      [],
    ), draft: null };
    const rec = PrRecord.parse(migrateRecord(raw));
    const sent = rec.postProgress!.sent;
    expect(sent.repliedTargets.length > 0 || sent.resolvedThreads.length > 0).toBe(true);
  });
});
