import { describe, it, expect } from "vitest";
import { Gh, GhRunner, SearchPr } from "../src/main/core/gh";
import {
  execute, buildReviewPayload, buildThreadSpecs, fileThreadBody, buildSubmitBody,
  defaultVerdict, forceApprove, isDiffRejection, PENDING_REVIEW_CONFLICT, DRAFT_CHANGED_AFTER_POST,
} from "../src/main/core/executor";
import { hasUnspentLedger } from "../src/main/core/api";
import { decideWork } from "../src/main/core/poller";
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
    if (joined.includes("... on PullRequestReview"))
      return JSON.stringify({ data: { node: { state: "PENDING", url: "http://x/r/1" } } });
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

/** Like ghWith, but `failThread` decides which addPullRequestReviewThread calls blow up.
 *  `existingPending` is the caller's pending review already on the PR (null = none) —
 *  a resume test seeds it so Task 7's reconciliation recognises the stored id as live. */
function ghFailingThreads(
  failThread: (subject: string, callIndex: number) => Error | null,
  existingPending: string | null = null,
): { gh: Gh; rec: Recorder } {
  let n = 0;
  const rec = new Recorder((args) => {
    const joined = args.join(" ");
    if (args.includes("state,headRefOid,id")) return JSON.stringify({ state: "OPEN", headRefOid: "SHA1", id: "PR_node1" });
    if (joined.includes("... on PullRequestReview"))
      return JSON.stringify({ data: { node: existingPending ? { state: "PENDING", url: "http://x/r/1" } : null } });
    if (joined.includes("reviews(first:1,states:PENDING"))
      return JSON.stringify({ data: { repository: { pullRequest: {
        reviews: { nodes: existingPending ? [{ id: existingPending }] : [] } } } } });
    if (joined.includes("addPullRequestReview(input"))
      return JSON.stringify({ data: { addPullRequestReview: { pullRequestReview: { id: "PRR_1" } } } });
    if (joined.includes("addPullRequestReviewThread")) {
      const subject = args.find((a) => a.startsWith("subject="))!.slice("subject=".length);
      const err = failThread(subject, n++);
      if (err) throw err;
      return JSON.stringify({ data: { addPullRequestReviewThread: { thread: { id: "T1" } } } });
    }
    if (joined.includes("submitPullRequestReview"))
      return JSON.stringify({ data: { submitPullRequestReview: { pullRequestReview: { url: "http://x/r/1" } } } });
    return "{}";
  });
  return { gh: new Gh(rec, "github.com"), rec };
}

const DIFF_ERR = new Error(
  "gh api graphql exited 1: GraphQL: pull_request_review_thread.line must be part of the diff",
);

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

/** A PR whose pending review (per findPendingReview) is `livePending`, and whose
 *  stored review node (per reviewState) is `storedState` — null meaning "gone". */
function ghReconcile(
  livePending: string | null,
  storedState: { state: string; url: string } | null = null,
): { gh: Gh; rec: Recorder } {
  const rec = new Recorder((args) => {
    const joined = args.join(" ");
    if (args.includes("state,headRefOid,id")) return JSON.stringify({ state: "OPEN", headRefOid: "SHA1", id: "PR_node1" });
    if (joined.includes("... on PullRequestReview"))
      return JSON.stringify({ data: { node: storedState } });
    if (joined.includes("reviews(first:1,states:PENDING"))
      return JSON.stringify({ data: { repository: { pullRequest: {
        reviews: { nodes: livePending ? [{ id: livePending }] : [] } } } } });
    if (joined.includes("addPullRequestReview(input"))
      return JSON.stringify({ data: { addPullRequestReview: { pullRequestReview: { id: "PRR_new" } } } });
    if (joined.includes("addPullRequestReviewThread"))
      return JSON.stringify({ data: { addPullRequestReviewThread: { thread: { id: "T1" } } } });
    if (joined.includes("submitPullRequestReview"))
      return JSON.stringify({ data: { submitPullRequestReview: { pullRequestReview: { url: "http://x/r/1" } } } });
    return "{}";
  });
  return { gh: new Gh(rec, "github.com"), rec };
}

/** Flat over-rides onto the two-half PostProgress, so a test can say what landed
 *  without spelling out both halves. `repliedTargets` are GitHub reply-target
 *  database ids and `resolvedThreads` GitHub thread node ids — never local ids. */
