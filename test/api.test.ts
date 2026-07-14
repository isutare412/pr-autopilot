import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/main/core/store";
import { api, ApiDeps, draftLocked, DRAFT_LOCKED_MESSAGE } from "../src/main/core/api";
import type { PrRecord, PostProgress } from "../src/main/core/schema";

function seed(store: Store): PrRecord {
  const rec: PrRecord = {
    key: "github.com/O/R#65", host: "github.com", owner: "O", repo: "R", number: 65,
    url: "x", title: "t", author: "a", baseRef: "develop", state: "NEEDS_REVIEW", mode: "first-review",
    headSha: "SHA1", draftVersion: 1,
    draft: { overallEn: "o", counts: { critical: 0, major: 0, minor: 0, nit: 1 },
      findings: [{ id: "f1", ref: "#1", path: "a.go", line: 1, side: "RIGHT", startLine: null, startSide: null,
        anchorable: true, priority: "Nit", body: "**[Nit]** x", suggestion: null, included: true, editedBody: null }],
      verify: [] },
    feedbackHistory: [], postResult: null, postProgress: null, error: null,
    discoveredAt: "t", generatedAt: "t", updatedAt: "t", doneAt: null };
  store.put(rec);
  return rec;
}

function mkDeps(): { deps: ApiDeps; gens: string[]; posts: string[]; forceApproves: string[] } {
  const store = new Store(mkdtempSync(join(tmpdir(), "api-")));
  seed(store);
  const gens: string[] = [], posts: string[] = [], forceApproves: string[] = [];
  const deps: ApiDeps = { store, nowIso: () => "2026-06-29T00:00:00Z",
    enqueueGen: (k) => gens.push(k), enqueuePost: (k) => posts.push(k),
    enqueueForceApprove: (k) => forceApproves.push(k) };
  return { deps, gens, posts, forceApproves };
}

