import { describe, it, expect } from "vitest";
import { Gh, GhRunner } from "../src/main/core/gh";

class FakeRunner implements GhRunner {
  public calls: { args: string[]; input?: string }[] = [];
  constructor(private responder: (args: string[]) => string) {}
  async run(args: string[], input?: string): Promise<string> {
    this.calls.push({ args, input });
    return this.responder(args);
  }
}

describe("Gh", () => {
  it("login pins the host", async () => {
    const r = new FakeRunner(() => "mylogin\n");
    const gh = new Gh(r, "github.com");
    expect(await gh.login()).toBe("mylogin");
    expect(r.calls[0].args).toEqual(["api", "--hostname", "github.com", "/user", "--jq", ".login"]);
  });

  it("postReview posts to the reviews endpoint with --input -", async () => {
    const r = new FakeRunner(() => JSON.stringify({ html_url: "http://x/r/1" }));
    const gh = new Gh(r, "github.com");
    const res = await gh.postReview("O", "R", 65, { event: "COMMENT", body: "", comments: [] });
    expect(res.html_url).toBe("http://x/r/1");
    const c = r.calls[0];
    expect(c.args).toContain("/repos/O/R/pulls/65/reviews");
    expect(c.args).toContain("--input");
    expect(c.input).toContain('"event"');
  });

  it("resolveThread runs the resolve mutation", async () => {
    const r = new FakeRunner(() => JSON.stringify({ data: {} }));
    const gh = new Gh(r, "github.com");
    await gh.resolveThread("NODE1");
    const joined = r.calls[0].args.join(" ");
    expect(joined).toContain("resolveReviewThread");
    expect(r.calls[0].args).toContain("threadId=NODE1");
  });

  it("requestReviewer posts to requested_reviewers", async () => {
    const r = new FakeRunner(() => "{}");
    const gh = new Gh(r, "github.com");
    await gh.requestReviewer("O", "R", 65, "me");
    expect(r.calls[0].args).toContain("/repos/O/R/pulls/65/requested_reviewers");
    expect(r.calls[0].args).toContain("reviewers[]=me");
  });

  it("prStatus returns the PR state and head SHA in one call", async () => {
    const r = new FakeRunner(() => JSON.stringify({ state: "MERGED", headRefOid: "SHA9", id: "PR_node9" }));
    const gh = new Gh(r, "github.com");
    expect(await gh.prStatus("O", "R", 65)).toEqual({ state: "MERGED", headSha: "SHA9", nodeId: "PR_node9" });
    expect(r.calls[0].args).toEqual(
      ["pr", "view", "65", "--repo", "github.com/O/R", "--json", "state,headRefOid,id"],
    );
  });

  it("prState returns the trimmed PR state", async () => {
    const r = new FakeRunner(() => "CLOSED\n");
    const gh = new Gh(r, "github.com");
    expect(await gh.prState("O", "R", 65)).toBe("CLOSED");
    const c = r.calls[0];
    expect(c.args).toContain("--json");
    expect(c.args).toContain("state");
    expect(c.args).toContain(".state");
  });

  it("prStatus returns state, head sha and the PR node id", async () => {
    const r = new FakeRunner(() =>
      JSON.stringify({ state: "OPEN", headRefOid: "SHA1", id: "PR_node1" }));
    const gh = new Gh(r, "github.com");
    const s = await gh.prStatus("O", "R", 65);
    expect(s).toEqual({ state: "OPEN", headSha: "SHA1", nodeId: "PR_node1" });
    expect(r.calls[0].args).toContain("state,headRefOid,id");
  });

  it("createPendingReview creates a review with no event and returns its id", async () => {
    const r = new FakeRunner(() =>
      JSON.stringify({ data: { addPullRequestReview: { pullRequestReview: { id: "PRR_1" } } } }));
    const gh = new Gh(r, "github.com");
    expect(await gh.createPendingReview("PR_node1", "SHA1")).toBe("PRR_1");
    const joined = r.calls[0].args.join(" ");
    expect(joined).toContain("addPullRequestReview");
    expect(joined).not.toContain("event:");          // omitting event is what leaves it PENDING
    expect(r.calls[0].args).toContain("prId=PR_node1");
    expect(r.calls[0].args).toContain("oid=SHA1");
  });

  it("addReviewThread sends a LINE thread with line and side", async () => {
    const r = new FakeRunner(() => JSON.stringify({ data: {} }));
    const gh = new Gh(r, "github.com");
    await gh.addReviewThread("PRR_1", {
      path: "a.go", body: "**[Nit]** x", subjectType: "LINE", line: 142, side: "RIGHT",
    });
    const a = r.calls[0].args;
    expect(a.join(" ")).toContain("addPullRequestReviewThread");
    expect(a).toContain("rid=PRR_1");
    expect(a).toContain("path=a.go");
    expect(a).toContain("subject=LINE");
    expect(a).toContain("line=142");
    expect(a).toContain("side=RIGHT");
  });

  it("addReviewThread sends a range LINE thread with startLine and startSide", async () => {
    const r = new FakeRunner(() => JSON.stringify({ data: {} }));
    const gh = new Gh(r, "github.com");
    await gh.addReviewThread("PRR_1", {
      path: "a.go", body: "b", subjectType: "LINE",
      line: 34, side: "RIGHT", startLine: 30, startSide: "RIGHT",
    });
    const a = r.calls[0].args;
    expect(a).toContain("startLine=30");
    expect(a).toContain("startSide=RIGHT");
  });

  it("addReviewThread omits line/side entirely for a FILE thread", async () => {
    const r = new FakeRunner(() => JSON.stringify({ data: {} }));
    const gh = new Gh(r, "github.com");
    await gh.addReviewThread("PRR_1", { path: "a.go", body: "b", subjectType: "FILE" });
    const a = r.calls[0].args;
    expect(a).toContain("subject=FILE");
    expect(a.some((x) => x.startsWith("line="))).toBe(false);
    expect(a.some((x) => x.startsWith("side="))).toBe(false);
    expect(a.some((x) => x.startsWith("startLine="))).toBe(false);
  });

  it("submitReview submits with the event and returns the review url", async () => {
    const r = new FakeRunner(() =>
      JSON.stringify({ data: { submitPullRequestReview: { pullRequestReview: { url: "http://x/r/9" } } } }));
    const gh = new Gh(r, "github.com");
    const res = await gh.submitReview("PRR_1", "APPROVE", "LGTM :+1:");
    expect(res.url).toBe("http://x/r/9");
    const a = r.calls[0].args;
    expect(a.join(" ")).toContain("submitPullRequestReview");
    expect(a).toContain("rid=PRR_1");
    expect(a).toContain("event=APPROVE");
    expect(a).toContain("body=LGTM :+1:");
  });

  it("findPendingReview returns the pending review id when one exists", async () => {
    const r = new FakeRunner(() => JSON.stringify({
      data: { repository: { pullRequest: { reviews: { nodes: [{ id: "PRR_old" }] } } } },
    }));
    const gh = new Gh(r, "github.com");
    expect(await gh.findPendingReview("O", "R", 65, "me")).toBe("PRR_old");
    const a = r.calls[0].args;
    expect(a.join(" ")).toContain("states:PENDING");
    expect(a).toContain("author=me");
  });

  it("findPendingReview returns null when there is none", async () => {
    const r = new FakeRunner(() => JSON.stringify({
      data: { repository: { pullRequest: { reviews: { nodes: [] } } } },
    }));
    const gh = new Gh(r, "github.com");
    expect(await gh.findPendingReview("O", "R", 65, "me")).toBeNull();
  });
});