interface ProgressOver {
  repliedTargets?: number[];
  resolvedThreads?: string[];
  pendingReviewId?: string | null;
  threadsAdded?: string[];
  threadsFailed?: string[];
  reviewPosted?: boolean;
  reviewerRequested?: boolean;
}

function progressWith(o: ProgressOver = {}): PostProgress {
  return {
    sent: { repliedTargets: o.repliedTargets ?? [], resolvedThreads: o.resolvedThreads ?? [] },
    review: {
      pendingReviewId: o.pendingReviewId ?? null,
      threadsAdded: o.threadsAdded ?? [],
      threadsFailed: o.threadsFailed ?? [],
    },
    reviewPosted: o.reviewPosted ?? false,
    reviewerRequested: o.reviewerRequested ?? false,
  };
}

function createCall(rec: Recorder) {
  return rec.calls.find((c) => c.args.join(" ").includes("addPullRequestReview(input"));
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
    r.postProgress = progressWith({ reviewPosted: true });
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
    // progress.pendingReviewId is already set, and reviewState reports it still
    // PENDING, so reconcilePendingReview() resumes into it directly — it does not
    // call findPendingReview or create a new one.
    const rec = new Recorder((args) => {
      const joined = args.join(" ");
      if (args.includes("state,headRefOid,id")) return JSON.stringify({ state: "OPEN", headRefOid: "SHA1", id: "PR_node1" });
      if (joined.includes("... on PullRequestReview"))
        return JSON.stringify({ data: { node: { state: "PENDING", url: "http://x/r/1" } } });
      if (joined.includes("reviews(first:1,states:PENDING"))
        return JSON.stringify({ data: { repository: { pullRequest: { reviews: { nodes: [{ id: "PRR_1" }] } } } } });
      if (joined.includes("submitPullRequestReview"))
        return JSON.stringify({ data: { submitPullRequestReview: { pullRequestReview: { url: "http://x/r/1" } } } });
      return "{}";
    });
    const r = baseRec();
    r.postProgress = progressWith({ pendingReviewId: "PRR_1", threadsAdded: ["f1"] });
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
    r.postProgress = progressWith({ pendingReviewId: "PRR_1", threadsAdded: ["f1"] });
    await execute(gh, r, "me", "2026-07-14T00:00:00Z");
    const threads = threadCalls(rec);
    expect(threads.length).toBe(1);
    expect(argValue(threads[0], "line")).toBe("9");   // f2's line — f1 was skipped
  });

  it("persists pendingReviewId and threadsAdded as it goes", async () => {
    const { gh } = ghWith("SHA1");
    const saved: PostProgress[] = [];
    await execute(gh, baseRec(), "me", "2026-07-14T00:00:00Z", (p) => saved.push(structuredClone(p)));
    expect(saved.some((p) => p.review.pendingReviewId === "PRR_1")).toBe(true);
    expect(saved.some((p) => p.review.threadsAdded.includes("f1"))).toBe(true);
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

  it("spends an unspent ledger on the successful-approve path (regression: force-approve must not wedge future re-review)", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec({
      state: "ERROR",
      postProgress: progressWith({ repliedTargets: [111], pendingReviewId: "PRR_1", threadsAdded: ["f1"] }),
    });
    expect(hasUnspentLedger(r)).toBe(true);   // sanity: this record starts out wedged

    const out = await forceApprove(gh, r, "2026-06-29T00:00:00Z");

    expect(hasUnspentLedger(out)).toBe(false);   // the fix: the cycle is over, ledger is spent
    expect(out.state).toBe("DONE");

    // Still exactly one bare LGTM REST approve against the live head — unchanged behavior.
    const reviewCalls = rec.calls.filter((c) => c.args.some((a) => a.includes("/reviews")));
    expect(reviewCalls.length).toBe(1);
    const payload = JSON.parse(reviewCalls[0].input!);
    expect(payload).toEqual({ event: "APPROVE", body: "LGTM :+1:", commit_id: "SHA1" });
  });

  it("also spends an unspent ledger on the non-OPEN (merged/closed) exit — the cycle is over there too", async () => {
    const { gh } = ghWith("SHA1", "MERGED");
    const r = baseRec({
      state: "ERROR",
      postProgress: progressWith({ repliedTargets: [111], pendingReviewId: "PRR_1" }),
    });
    const out = await forceApprove(gh, r, "t");
    expect(out.state).toBe("CLOSED");
    expect(hasUnspentLedger(out)).toBe(false);
  });

  it("a force-approved DONE record whose author later re-requests review is picked up for regeneration, not wedged forever (the actual user-visible bug)", async () => {
    const { gh } = ghWith("SHA1");
    const r = baseRec({
      key: "github.com/O/R#65", owner: "O", repo: "R", number: 65,
      state: "ERROR", headSha: "SHA1", mode: "first-review",
      postProgress: progressWith({ repliedTargets: [111], pendingReviewId: "PRR_1", threadsAdded: ["f1"] }),
    });
    const approved = await forceApprove(gh, r, "t");   // DONE, ledger spent by the fix above

    // Later, the author pushes a fix and re-requests review: the PR reappears in the
    // queue with an advanced head SHA. Before the fix, hasUnspentLedger(approved) would
    // still be true (the ledger survived untouched), so decideWork would skip it forever.
    const pr: SearchPr = { url: "http://x/O/R/pull/65", owner: "O", repo: "R", number: 65, title: "t65" };
    const work = decideWork({
      queue: [pr],
      existing: new Map([[approved.key, approved]]),
      liveHeads: new Map([[approved.key, "SHA2"]]),
      authorRepliedKeys: new Set(),
    });

    expect(work.map((w) => w.key)).toEqual([approved.key]);
  });
});