describe("api", () => {
  it("toggleItem flips included", () => {
    const { deps } = mkDeps();
    const out = api.toggleItem(deps, "github.com/O/R#65", "#1", false) as PrRecord;
    expect(out.draft!.findings[0].included).toBe(false);
    expect(deps.store.get("github.com/O/R#65")!.draft!.findings[0].included).toBe(false);
  });

  it("editItem sets editedBody", () => {
    const { deps } = mkDeps();
    const out = api.editItem(deps, "github.com/O/R#65", "#1", "**[Nit]** edited") as PrRecord;
    expect(out.draft!.findings[0].editedBody).toBe("**[Nit]** edited");
    expect(deps.store.get("github.com/O/R#65")!.draft!.findings[0].editedBody).toBe("**[Nit]** edited");
  });

  function progress(over: Partial<PostProgress> = {}): PostProgress {
    return {
      repliesPosted: [], threadsResolved: [], reviewPosted: false, reviewerRequested: false,
      pendingReviewId: null, threadsAdded: [], threadsFailed: [], ...over,
    };
  }

  it("draftLocked is true once a pending review holds attached findings, not yet submitted", () => {
    const { deps } = mkDeps();
    const rec = deps.store.get("github.com/O/R#65")!;
    expect(draftLocked(rec)).toBe(false);   // postProgress null
    rec.postProgress = progress({ pendingReviewId: "PRR_1", threadsAdded: ["f1"] });
    expect(draftLocked(rec)).toBe(true);
    rec.postProgress = progress({ pendingReviewId: "PRR_1", threadsAdded: ["f1"], reviewPosted: true });
    expect(draftLocked(rec)).toBe(false);   // already submitted — unlocked again
  });

  it("toggleItem is rejected while the draft is locked, and leaves the item unchanged", () => {
    const { deps } = mkDeps();
    const rec = deps.store.get("github.com/O/R#65")!;
    rec.postProgress = progress({ pendingReviewId: "PRR_1", threadsAdded: ["f1"] });
    deps.store.put(rec);
    const out = api.toggleItem(deps, "github.com/O/R#65", "#1", false);
    expect(out).toEqual({ error: DRAFT_LOCKED_MESSAGE });
    expect(deps.store.get("github.com/O/R#65")!.draft!.findings[0].included).toBe(true);
  });

  it("editItem is rejected while the draft is locked, and leaves the item unchanged", () => {
    const { deps } = mkDeps();
    const rec = deps.store.get("github.com/O/R#65")!;
    rec.postProgress = progress({ pendingReviewId: "PRR_1", threadsAdded: ["f1"] });
    deps.store.put(rec);
    const out = api.editItem(deps, "github.com/O/R#65", "#1", "edited body");
    expect(out).toEqual({ error: DRAFT_LOCKED_MESSAGE });
    expect(deps.store.get("github.com/O/R#65")!.draft!.findings[0].editedBody).toBeNull();
  });

  it("toggleItem and editItem still work when postProgress carries no pendingReviewId", () => {
    const { deps } = mkDeps();
    const rec = deps.store.get("github.com/O/R#65")!;
    rec.postProgress = progress();   // pendingReviewId null
    deps.store.put(rec);
    expect((api.toggleItem(deps, "github.com/O/R#65", "#1", false) as PrRecord).draft!.findings[0].included).toBe(false);
    expect((api.editItem(deps, "github.com/O/R#65", "#1", "edited") as PrRecord).draft!.findings[0].editedBody).toBe("edited");
  });

  it("toggleItem and editItem work again once the review has been submitted", () => {
    const { deps } = mkDeps();
    const rec = deps.store.get("github.com/O/R#65")!;
    rec.postProgress = progress({ pendingReviewId: "PRR_1", threadsAdded: ["f1"], reviewPosted: true });
    deps.store.put(rec);
    expect((api.toggleItem(deps, "github.com/O/R#65", "#1", false) as PrRecord).draft!.findings[0].included).toBe(false);
    expect((api.editItem(deps, "github.com/O/R#65", "#1", "edited") as PrRecord).draft!.findings[0].editedBody).toBe("edited");
  });

  it("toggleItem flips included on a verify item", () => {
    const store = new Store(mkdtempSync(join(tmpdir(), "api-")));
    const rec: PrRecord = {
      key: "github.com/O/R#65", host: "github.com", owner: "O", repo: "R", number: 65,
      url: "x", title: "t", author: "a", baseRef: "develop", state: "NEEDS_REVIEW", mode: "re-review",
      headSha: "SHA1", draftVersion: 1,
      draft: { overallEn: "o", counts: { critical: 0, major: 0, minor: 0, nit: 0 },
        findings: [],
        verify: [{ id: "v1", ref: "V1", threadNodeId: "N1", replyTargetDatabaseId: 111,
          path: "a.go", line: 1, verdict: "resolve", rationaleEn: "fixed",
          replyBody: "확인했습니다.", included: true, editedBody: null }] },
      feedbackHistory: [], postResult: null, postProgress: null, error: null,
      discoveredAt: "t", generatedAt: "t", updatedAt: "t", doneAt: null,
    };
    store.put(rec);
    const deps: ApiDeps = { store, nowIso: () => "2026-06-29T00:00:00Z",
      enqueueGen: () => {}, enqueuePost: () => {}, enqueueForceApprove: () => {} };
    const out = api.toggleItem(deps, "github.com/O/R#65", "V1", false) as PrRecord;
    expect(out.draft!.verify[0].included).toBe(false);
    expect(deps.store.get("github.com/O/R#65")!.draft!.verify[0].included).toBe(false);
  });

  it("submitFeedback records history, sets GENERATING, enqueues gen", () => {
    const { deps, gens } = mkDeps();
    const out = api.submitFeedback(deps, "github.com/O/R#65", "drop #1");
    expect(out).toEqual({ ok: true });
    expect(gens).toEqual(["github.com/O/R#65"]);
    expect(deps.store.get("github.com/O/R#65")!.state).toBe("GENERATING");
    expect(deps.store.get("github.com/O/R#65")!.feedbackHistory[0].text).toBe("drop #1");
  });

  it("approve sets POSTING, records the verdict, and enqueues post", () => {
    const { deps, posts } = mkDeps();
    api.approve(deps, "github.com/O/R#65", "comment");
    expect(posts).toEqual(["github.com/O/R#65"]);
    const rec = deps.store.get("github.com/O/R#65")!;
    expect(rec.state).toBe("POSTING");
    expect(rec.postVerdict).toBe("comment");
  });

  it("dismiss sets the dismissed flag and preserves lifecycle state", () => {
    const { deps } = mkDeps();
    const out = api.dismiss(deps, "github.com/O/R#65") as PrRecord;
    expect(out.dismissed).toBe(true);
    expect(out.state).toBe("NEEDS_REVIEW"); // unchanged from the seed
    expect(deps.store.get("github.com/O/R#65")!.dismissed).toBe(true);
  });

  it("dismiss preserves a DONE record's state (no longer becomes DISMISSED)", () => {
    const { deps } = mkDeps();
    const rec = deps.store.get("github.com/O/R#65")!;
    rec.state = "DONE";
    rec.postResult = { reviewUrl: "u", postedAt: "t", resolvedThreadIds: [] };
    deps.store.put(rec);
    const out = api.dismiss(deps, "github.com/O/R#65") as PrRecord;
    expect(out.dismissed).toBe(true);
    expect(out.state).toBe("DONE");
  });

  it("returns error for unknown key", () => {
    const { deps } = mkDeps();
    expect(api.get(deps, "github.com/O/R#999")).toEqual({ error: "not found" });
  });

  it("approve returns not-found error for unknown key and does not enqueue", () => {
    const { deps, posts } = mkDeps();
    const out = api.approve(deps, "github.com/O/R#999", "approve");
    expect(out).toEqual({ error: "not found" });
    expect(posts).toEqual([]);
  });

  it("forceApprove sets POSTING, marks forceApprove, and enqueues the force-approve lane", () => {
    const { deps, forceApproves } = mkDeps();
    const rec = deps.store.get("github.com/O/R#65")!;
    rec.state = "POSTED_AWAITING_AUTHOR";
    deps.store.put(rec);
    const out = api.forceApprove(deps, "github.com/O/R#65");
    expect(out).toEqual({ ok: true });
    expect(forceApproves).toEqual(["github.com/O/R#65"]);
    const after = deps.store.get("github.com/O/R#65")!;
    expect(after.state).toBe("POSTING");
    expect(after.forceApprove).toBe(true);
  });

  it("forceApprove returns not-found for unknown key and does not enqueue", () => {
    const { deps, forceApproves } = mkDeps();
    expect(api.forceApprove(deps, "github.com/O/R#999")).toEqual({ error: "not found" });
    expect(forceApproves).toEqual([]);
  });

  it("restore clears the dismissed flag and preserves lifecycle state", () => {
    const { deps } = mkDeps();
    const rec = deps.store.get("github.com/O/R#65")!;
    rec.state = "DONE";
    rec.dismissed = true;
    deps.store.put(rec);
    const out = api.restore(deps, "github.com/O/R#65") as PrRecord;
    expect(out.dismissed).toBe(false);
    expect(out.state).toBe("DONE");
    expect(deps.store.get("github.com/O/R#65")!.dismissed).toBe(false);
  });

  it("list includes the dismissed flag for each row", () => {
    const { deps } = mkDeps();
    api.dismiss(deps, "github.com/O/R#65");
    const { items } = api.list(deps) as { items: Array<{ key: string; dismissed: boolean }> };
    expect(items.find((r) => r.key === "github.com/O/R#65")!.dismissed).toBe(true);
  });

  it("restore returns not-found for an unknown key", () => {
    const { deps } = mkDeps();
    expect(api.restore(deps, "github.com/O/R#999")).toEqual({ error: "not found" });
  });

  it("delete removes the record and returns ok", () => {
    const { deps } = mkDeps();
    expect(api.delete(deps, "github.com/O/R#65")).toEqual({ ok: true });
    expect(deps.store.get("github.com/O/R#65")).toBeNull();
  });

  it("delete returns not-found for an unknown key", () => {
    const { deps } = mkDeps();
    expect(api.delete(deps, "github.com/O/R#999")).toEqual({ error: "not found" });
  });

  it("list returns projected records", () => {
    const { deps } = mkDeps();
    const result = api.list(deps);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      key: "github.com/O/R#65",
      number: 65,
      repo: "R",
      title: "t",
      state: "NEEDS_REVIEW",
      mode: "first-review",
      counts: { critical: 0, major: 0, minor: 0, nit: 1 },
      updatedAt: "t",
    });
  });
});
