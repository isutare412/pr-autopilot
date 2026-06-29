import { describe, it, expect } from "vitest";
import { Gh, GhRunner } from "../src/main/core/gh";
import { execute, buildReviewPayload } from "../src/main/core/executor";
import type { PrRecord } from "../src/main/core/schema";

function baseRec(over: Partial<PrRecord> = {}): PrRecord {
  return {
    key: "git.linecorp.com/O/R#65", host: "git.linecorp.com", owner: "O", repo: "R",
    number: 65, url: "http://x", title: "t", author: "a", baseRef: "develop",
    state: "POSTING", mode: "first-review", headSha: "SHA1", draftVersion: 1,
    draft: { overallEn: "o", counts: { critical: 1, major: 0, minor: 0, nit: 1 },
      findings: [
        { id: "f1", ref: "#1", path: "a.go", line: 142, side: "RIGHT", startLine: null, startSide: null,
          anchorable: true, priority: "Critical", body: "**[Critical]** leak", suggestion: null,
          included: true, editedBody: null },
        { id: "f2", ref: "#2", path: "b.go", line: 9, side: "RIGHT", startLine: null, startSide: null,
          anchorable: true, priority: "Nit", body: "**[Nit]** name", suggestion: null,
          included: false, editedBody: null },  // dropped
      ], verify: [] },
    feedbackHistory: [], postResult: null, postProgress: null, error: null,
    discoveredAt: "t", generatedAt: "t", updatedAt: "t", doneAt: null, ...over,
  };
}

class Recorder implements GhRunner {
  public calls: { args: string[]; input?: string }[] = [];
  constructor(private map: (args: string[]) => string) {}
  async run(args: string[], input?: string) { this.calls.push({ args, input }); return this.map(args); }
}

function ghWith(headSha: string): { gh: Gh; rec: Recorder } {
  const rec = new Recorder((args) => {
    if (args.includes("headRefOid")) return headSha;
    if (args.some((a) => a.includes("/reviews"))) return JSON.stringify({ html_url: "http://x/r/1" });
    return "{}";
  });
  return { gh: new Gh(rec, "git.linecorp.com"), rec };
}

describe("buildReviewPayload", () => {
  it("includes only included findings, COMMENT event, empty body", () => {
    const p = buildReviewPayload(baseRec(), "SHA1");
    expect(p.event).toBe("COMMENT");
    expect(p.body).toBe("");
    expect(p.commit_id).toBe("SHA1");
    expect(p.comments!.length).toBe(1);
    expect(p.comments![0].path).toBe("a.go");
  });

  it("uses editedBody over body", () => {
    const r = baseRec();
    r.draft!.findings[0].editedBody = "**[Critical]** edited";
    expect(buildReviewPayload(r, "SHA1").comments![0].body).toBe("**[Critical]** edited");
  });

  it("folds unanchorable findings into the body", () => {
    const r = baseRec();
    r.draft!.findings[0].anchorable = false;
    const p = buildReviewPayload(r, "SHA1");
    expect(p.comments!.length).toBe(0);
    expect(p.body).toContain("a.go");
    expect(p.body).toContain("leak");
  });

  it("includes start_line/start_side for a spanning finding", () => {
    const r = baseRec();
    r.draft!.findings[0].startLine = 10;
    r.draft!.findings[0].startSide = "RIGHT";
    const p = buildReviewPayload(r, "SHA1");
    expect(p.comments![0].start_line).toBe(10);
    expect(p.comments![0].start_side).toBe("RIGHT");
  });

  it("emits APPROVE + LGTM when there are zero findings", () => {
    const r = baseRec();
    r.draft = { overallEn: "clean", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };
    const p = buildReviewPayload(r, "SHA1");
    expect(p.event).toBe("APPROVE");
    expect(p.body).toBe("LGTM :+1:");
    expect(p.comments).toBeUndefined();
  });
});