describe("execute → fallback ladder", () => {
  it("a LINE thread GitHub refuses is retried as a FILE thread", async () => {
    const { gh, rec } = ghFailingThreads((subject) => (subject === "LINE" ? DIFF_ERR : null));
    const out = await execute(gh, baseRec(), "me", "2026-07-14T00:00:00Z");   // f1 anchorable

    const threads = threadCalls(rec);
    expect(threads.map((t) => argValue(t, "subject"))).toEqual(["LINE", "FILE"]);
    expect(argValue(threads[1], "body")).toContain("line 142");   // the FILE body names the line
    expect(argValue(submitCall(rec)!, "body")).not.toContain("a.go:142");  // not folded — it landed
    expect(out.postProgress?.review.threadsAdded).toEqual(["f1"]);
    expect(out.postProgress?.review.threadsFailed).toEqual([]);
  });

  it("a finding refused as both LINE and FILE is folded into the submit body", async () => {
    const { gh, rec } = ghFailingThreads(() => DIFF_ERR);
    const out = await execute(gh, baseRec(), "me", "2026-07-14T00:00:00Z");

    expect(threadCalls(rec).map((t) => argValue(t, "subject"))).toEqual(["LINE", "FILE"]);
    const body = argValue(submitCall(rec)!, "body")!;
    expect(body).toContain("a.go:142 — **[Critical]** leak");     // the last-resort fold
    expect(out.postProgress?.review.threadsFailed).toEqual(["f1"]);
    expect(out.postProgress?.review.threadsAdded).toEqual([]);
  });

  it("a non-validation error propagates instead of degrading the review into body text", async () => {
    const boom = new Error("gh api graphql exited 1: dial tcp: connection refused");
    const { gh, rec } = ghFailingThreads(() => boom);
    await expect(execute(gh, baseRec(), "me", "2026-07-14T00:00:00Z")).rejects.toThrow("connection refused");
    expect(submitCall(rec)).toBeUndefined();     // nothing submitted — the pending review is left for a retry
  });

  it("a persisted threadsFailed still reaches the submit body after a resume", async () => {
    // PRR_1 is live on the PR and is the id we stored, so this resumes into that
    // same draft — the failed finding must not be lost on the way to submit.
    const { gh, rec } = ghFailingThreads(() => null, "PRR_1");
    const r = baseRec();
    r.postProgress = progressWith({ pendingReviewId: "PRR_1", threadsFailed: ["f1"] });
    await execute(gh, r, "me", "2026-07-14T00:00:00Z");
    expect(threadCalls(rec).length).toBe(0);                       // f1 already known-failed; not retried
    expect(argValue(submitCall(rec)!, "body")).toContain("a.go:142 — **[Critical]** leak");
  });
});

describe("isDiffRejection", () => {
  it("recognises GitHub refusing the line anchor", () => {
    expect(isDiffRejection(DIFF_ERR)).toBe(true);
    expect(isDiffRejection(new Error("pull_request_review_thread.diff_hunk can't be blank"))).toBe(true);
  });
  it("does not swallow transport or auth failures", () => {
    expect(isDiffRejection(new Error("dial tcp: connection refused"))).toBe(false);
    expect(isDiffRejection(new Error("HTTP 401: Bad credentials"))).toBe(false);
  });
});

