import { describe, it, expect } from "vitest";
import { isMutatingGh as core } from "../src/main/core/guard";
import { isMutatingGh as shim } from "../build/bin/guard.mjs";

/** Assert both implementations agree and return the expected boolean. */
function check(args: string[], expected: boolean) {
  expect(core(args)).toBe(expected);
  expect(shim(args)).toBe(expected);
  expect(core(args)).toBe(shim(args));
}

describe("guard parity: core vs shim", () => {
  it("pr review → mutating", () => check(["pr", "review"], true));
  it("pr view → read-only", () => check(["pr", "view"], false));
  it("api -X POST /x → mutating", () => check(["api", "-X", "POST", "/x"], true));
  it("api /user → read-only", () => check(["api", "/user"], false));
  it("graphql mutation → mutating", () =>
    check(["api", "graphql", "-f", "query=mutation{doSomething{id}}"], true));
  it("pr --no-pager comment (leading global flag) → mutating", () =>
    check(["pr", "--no-pager", "comment"], true));
  it("/replies endpoint → mutating", () =>
    check(["api", "/repos/o/r/pulls/1/comments/2/replies"], true));
});
