import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/main/core/store";
import { api, ApiDeps } from "../src/main/core/api";
import type { PrRecord } from "../src/main/core/schema";

function seed(store: Store): PrRecord {
  const rec: PrRecord = {
    key: "git.linecorp.com/O/R#65", host: "git.linecorp.com", owner: "O", repo: "R", number: 65,
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

function mkDeps(): { deps: ApiDeps; gens: string[]; posts: string[] } {
  const store = new Store(mkdtempSync(join(tmpdir(), "api-")));
  seed(store);
  const gens: string[] = [], posts: string[] = [];
  const deps: ApiDeps = { store, nowIso: () => "2026-06-29T00:00:00Z",
    enqueueGen: (k) => gens.push(k), enqueuePost: (k) => posts.push(k) };
  return { deps, gens, posts };
}

describe("api", () => {
  it("toggleItem flips included", () => {
    const { deps } = mkDeps();
    const out = api.toggleItem(deps, "git.linecorp.com/O/R#65", "#1", false) as PrRecord;
    expect(out.draft!.findings[0].included).toBe(false);
    expect(deps.store.get("git.linecorp.com/O/R#65")!.draft!.findings[0].included).toBe(false);
  });

  it("editItem sets editedBody", () => {
    const { deps } = mkDeps();
    const out = api.editItem(deps, "git.linecorp.com/O/R#65", "#1", "**[Nit]** edited") as PrRecord;
    expect(out.draft!.findings[0].editedBody).toBe("**[Nit]** edited");
    expect(deps.store.get("git.linecorp.com/O/R#65")!.draft!.findings[0].editedBody).toBe("**[Nit]** edited");
  });

  it("toggleItem flips included on a verify item", () => {
    const store = new Store(mkdtempSync(join(tmpdir(), "api-")));
    const rec: PrRecord = {
      key: "git.linecorp.com/O/R#65", host: "git.linecorp.com", owner: "O", repo: "R", number: 65,
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
      enqueueGen: () => {}, enqueuePost: () => {} };
    const out = api.toggleItem(deps, "git.linecorp.com/O/R#65", "V1", false) as PrRecord;
    expect(out.draft!.verify[0].included).toBe(false);
    expect(deps.store.get("git.linecorp.com/O/R#65")!.draft!.verify[0].included).toBe(false);
  });

  it("submitFeedback records history, sets GENERATING, enqueues gen", () => {
    const { deps, gens } = mkDeps();
    const out = api.submitFeedback(deps, "git.linecorp.com/O/R#65", "drop #1");
    expect(out).toEqual({ ok: true });
    expect(gens).toEqual(["git.linecorp.com/O/R#65"]);
    expect(deps.store.get("git.linecorp.com/O/R#65")!.state).toBe("GENERATING");
    expect(deps.store.get("git.linecorp.com/O/R#65")!.feedbackHistory[0].text).toBe("drop #1");
  });

  it("approve sets POSTING and enqueues post", () => {
    const { deps, posts } = mkDeps();
    api.approve(deps, "git.linecorp.com/O/R#65");
    expect(posts).toEqual(["git.linecorp.com/O/R#65"]);
    expect(deps.store.get("git.linecorp.com/O/R#65")!.state).toBe("POSTING");
  });

  it("dismiss sets DISMISSED", () => {
    const { deps } = mkDeps();
    const out = api.dismiss(deps, "git.linecorp.com/O/R#65") as PrRecord;
    expect(out.state).toBe("DISMISSED");
    expect(out.doneAt).toBe("2026-06-29T00:00:00Z");
  });

  it("returns error for unknown key", () => {
    const { deps } = mkDeps();
    expect(api.get(deps, "git.linecorp.com/O/R#999")).toEqual({ error: "not found" });
  });

  it("approve returns not-found error for unknown key and does not enqueue", () => {
    const { deps, posts } = mkDeps();
    const out = api.approve(deps, "git.linecorp.com/O/R#999");
    expect(out).toEqual({ error: "not found" });
    expect(posts).toEqual([]);
  });

  it("list returns projected records", () => {
    const { deps } = mkDeps();
    const result = api.list(deps);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      key: "git.linecorp.com/O/R#65",
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