/** The sent half of the ledger is keyed by GitHub's ids, not ours — so it still
 *  matches after a re-draft has renamed every local id. */
describe("execute → the sent ledger is keyed by GitHub's ids", () => {
  const verifyItem = (id: string, verdict: "resolve" | "follow-up") => ({
    id, ref: "V1", threadNodeId: "N1", replyTargetDatabaseId: 111, path: "a.go", line: 1,
    verdict, rationaleEn: "x", replyBody: "**[Major]** still open", included: true, editedBody: null,
  });
  const replies = (rec: Recorder) =>
    rec.calls.filter((c) => c.args.some((a) => a.includes("/comments/111/replies")));

  it("skips a reply whose replyTargetDatabaseId is already in the ledger, even under a brand-new local id", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec({ mode: "re-review" });
    r.draft!.findings = [];
    // The re-draft minted a fresh local id for the same GitHub thread…
    r.draft!.verify = [verifyItem("v-REGENERATED", "follow-up")];
    // …and the ledger carried over from the cycle that already replied to it.
    r.postProgress = progressWith({ repliedTargets: [111] });

    const out = await execute(gh, r, "me", "2026-07-14T00:00:00Z");

    expect(replies(rec).length).toBe(0);                      // not re-sent
    expect(out.postProgress!.sent.repliedTargets).toEqual([111]);
  });

  it("skips a resolve whose threadNodeId is already in the ledger, and reports it as resolved", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec({ mode: "re-review" });
    r.draft!.findings = [];
    r.draft!.verify = [verifyItem("v-REGENERATED", "resolve")];
    r.postProgress = progressWith({ repliedTargets: [111], resolvedThreads: ["N1"] });

    const out = await execute(gh, r, "me", "2026-07-14T00:00:00Z");

    expect(rec.calls.some((c) => c.args.includes("threadId=N1"))).toBe(false);   // not re-resolved
    // postResult reads straight off the ledger, so a thread resolved by an earlier
    // attempt of this cycle is still reported as resolved.
    expect(out.postResult?.resolvedThreadIds).toEqual(["N1"]);
  });

  it("still sends the reply when the ledger holds a different thread's target", async () => {
    const { gh, rec } = ghWith("SHA1");
    const r = baseRec({ mode: "re-review" });
    r.draft!.findings = [];
    r.draft!.verify = [verifyItem("v1", "follow-up")];
    r.postProgress = progressWith({ repliedTargets: [999] });   // some other thread

    await execute(gh, r, "me", "2026-07-14T00:00:00Z");

    expect(replies(rec).length).toBe(1);
  });
});

