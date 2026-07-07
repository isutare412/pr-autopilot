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
    const r = new FakeRunner(() => JSON.stringify({ state: "MERGED", headRefOid: "SHA9" }));
    const gh = new Gh(r, "github.com");
    expect(await gh.prStatus("O", "R", 65)).toEqual({ state: "MERGED", headSha: "SHA9" });
    expect(r.calls[0].args).toEqual(
      ["pr", "view", "65", "--repo", "github.com/O/R", "--json", "state,headRefOid"],
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
});
