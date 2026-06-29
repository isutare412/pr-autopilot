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
    const gh = new Gh(r, "git.linecorp.com");
    expect(await gh.login()).toBe("mylogin");
    expect(r.calls[0].args).toEqual(["api", "--hostname", "git.linecorp.com", "/user", "--jq", ".login"]);
  });

  it("postReview posts to the reviews endpoint with --input -", async () => {
    const r = new FakeRunner(() => JSON.stringify({ html_url: "http://x/r/1" }));
    const gh = new Gh(r, "git.linecorp.com");
    const res = await gh.postReview("O", "R", 65, { event: "COMMENT", body: "", comments: [] });
    expect(res.html_url).toBe("http://x/r/1");
    const c = r.calls[0];
    expect(c.args).toContain("/repos/O/R/pulls/65/reviews");
    expect(c.args).toContain("--input");
    expect(c.input).toContain('"event"');
  });

  it("resolveThread runs the resolve mutation", async () => {
    const r = new FakeRunner(() => JSON.stringify({ data: {} }));
    const gh = new Gh(r, "git.linecorp.com");
    await gh.resolveThread("NODE1");
    const joined = r.calls[0].args.join(" ");
    expect(joined).toContain("resolveReviewThread");
    expect(r.calls[0].args).toContain("threadId=NODE1");
  });

  it("requestReviewer posts to requested_reviewers", async () => {
    const r = new FakeRunner(() => "{}");
    const gh = new Gh(r, "git.linecorp.com");
    await gh.requestReviewer("O", "R", 65, "me");
    expect(r.calls[0].args).toContain("/repos/O/R/pulls/65/requested_reviewers");
    expect(r.calls[0].args).toContain("reviewers[]=me");
  });
});