describe("execute → pending-review reconciliation", () => {
  it("no stored id and no pending review on the PR → creates one", async () => {
    const { gh, rec } = ghReconcile(null);
    const out = await execute(gh, baseRec(), "me", "2026-07-14T00:00:00Z");
    expect(createCall(rec)).toBeDefined();
    expect(out.postProgress?.review.pendingReviewId).toBe("PRR_new");
  });

  it("stored id still PENDING → resumes into it, creates nothing", async () => {
    const { gh, rec } = ghReconcile("PRR_1", { state: "PENDING", url: "http://x/r/1" });
    const r = baseRec();
    r.postProgress = progressWith({ pendingReviewId: "PRR_1", threadsAdded: ["f1"] });
    await execute(gh, r, "me", "2026-07-14T00:00:00Z");
    expect(createCall(rec)).toBeUndefined();
    expect(threadCalls(rec).length).toBe(0);      // f1 already in
    expect(submitCall(rec)).toBeDefined();
  });

  /** The crash-after-submit case. The review LANDED; only our bookkeeping was lost.
   *  Re-posting it would put a second review on the author's PR. */
  it("stored id already SUBMITTED → recovers the url, posts nothing again", async () => {
    const { gh, rec } = ghReconcile(null, { state: "APPROVED", url: "http://x/r/landed" });
    const r = baseRec();
    r.postProgress = progressWith({ pendingReviewId: "PRR_1", threadsAdded: ["f1"] });
    const out = await execute(gh, r, "me", "2026-07-14T00:00:00Z");

    expect(createCall(rec)).toBeUndefined();      // no second pending review
    expect(threadCalls(rec).length).toBe(0);      // no re-added threads
    expect(submitCall(rec)).toBeUndefined();      // no second submit
    expect(out.postResult?.reviewUrl).toBe("http://x/r/landed");
    expect(out.postProgress?.reviewPosted).toBe(true);
  });

  it("stored id gone (user discarded the draft) → recreates and re-adds every thread, resetting threadsFailed too", async () => {
    const { gh, rec } = ghReconcile(null, null);   // node no longer exists
    const r = baseRec();
    r.draft!.findings[1].included = true;   // include f2 too, so a stale threadsFailed entry is exercised
    r.postProgress = progressWith({ pendingReviewId: "PRR_dead", threadsAdded: ["f1"], threadsFailed: ["f2"] });
    const out = await execute(gh, r, "me", "2026-07-14T00:00:00Z");
    expect(out.postProgress?.review.pendingReviewId).toBe("PRR_new");
    // the discarded draft took its threads with it — both f1 and f2 must be re-added as
    // threads, not skipped (a stale threadsAdded) or folded into the submit body (a stale
    // threadsFailed, which would silently reintroduce the bug this branch fixes)
    const threads = threadCalls(rec);
    expect(threads.length).toBe(2);
    expect([...out.postProgress!.review.threadsAdded].sort()).toEqual(["f1", "f2"]);
    expect(out.postProgress?.review.threadsFailed).toEqual([]);
    expect(argValue(submitCall(rec)!, "body")).not.toContain("b.go:9");   // not folded — landed as a thread
  });

  it("a pending review we don't own → aborts, posting nothing", async () => {
    const { gh, rec } = ghReconcile("PRR_theirs");
    await expect(execute(gh, baseRec(), "me", "2026-07-14T00:00:00Z"))
      .rejects.toThrow(PENDING_REVIEW_CONFLICT);
    expect(createCall(rec)).toBeUndefined();
    expect(threadCalls(rec).length).toBe(0);
    expect(submitCall(rec)).toBeUndefined();
  });

  it("aborts rather than deleting — a hand-written draft is never destroyed", async () => {
    const { gh, rec } = ghReconcile("PRR_theirs");
    await expect(execute(gh, baseRec(), "me", "2026-07-14T00:00:00Z")).rejects.toThrow();
    expect(rec.calls.some((c) => c.args.join(" ").includes("deletePullRequestReview"))).toBe(false);
  });
});

describe("execute → draft-changed-after-post backstop (FINDING 1)", () => {
  /** The CRITICAL scenario end-to-end: f1's thread already landed on the pending
   *  review (threadsAdded persisted), then f1 is dropped from the draft (as the
   *  api.ts lock is meant to prevent going forward, but this pins the executor's
   *  own backstop for every other path a draft can change). Retrying must throw
   *  before touching GitHub again — submitting now would ship f1's thread anyway,
   *  contradicting what the draft shows. */
  it("a finding already attached, then dropped from the draft, makes execute() throw and submit nothing", async () => {
    const { gh, rec } = ghReconcile(null, { state: "PENDING", url: "http://x/r/1" });
    const r = baseRec();
    r.draft!.findings[0].included = false;   // f1 dropped after its thread was already added
    r.postProgress = progressWith({ pendingReviewId: "PRR_1", threadsAdded: ["f1"] });

    await expect(execute(gh, r, "me", "2026-07-14T00:00:00Z")).rejects.toThrow(DRAFT_CHANGED_AFTER_POST);
    expect(threadCalls(rec).length).toBe(0);
    expect(rec.calls.filter((c) => c.args.join(" ").includes("submitPullRequestReview")).length).toBe(0);
  });

  it("an id in threadsFailed that the current draft no longer includes also trips the backstop", async () => {
    const { gh, rec } = ghReconcile(null, { state: "PENDING", url: "http://x/r/1" });
    const r = baseRec();
    r.draft!.findings = [
      { id: "f1", ref: "#1", path: "a.go", line: 142, side: "RIGHT", startLine: null, startSide: null,
        anchorable: true, priority: "Critical", body: "**[Critical]** leak", suggestion: null,
        included: true, editedBody: null },
    ];
    r.postProgress = progressWith({ pendingReviewId: "PRR_1", threadsFailed: ["f2"] });   // f2 no longer in the draft at all

    await expect(execute(gh, r, "me", "2026-07-14T00:00:00Z")).rejects.toThrow(DRAFT_CHANGED_AFTER_POST);
    expect(rec.calls.filter((c) => c.args.join(" ").includes("submitPullRequestReview")).length).toBe(0);
  });

  it("a stored id whose attached findings still match the current draft does not trip the backstop", async () => {
    const { gh, rec } = ghReconcile("PRR_1", { state: "PENDING", url: "http://x/r/1" });
    const r = baseRec();   // f1 included, f2 excluded — unchanged from when f1 was attached
    r.postProgress = progressWith({ pendingReviewId: "PRR_1", threadsAdded: ["f1"] });
    const out = await execute(gh, r, "me", "2026-07-14T00:00:00Z");
    expect(out.state).not.toBe("ERROR");
    expect(submitCall(rec)).toBeDefined();
  });
});

