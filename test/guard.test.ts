import { describe, it, expect } from "vitest";
import { isMutatingGh } from "../src/main/core/guard";

describe("isMutatingGh", () => {
  const mutating = [
    ["api", "-X", "POST", "/repos/O/R/pulls/65/reviews"],
    ["api", "--method", "POST", "/x"],
    ["api", "-X", "PUT", "/x"],
    ["api", "-X", "PATCH", "/x"],
    ["api", "-X", "DELETE", "/x"],
    ["pr", "review", "65"],
    ["pr", "comment", "65", "-b", "hi"],
    ["pr", "merge", "65"],
    ["api", "graphql", "-f", "query=mutation($x:ID!){ resolveReviewThread(input:{}) {} }"],
    ["api", "-X", "POST", "/repos/O/R/pulls/65/requested_reviewers"],
    // bypass fixes
    ["api", "-XPOST", "/x"],
    ["api", "--method=POST", "/x"],
    ["api", "-XDELETE", "/x"],
    ["--no-pager", "pr", "review", "65"],
    ["pr", "close", "65"],
    ["pr", "reopen", "65"],
    ["pr", "edit", "65"],
    ["pr", "ready", "65"],
    ["pr", "create"],
    ["api", "graphql", "-f", "query=MUTATION($x:ID!){ x }"],
    // C1: -X= / --method= equals form must be flagged
    ["api", "-X=POST", "/repos/o/r/pulls/1/reviews"],
    ["api", "--method=POST", "/x"],
    ["api", "-XPOST", "/x"],
    // C2: a PR is an issue — issue write subcommands hit the PR
    ["issue", "comment", "1", "-b", "x"],
    ["issue", "edit", "1"],
    ["issue", "close", "1"],
    // C2: pr update-branch is a write
    ["pr", "update-branch", "1"],
  ];
  for (const args of mutating) {
    it(`flags mutating: ${args.join(" ")}`, () => expect(isMutatingGh(args)).toBe(true));
  }

  const reads = [
    ["api", "--hostname", "github.com", "/user", "--jq", ".login"],
    ["pr", "view", "65", "--json", "title"],
    ["pr", "diff", "65"],
    ["api", "graphql", "-f", "query=query($o:String!){ repository {} }"],
    ["api", "/search/issues", "-X", "GET", "-f", "q=is:pr"],
    // non-mutating with flags that look similar
    ["api", "-XGET", "/search/issues"],
    ["pr", "list", "--search", "review"],
    ["pr", "list", "--search", "pr review"],
    // reads the skill needs — must stay allowed
    ["pr", "view", "1"],
    ["api", "/repos/o/r/pulls/1/comments"],
    ["api", "graphql", "-f", "query=query{x}"],
    ["search", "prs", "--review-requested", "@me"],
    ["auth", "status"],
    // C3 accepted risk: token reads are intentionally NOT blocked
    ["auth", "token"],
  ];
  for (const args of reads) {
    it(`allows read: ${args.join(" ")}`, () => expect(isMutatingGh(args)).toBe(false));
  }
});