describe("execute", () => {
  it("posts review + re-requests self when findings remain", async () => {
    const { gh, rec } = ghWith("SHA1");
    const out = await execute(gh, baseRec(), "me", "2026-06-29T00:00:00Z");
    expect(out.state).toBe("POSTED_AWAITING_AUTHOR");
    expect(out.postResult?.reviewUrl).toBe("http://x/r/1");
    expect(rec.calls.some((c) => c.args.includes("/repos/O/R/pulls/65/requested_reviewers"))).toBe(true);
  });

  it("transitions to STALE without posting when head SHA moved", async () => {
    const { gh, rec } = ghWith("SHA2");  // live head differs from rec.headSha=SHA1
    const out = await execute(gh, baseRec(), "me", "2026-06-29T00:00:00Z");
    expect(out.state).toBe("STALE");
    // post NOTHING: only the headSha preflight call may have run
    expect(rec.calls.length).toBe(1);
    expect(rec.calls[0].args).toContain("headRefOid");
  });

  it("DONE + no re-request on a clean LGTM", async () => {
    const { gh, rec } = ghWith("SHA1");
    const clean = baseRec();
    clean.draft = { overallEn: "clean", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };
    const out = await execute(gh, clean, "me", "2026-06-29T00:00:00Z");
    expect(out.state).toBe("DONE");
    expect(rec.calls.some((c) => c.args.includes("/repos/O/R/pulls/65/requested_reviewers"))).toBe(false);
  });

  it("resumes without re-posting the review when postProgress.reviewPosted is set", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec();
    r.postProgress = { repliesPosted: [], threadsResolved: [], reviewPosted: true, reviewerRequested: false };
    r.postResult = { reviewUrl: "http://existing/r/1", postedAt: "t", resolvedThreadIds: [] };
    const out = await execute(gh, r, "me", "2026-06-29T00:00:00Z");
    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/reviews")))).toBe(false);
    expect(out.postResult?.reviewUrl).toBe("http://existing/r/1");
    expect(out.state).toBe("POSTED_AWAITING_AUTHOR");
  });

  it("calls onProgress after posting, with reviewPosted=true", async () => {
    const { gh } = ghWith("SHA1");
    const saved: any[] = [];
    await execute(gh, baseRec(), "me", "2026-06-29T00:00:00Z", (p) => saved.push({ ...p }));
    expect(saved.length).toBeGreaterThan(0);
    expect(saved[saved.length - 1].reviewPosted).toBe(true);
  });

  it("re-review: posts replies, resolves only resolve-verdict threads, then review", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec({ mode: "re-review" });
    r.draft!.verify = [
      { id: "v1", ref: "V1", threadNodeId: "N1", replyTargetDatabaseId: 111, path: "a.go", line: 1,
        verdict: "resolve", rationaleEn: "fixed", replyBody: "확인했습니다.", included: true, editedBody: null },
      { id: "v2", ref: "V2", threadNodeId: "N2", replyTargetDatabaseId: 222, path: "b.go", line: 2,
        verdict: "follow-up", rationaleEn: "still open", replyBody: "**[Major]** ...", included: true, editedBody: null },
    ];
    const out = await execute(gh, r, "me", "2026-06-29T00:00:00Z");
    const joined = rec.calls.map((c) => c.args.join(" "));
    expect(joined.some((a) => a.includes("/comments/111/replies"))).toBe(true);
    expect(joined.some((a) => a.includes("/comments/222/replies"))).toBe(true);
    // only N1 (resolve) resolved, not N2 (follow-up)
    expect(rec.calls.some((c) => c.args.includes("threadId=N1"))).toBe(true);
    expect(rec.calls.some((c) => c.args.includes("threadId=N2"))).toBe(false);
    expect(out.postResult?.resolvedThreadIds).toEqual(["N1"]);
  });

  it("re-review posts editedBody over replyBody for a verify reply", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec({ mode: "re-review" });
    r.draft!.verify = [
      { id: "v1", ref: "V1", threadNodeId: "N1", replyTargetDatabaseId: 111, path: "a.go", line: 1,
        verdict: "follow-up", rationaleEn: "x", replyBody: "**[Major]** orig", included: true, editedBody: "**[Major]** edited" },
    ];
    await execute(gh, r, "me", "2026-06-29T00:00:00Z");
    const reply = rec.calls.find((c) => c.args.some((a) => a.includes("/comments/111/replies")));
    expect(reply?.input).toContain("edited");
  });

  it("re-review does not reply to a needs-call verdict", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec({ mode: "re-review" });
    r.draft!.verify = [
      { id: "v1", ref: "V1", threadNodeId: "N1", replyTargetDatabaseId: 111, path: "a.go", line: 1,
        verdict: "needs-call", rationaleEn: "ask", replyBody: "", included: true, editedBody: null },
    ];
    await execute(gh, r, "me", "2026-06-29T00:00:00Z");
    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/comments/111/replies")))).toBe(false);
  });
});