describe("execute → pending review reconciled even with zero specs (FINDING 2)", () => {
  it("no pendingReviewId and zero specs still takes the REST fast path, unchanged", async () => {
    const { gh, rec } = ghWith("SHA1");
    const clean = baseRec({ postVerdict: "approve" });
    clean.draft = { overallEn: "clean", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };
    const out = await execute(gh, clean, "me", "2026-07-14T00:00:00Z");
    const restReview = rec.calls.find((c) => c.args.some((a) => a.includes("/pulls/65/reviews")));
    expect(restReview).toBeDefined();
    expect(rec.calls.some((c) => c.args.join(" ").includes("addPullRequestReview(input"))).toBe(false);
    expect(out.state).toBe("DONE");
  });

  it("pendingReviewId set + zero specs + approve → submits the pending review with LGTM, opens no REST review", async () => {
    const { gh, rec } = ghReconcile(null, { state: "PENDING", url: "http://x/r/1" });
    const r = baseRec({ postVerdict: "approve" });
    r.draft = { overallEn: "clean now", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };
    r.postProgress = progressWith({ pendingReviewId: "PRR_1" });

    const out = await execute(gh, r, "me", "2026-07-14T00:00:00Z");

    expect(threadCalls(rec).length).toBe(0);
    expect(argValue(submitCall(rec)!, "event")).toBe("APPROVE");
    expect(argValue(submitCall(rec)!, "body")).toBe("LGTM :+1:");
    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/pulls/65/reviews")))).toBe(false);   // no REST review alongside
    expect(out.state).toBe("DONE");
    expect(out.postResult?.reviewUrl).toBe("http://x/r/1");
  });

  it("pendingReviewId set + zero specs + comment with nothing to say → posts no review, no orphan created alongside", async () => {
    const { gh, rec } = ghReconcile(null, { state: "PENDING", url: "http://x/r/1" });
    const r = baseRec({ mode: "re-review", postVerdict: "comment" });
    r.draft = { overallEn: "re-review, nothing left", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };
    r.postProgress = progressWith({ pendingReviewId: "PRR_1" });

    const out = await execute(gh, r, "me", "2026-07-14T00:00:00Z");

    expect(threadCalls(rec).length).toBe(0);
    expect(submitCall(rec)).toBeUndefined();
    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/pulls/65/reviews")))).toBe(false);
    expect(out.state).toBe("POSTED_AWAITING_AUTHOR");
    expect(out.postProgress?.reviewPosted).toBe(true);   // resume won't retry a no-op forever
  });

  it("a landed review recovered via reconcile with zero specs opens no REST review either", async () => {
    const { gh, rec } = ghReconcile(null, { state: "APPROVED", url: "http://x/r/landed" });
    const r = baseRec({ postVerdict: "approve" });
    r.draft = { overallEn: "clean", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };
    r.postProgress = progressWith({ pendingReviewId: "PRR_1" });

    const out = await execute(gh, r, "me", "2026-07-14T00:00:00Z");

    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/pulls/65/reviews")))).toBe(false);
    expect(submitCall(rec)).toBeUndefined();
    expect(out.postResult?.reviewUrl).toBe("http://x/r/landed");
  });
});

