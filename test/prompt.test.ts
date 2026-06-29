import { describe, it, expect } from "vitest";
import { buildPrompt } from "../src/main/core/prompt";

describe("buildPrompt", () => {
  const base = { url: "https://github.com/o/r/pull/7", outFile: "/tmp/d.json", language: "ko" as const };

  it("invokes the namespaced plugin skill and pins the out-file", () => {
    const p = buildPrompt(base);
    expect(p).toContain("/pr-autopilot:review-pr");
    expect(p).toContain("https://github.com/o/r/pull/7");
    expect(p).toContain("/tmp/d.json");
  });

  it("injects the comment language by display name", () => {
    expect(buildPrompt({ ...base, language: "ko" })).toContain("Korean");
    expect(buildPrompt({ ...base, language: "ja" })).toContain("Japanese");
    expect(buildPrompt({ ...base, language: "en" })).toContain("English");
  });

  it("documents the renamed body fields and not the old Korean ones", () => {
    const p = buildPrompt(base);
    expect(p).toContain('"body"');
    expect(p).toContain('"replyBody"');
    expect(p).not.toContain("bodyKo");
    expect(p).not.toContain("replyBodyKo");
  });
});
