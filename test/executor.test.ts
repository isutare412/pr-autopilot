import { describe, it, expect } from "vitest";
import { Gh, GhRunner } from "../src/main/core/gh";
import {
  execute, buildReviewPayload, buildThreadSpecs, fileThreadBody, buildSubmitBody,
  defaultVerdict, forceApprove,
} from "../src/main/core/executor";
import type { PrRecord, PostProgress } from "../src/main/core/schema";

function baseRec(over: Partial<PrRecord> = {}): PrRecord {
  return {
    key: "github.com/O/R#65", host: "github.com", owner: "O", repo: "R",
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

function ghWith(headSha: string, state = "OPEN"): { gh: Gh; rec: Recorder } {
  const rec = new Recorder((args) => {
    const joined = args.join(" ");
    if (args.includes("state,headRefOid,id")) return JSON.stringify({ state, headRefOid: headSha, id: "PR_node1" });
    if (joined.includes("reviews(first:1,states:PENDING"))
      return JSON.stringify({ data: { repository: { pullRequest: { reviews: { nodes: [] } } } } });
    if (joined.includes("addPullRequestReview(input"))
      return JSON.stringify({ data: { addPullRequestReview: { pullRequestReview: { id: "PRR_1" } } } });
    if (joined.includes("addPullRequestReviewThread"))
      return JSON.stringify({ data: { addPullRequestReviewThread: { thread: { id: "T1" } } } });
    if (joined.includes("submitPullRequestReview"))
      return JSON.stringify({ data: { submitPullRequestReview: { pullRequestReview: { url: "http://x/r/1" } } } });
    if (args.some((a) => a.includes("/reviews"))) return JSON.stringify({ html_url: "http://x/r/1" });
    return "{}";
  });
  return { gh: new Gh(rec, "github.com"), rec };
}

/** The thread mutations that actually ran, in order. */
function threadCalls(rec: Recorder) {
  return rec.calls.filter((c) => c.args.join(" ").includes("addPullRequestReviewThread"));
}
function submitCall(rec: Recorder) {
  return rec.calls.find((c) => c.args.join(" ").includes("submitPullRequestReview"));
}
function argValue(call: { args: string[] }, name: string): string | undefined {
  return call.args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

describe("buildThreadSpecs", () => {
  it("includes only included findings", () => {
    const specs = buildThreadSpecs(baseRec().draft!);   // f1 included, f2 dropped
    expect(specs.length).toBe(1);
    expect(specs[0].id).toBe("f1");
  });

  it("an anchorable finding gets a LINE attempt carrying line and side", () => {
    const s = buildThreadSpecs(baseRec().draft!)[0];
    expect(s.line).toEqual({
      path: "a.go", body: "**[Critical]** leak", subjectType: "LINE", line: 142, side: "RIGHT",
    });
  });

  it("a spanning finding carries startLine and startSide", () => {
    const d = baseRec().draft!;
    d.findings[0].startLine = 10;
    d.findings[0].startSide = "RIGHT";
    expect(buildThreadSpecs(d)[0].line).toMatchObject({ startLine: 10, startSide: "RIGHT", line: 142 });
  });

  it("a spanning finding with no startSide falls back to the finding's side", () => {
    const d = baseRec().draft!;
    d.findings[0].startLine = 10;
    d.findings[0].startSide = null;
    expect(buildThreadSpecs(d)[0].line).toMatchObject({ startSide: "RIGHT" });
  });

  it("an unanchorable finding gets no LINE attempt, only a FILE one", () => {
    const d = baseRec().draft!;
    d.findings[0].anchorable = false;
    const s = buildThreadSpecs(d)[0];
    expect(s.line).toBeNull();
    expect(s.file.subjectType).toBe("FILE");
    expect(s.file.path).toBe("a.go");
    expect(s.file.line).toBeUndefined();
  });

  it("every spec carries a FILE fallback, even an anchorable one", () => {
    const s = buildThreadSpecs(baseRec().draft!)[0];
    expect(s.file.subjectType).toBe("FILE");
    expect(s.file.body).toContain("line 142");   // the fallback body names the line
  });

  it("uses editedBody over body in both attempts", () => {
    const d = baseRec().draft!;
    d.findings[0].editedBody = "**[Critical]** edited";
    const s = buildThreadSpecs(d)[0];
    expect(s.line!.body).toBe("**[Critical]** edited");
    expect(s.file.body).toContain("edited");
  });
});

describe("fileThreadBody", () => {
  it("prefixes the line, since a file-level thread has no line anchor", () => {
    const f = baseRec().draft!.findings[0];    // line 142
    expect(fileThreadBody(f)).toBe("`line 142`\n\n**[Critical]** leak");
  });

  it("prefixes a range for a spanning finding", () => {
    const f = { ...baseRec().draft!.findings[0], startLine: 130 };
    expect(fileThreadBody(f)).toBe("`lines 130–142`\n\n**[Critical]** leak");
  });

  it("omits the prefix when there is no meaningful line", () => {
    const f = { ...baseRec().draft!.findings[0], line: 0 };
    expect(fileThreadBody(f)).toBe("**[Critical]** leak");
  });
});

describe("buildSubmitBody", () => {
  it("an approve with nothing failed is just the LGTM line", () => {
    expect(buildSubmitBody("approve", [])).toBe("LGTM :+1:");
  });

  it("a comment with nothing failed is empty", () => {
    expect(buildSubmitBody("comment", [])).toBe("");
  });

  it("folds a failed finding under the LGTM, labeled with its location", () => {
    const f = baseRec().draft!.findings[0];
    const body = buildSubmitBody("approve", [f]);
    expect(body).toContain("LGTM :+1:");
    expect(body).toContain("a.go:142 — **[Critical]** leak");
  });

  it("prefers editedBody in the fold", () => {
    const f = { ...baseRec().draft!.findings[0], editedBody: "**[Critical]** edited" };
    expect(buildSubmitBody("comment", [f])).toContain("edited");
  });
});

// These two survive the Task 5 shrink unchanged — they pin the only cases
// buildReviewPayload will still be responsible for.
describe("buildReviewPayload (zero-findings cases)", () => {
  it("emits APPROVE + LGTM when there are zero findings", () => {
    const r = baseRec();
    r.draft = { overallEn: "clean", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };
    const p = buildReviewPayload(r, "SHA1") as any;
    expect(p.event).toBe("APPROVE");
    expect(p.body).toBe("LGTM :+1:");
    expect(p.comments).toBeUndefined();
  });

  it("comment verdict with zero findings → null (replies/resolves carry it)", () => {
    const r = baseRec();
    r.draft = { overallEn: "re-review", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };
    expect(buildReviewPayload(r, "SHA1", "comment")).toBeNull();
  });
});

describe("defaultVerdict", () => {
  const nit = () => ({ ...baseRec().draft!.findings[1], included: true }); // f2 = Nit
  const critical = () => baseRec().draft!.findings[0];                     // f1 = Critical, included
  const verifyItem = (verdict: "resolve" | "follow-up" | "needs-call") => ({
    id: "v1", ref: "V1", threadNodeId: "N1", replyTargetDatabaseId: 111, path: "a.go", line: 1,
    verdict, rationaleEn: "r", replyBody: "", included: true, editedBody: null,
  });

  it("empty draft → approve", () => {
    const d = baseRec().draft!; d.findings = []; d.verify = [];
    expect(defaultVerdict(d)).toBe("approve");
  });
  it("nit-only findings → approve", () => {
    const d = baseRec().draft!; d.findings = [nit()]; d.verify = [];
    expect(defaultVerdict(d)).toBe("approve");
  });
  it("a non-Nit finding → comment", () => {
    const d = baseRec().draft!; d.findings = [critical()]; d.verify = [];
    expect(defaultVerdict(d)).toBe("comment");
  });
  it("nit finding + open follow-up thread → comment", () => {
    const d = baseRec().draft!; d.findings = [nit()]; d.verify = [verifyItem("follow-up")];
    expect(defaultVerdict(d)).toBe("comment");
  });
  it("nit finding + resolve-only reply → approve", () => {
    const d = baseRec().draft!; d.findings = [nit()]; d.verify = [verifyItem("resolve")];
    expect(defaultVerdict(d)).toBe("approve");
  });
  it("an excluded non-Nit finding does not force comment", () => {
    const d = baseRec().draft!; d.findings = [{ ...critical(), included: false }, nit()]; d.verify = [];
    expect(defaultVerdict(d)).toBe("approve");
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

  it("approve verdict: posts an APPROVE review, no re-request, DONE", async () => {
    const { gh, rec } = ghWith("SHA1");
    const out = await execute(gh, baseRec({ postVerdict: "approve" }), "me", "2026-06-29T00:00:00Z");
    expect(argValue(submitCall(rec)!, "event")).toBe("APPROVE");
    expect(rec.calls.some((c) => c.args.includes("/repos/O/R/pulls/65/requested_reviewers"))).toBe(false);
    expect(out.state).toBe("DONE");
  });

  it("comment verdict with no new findings (re-review): no review call, re-requests, awaits author", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec({ mode: "re-review", postVerdict: "comment" });
    r.draft = { overallEn: "re-review", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [],
      verify: [
        { id: "v1", ref: "V1", threadNodeId: "N1", replyTargetDatabaseId: 111, path: "a.go", line: 1,
          verdict: "resolve", rationaleEn: "fixed", replyBody: "확인했습니다.", included: true, editedBody: null },
      ] };
    const out = await execute(gh, r, "me", "2026-06-29T00:00:00Z");
    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/reviews")))).toBe(false);
    expect(rec.calls.some((c) => c.args.includes("/repos/O/R/pulls/65/requested_reviewers"))).toBe(true);
    expect(out.state).toBe("POSTED_AWAITING_AUTHOR");
    expect(out.postResult?.resolvedThreadIds).toEqual(["N1"]);
  });

  it("transitions to STALE without posting when head SHA moved", async () => {
    const { gh, rec } = ghWith("SHA2");  // live head differs from rec.headSha=SHA1
    const out = await execute(gh, baseRec(), "me", "2026-06-29T00:00:00Z");
    expect(out.state).toBe("STALE");
    // post NOTHING: only the prStatus preflight call may have run
    expect(rec.calls.length).toBe(1);
    expect(rec.calls[0].args).toContain("state,headRefOid,id");
  });

  it("transitions to CLOSED without posting when the PR is merged", async () => {
    const { gh, rec } = ghWith("SHA1", "MERGED");
    const out = await execute(gh, baseRec(), "me", "2026-06-29T00:00:00Z");
    expect(out.state).toBe("CLOSED");
    expect(rec.calls.length).toBe(1);                 // only the prStatus preflight ran
    expect(rec.calls[0].args).toContain("state,headRefOid,id");
    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/reviews")))).toBe(false);
  });

  it("transitions to CLOSED when the PR is closed without merging", async () => {
    const { gh } = ghWith("SHA1", "CLOSED");
    const out = await execute(gh, baseRec(), "me", "2026-06-29T00:00:00Z");
    expect(out.state).toBe("CLOSED");
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
    r.postProgress = {
      repliesPosted: [], threadsResolved: [], reviewPosted: true, reviewerRequested: false,
      pendingReviewId: null, threadsAdded: [], threadsFailed: [],
    };
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

  it("automated nit-only draft (no postVerdict): APPROVE + LGTM, DONE, no re-request", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec();
    r.draft!.findings = [{ ...r.draft!.findings[1], included: true }]; // Nit only
    const out = await execute(gh, r, "me", "2026-06-29T00:00:00Z");
    expect(argValue(submitCall(rec)!, "event")).toBe("APPROVE");
    expect(argValue(submitCall(rec)!, "body")).toBe("LGTM :+1:");
    expect(rec.calls.some((c) => c.args.includes("/repos/O/R/pulls/65/requested_reviewers"))).toBe(false);
    expect(out.state).toBe("DONE");
  });

  it("automated nit + open follow-up thread: COMMENT + re-request, awaits author", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec({ mode: "re-review" });
    r.draft!.findings = [{ ...r.draft!.findings[1], included: true }]; // Nit
    r.draft!.verify = [
      { id: "v2", ref: "V2", threadNodeId: "N2", replyTargetDatabaseId: 222, path: "b.go", line: 2,
        verdict: "follow-up", rationaleEn: "still open", replyBody: "**[Major]** ...", included: true, editedBody: null },
    ];
    const out = await execute(gh, r, "me", "2026-06-29T00:00:00Z");
    expect(argValue(submitCall(rec)!, "event")).toBe("COMMENT");
    expect(rec.calls.some((c) => c.args.includes("/repos/O/R/pulls/65/requested_reviewers"))).toBe(true);
    expect(out.state).toBe("POSTED_AWAITING_AUTHOR");
  });
});

describe("execute → pending-review flow", () => {
  /** The regression this whole change exists for: an approve carrying one
   *  anchorable and one out-of-diff nit. Both must become threads, and the body
   *  must be nothing but the LGTM line. */
  it("approve with an anchorable and an unanchorable nit → two threads, LGTM-only body", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec();
    r.draft!.findings = [
      { id: "f1", ref: "#1", path: "a.go", line: 460, side: "RIGHT", startLine: null, startSide: null,
        anchorable: true, priority: "Nit", body: "**[Nit]** inline", suggestion: null, included: true, editedBody: null },
      { id: "f2", ref: "#2", path: "a.go", line: 547, side: "RIGHT", startLine: null, startSide: null,
        anchorable: false, priority: "Nit", body: "**[Nit]** doc drift", suggestion: null, included: true, editedBody: null },
    ];
    const out = await execute(gh, r, "me", "2026-07-14T00:00:00Z");

    const threads = threadCalls(rec);
    expect(threads.length).toBe(2);
    expect(argValue(threads[0], "subject")).toBe("LINE");
    expect(argValue(threads[0], "line")).toBe("460");
    expect(argValue(threads[1], "subject")).toBe("FILE");
    expect(argValue(threads[1], "body")).toContain("line 547");
    expect(argValue(threads[1], "body")).toContain("doc drift");

    const submit = submitCall(rec)!;
    expect(argValue(submit, "event")).toBe("APPROVE");
    expect(argValue(submit, "body")).toBe("LGTM :+1:");   // nothing folded in

    expect(out.state).toBe("DONE");
    expect(out.postResult?.reviewUrl).toBe("http://x/r/1");
  });

  it("creates the pending review against the live head sha and the PR node id", async () => {
    const { gh, rec } = ghWith("SHA1");
    await execute(gh, baseRec(), "me", "2026-07-14T00:00:00Z");
    const create = rec.calls.find((c) => c.args.join(" ").includes("addPullRequestReview(input"))!;
    expect(create.args).toContain("prId=PR_node1");
    expect(create.args).toContain("oid=SHA1");
  });

  it("comment verdict submits COMMENT and re-requests self", async () => {
    const { gh, rec } = ghWith("SHA1");
    const out = await execute(gh, baseRec(), "me", "2026-07-14T00:00:00Z");  // f1 Critical → comment
    expect(argValue(submitCall(rec)!, "event")).toBe("COMMENT");
    expect(rec.calls.some((c) => c.args.includes("/repos/O/R/pulls/65/requested_reviewers"))).toBe(true);
    expect(out.state).toBe("POSTED_AWAITING_AUTHOR");
  });

  it("zero findings + approve → the bare REST LGTM, no pending review at all", async () => {
    const { gh, rec } = ghWith("SHA1");
    const clean = baseRec();
    clean.draft = { overallEn: "clean", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };
    const out = await execute(gh, clean, "me", "2026-07-14T00:00:00Z");
    const restReview = rec.calls.find((c) => c.args.some((a) => a.includes("/pulls/65/reviews")));
    expect(JSON.parse(restReview!.input!)).toMatchObject({ event: "APPROVE", body: "LGTM :+1:" });
    expect(rec.calls.some((c) => c.args.join(" ").includes("addPullRequestReview(input"))).toBe(false);
    expect(out.state).toBe("DONE");
  });

  it("resume: skips findings already in threadsAdded", async () => {
    // progress.pendingReviewId is already set, so execute() short-circuits in
    // openPendingReview() and reuses it directly — it does not call
    // findPendingReview to re-discover the live pending review (that reconciliation
    // arrives in a later task).
    const rec = new Recorder((args) => {
      const joined = args.join(" ");
      if (args.includes("state,headRefOid,id")) return JSON.stringify({ state: "OPEN", headRefOid: "SHA1", id: "PR_node1" });
      if (joined.includes("reviews(first:1,states:PENDING"))
        return JSON.stringify({ data: { repository: { pullRequest: { reviews: { nodes: [{ id: "PRR_1" }] } } } } });
      if (joined.includes("submitPullRequestReview"))
        return JSON.stringify({ data: { submitPullRequestReview: { pullRequestReview: { url: "http://x/r/1" } } } });
      return "{}";
    });
    const r = baseRec();
    r.postProgress = {
      repliesPosted: [], threadsResolved: [], reviewPosted: false, reviewerRequested: false,
      pendingReviewId: "PRR_1", threadsAdded: ["f1"], threadsFailed: [],
    };
    await execute(new Gh(rec, "github.com"), r, "me", "2026-07-14T00:00:00Z");
    expect(threadCalls(rec).length).toBe(0);                                    // f1 already in
    expect(rec.calls.some((c) => c.args.join(" ").includes("addPullRequestReview(input"))).toBe(false);
    expect(submitCall(rec)).toBeDefined();
  });

  it("resume: a partial resume adds only the missing finding, not the one already in threadsAdded", async () => {
    // Two included findings, but only f1 made it in before the earlier crash.
    // Re-adding f1 would duplicate the comment already on the PR — exactly the
    // bug this progress ledger exists to prevent.
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec();
    r.draft!.findings = [
      { id: "f1", ref: "#1", path: "a.go", line: 142, side: "RIGHT", startLine: null, startSide: null,
        anchorable: true, priority: "Critical", body: "**[Critical]** leak", suggestion: null,
        included: true, editedBody: null },
      { id: "f2", ref: "#2", path: "b.go", line: 9, side: "RIGHT", startLine: null, startSide: null,
        anchorable: true, priority: "Nit", body: "**[Nit]** name", suggestion: null,
        included: true, editedBody: null },
    ];
    r.postProgress = {
      repliesPosted: [], threadsResolved: [], reviewPosted: false, reviewerRequested: false,
      pendingReviewId: "PRR_1", threadsAdded: ["f1"], threadsFailed: [],
    };
    await execute(gh, r, "me", "2026-07-14T00:00:00Z");
    const threads = threadCalls(rec);
    expect(threads.length).toBe(1);
    expect(argValue(threads[0], "line")).toBe("9");   // f2's line — f1 was skipped
  });

  it("persists pendingReviewId and threadsAdded as it goes", async () => {
    const { gh } = ghWith("SHA1");
    const saved: PostProgress[] = [];
    await execute(gh, baseRec(), "me", "2026-07-14T00:00:00Z", (p) => saved.push({ ...p, threadsAdded: [...p.threadsAdded] }));
    expect(saved.some((p) => p.pendingReviewId === "PRR_1")).toBe(true);
    expect(saved.some((p) => p.threadsAdded.includes("f1"))).toBe(true);
    expect(saved[saved.length - 1].reviewPosted).toBe(true);
  });
});

describe("forceApprove", () => {
  it("posts a bare APPROVE LGTM against the live head, then DONE", async () => {
    const { gh, rec } = ghWith("SHA1");
    const out = await forceApprove(gh, baseRec({ state: "POSTED_AWAITING_AUTHOR" }), "2026-06-29T00:00:00Z");
    const review = rec.calls.find((c) => c.args.some((a) => a.includes("/reviews")));
    const payload = JSON.parse(review!.input!);
    expect(payload.event).toBe("APPROVE");
    expect(payload.body).toBe("LGTM :+1:");
    expect(payload.commit_id).toBe("SHA1");
    expect(out.state).toBe("DONE");
    expect(out.postResult?.reviewUrl).toBe("http://x/r/1");
    expect(out.doneAt).toBe("2026-06-29T00:00:00Z");
    expect(out.forceApprove).toBe(false);
  });

  it("approves the live head even when rec.headSha is stale (no STALE bail)", async () => {
    const { gh, rec } = ghWith("SHA2");   // live head moved past rec.headSha=SHA1
    const out = await forceApprove(gh, baseRec({ state: "STALE", headSha: "SHA1" }), "t");
    const review = rec.calls.find((c) => c.args.some((a) => a.includes("/reviews")));
    expect(JSON.parse(review!.input!).commit_id).toBe("SHA2");
    expect(out.state).toBe("DONE");
    expect(out.headSha).toBe("SHA2");
  });

  it("leaves open comments behind — never replies or resolves", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec({ state: "POSTED_AWAITING_AUTHOR" });
    r.draft!.verify = [
      { id: "v1", ref: "V1", threadNodeId: "N1", replyTargetDatabaseId: 111, path: "a.go", line: 1,
        verdict: "follow-up", rationaleEn: "open", replyBody: "**[Major]** ...", included: true, editedBody: null },
    ];
    await forceApprove(gh, r, "t");
    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/replies")))).toBe(false);
    expect(rec.calls.some((c) => c.args.includes("threadId=N1"))).toBe(false);
  });

  it("non-open PR → CLOSED, no review posted", async () => {
    const { gh, rec } = ghWith("SHA1", "MERGED");
    const out = await forceApprove(gh, baseRec({ state: "POSTED_AWAITING_AUTHOR" }), "t");
    expect(out.state).toBe("CLOSED");
    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/reviews")))).toBe(false);
  });

  it("works with no draft (ERROR-origin) — still approves", async () => {
    const { gh, rec } = ghWith("SHA1");
    const out = await forceApprove(gh, baseRec({ state: "ERROR", draft: null }), "t");
    expect(out.state).toBe("DONE");
    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/reviews")))).toBe(true);
  });
});