describe("execute → fast path re-asks GitHub before trusting our own bookkeeping (FINDING I-1)", () => {
  /** The re-draft scenario: a partial post left a thread attached, then the ERROR
   *  record regenerated (feedback, or the author pushing a fix) into a clean
   *  draft — orchestrator.runGeneration nulls postProgress on every regeneration,
   *  so nothing here remembers the orphaned PENDING review still live on GitHub.
   *  The fast path must not infer "no pending review" from that null; it has to
   *  ask GitHub directly, or a REST review lands beside the orphan. */
  it("zero specs + no postProgress + a pending review live on GitHub → throws PENDING_REVIEW_CONFLICT, posts no REST review", async () => {
    const { gh, rec } = ghReconcile("PRR_theirs");
    const clean = baseRec();   // postProgress: null, as after a fresh (re)generation
    clean.draft = { overallEn: "clean", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };

    await expect(execute(gh, clean, "me", "2026-07-14T00:00:00Z")).rejects.toThrow(PENDING_REVIEW_CONFLICT);

    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/pulls/65/reviews")))).toBe(false);
    expect(rec.calls.some((c) => c.args.join(" ").includes("addPullRequestReview(input"))).toBe(false);
    expect(submitCall(rec)).toBeUndefined();
  });

  /** Regression pin: the common case (no orphan on GitHub) must still take the
   *  bare REST fast path exactly as before — the extra findPendingReview read
   *  must not itself block or alter a clean post. */
  it("zero specs + no pending review on GitHub → the REST bare LGTM fast path still fires", async () => {
    const { gh, rec } = ghWith("SHA1");   // findPendingReview resolves to no live review
    const clean = baseRec({ postVerdict: "approve" });
    clean.draft = { overallEn: "clean", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };

    const out = await execute(gh, clean, "me", "2026-07-14T00:00:00Z");

    const restReview = rec.calls.find((c) => c.args.some((a) => a.includes("/pulls/65/reviews")));
    expect(restReview).toBeDefined();
    expect(JSON.parse(restReview!.input!)).toMatchObject({ event: "APPROVE", body: "LGTM :+1:" });
    expect(rec.calls.some((c) => c.args.join(" ").includes("addPullRequestReview(input"))).toBe(false);
    expect(out.state).toBe("DONE");
  });

  /** The regression pin for FINDING I-1: an "approve" verdict with zero findings
   *  still builds a non-null payload, so the pre-flight findPendingReview check
   *  still runs and still aborts rather than landing a second review beside a
   *  live orphan/hand-written one. */
  it("zero findings + approve + a live pending review on GitHub → still throws PENDING_REVIEW_CONFLICT, no REST call", async () => {
    const { gh, rec } = ghReconcile("PRR_theirs");
    const clean = baseRec({ postVerdict: "approve" });
    clean.draft = { overallEn: "clean", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [], verify: [] };

    await expect(execute(gh, clean, "me", "2026-07-14T00:00:00Z")).rejects.toThrow(PENDING_REVIEW_CONFLICT);

    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/pulls/65/reviews")))).toBe(false);
    expect(rec.calls.some((c) => c.args.join(" ").includes("addPullRequestReview(input"))).toBe(false);
    expect(submitCall(rec)).toBeUndefined();
  });

  /** The FINDING I-1 fix itself: a "comment" verdict with zero findings builds a
   *  null payload — nothing to post, nothing that can collide — so a hand-written
   *  (or orphaned) pending review live on the same PR must NOT abort the post.
   *  Steps 1–2 (replies/resolves) still have to land normally, since they don't
   *  touch the pending-review machinery at all. */
  it("comment verdict + zero findings + a pending review live on GitHub still posts replies/resolves, no throw, no REST review", async () => {
    const { gh, rec } = ghReconcile("PRR_theirs");
    const r = baseRec({ mode: "re-review", postVerdict: "comment" });
    r.draft = { overallEn: "re-review", counts: { critical: 0, major: 0, minor: 0, nit: 0 }, findings: [],
      verify: [
        { id: "v1", ref: "V1", threadNodeId: "N1", replyTargetDatabaseId: 111, path: "a.go", line: 1,
          verdict: "resolve", rationaleEn: "fixed", replyBody: "확인했습니다.", included: true, editedBody: null },
      ] };

    const out = await execute(gh, r, "me", "2026-07-14T00:00:00Z");

    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/comments/111/replies")))).toBe(true);
    expect(rec.calls.some((c) => c.args.includes("threadId=N1"))).toBe(true);
    expect(rec.calls.some((c) => c.args.some((a) => a.includes("/pulls/65/reviews")))).toBe(false);
    expect(rec.calls.some((c) => c.args.join(" ").includes("addPullRequestReview(input"))).toBe(false);
    expect(submitCall(rec)).toBeUndefined();
    expect(out.state).toBe("POSTED_AWAITING_AUTHOR");
    expect(out.postResult?.resolvedThreadIds).toEqual(["N1"]);
  });
});
