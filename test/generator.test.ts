import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPrompt, generate, claudeArgs, streamEventToActivity, ClaudeSpawner } from "../src/main/core/generator";
import type { Draft } from "../src/main/core/schema";

describe("claudeArgs", () => {
  it("bypasses prompts, drafts at the given effort, streams events, and loads the bundled plugin", () => {
    const args = claudeArgs("PROMPT", "/g.json", "/Resources/plugin", "max");
    expect(args).toEqual(["-p", "PROMPT", "--settings", "/g.json", "--dangerously-skip-permissions",
      "--effort", "max", "--output-format", "stream-json", "--verbose", "--plugin-dir", "/Resources/plugin"]);
  });
});

describe("streamEventToActivity", () => {
  const asst = (content: unknown[]) => JSON.stringify({ type: "assistant", message: { content } });
  it("labels a Bash tool_use by its description", () => {
    expect(streamEventToActivity(asst([{ type: "tool_use", name: "Bash", input: { command: "gh pr diff", description: "Get PR diff" } }]))).toEqual(["Get PR diff"]);
  });
  it("labels file/search tools and a reasoning snippet", () => {
    expect(streamEventToActivity(asst([
      { type: "text", text: "Let me read the diff" },
      { type: "tool_use", name: "Read", input: { file_path: "/a/b/foo.go" } },
    ]))).toEqual(["“Let me read the diff”", "read foo.go"]);
  });
  it("marks session init and ignores result / garbage lines", () => {
    expect(streamEventToActivity(JSON.stringify({ type: "system", subtype: "init" }))).toEqual(["session started"]);
    expect(streamEventToActivity(JSON.stringify({ type: "result", subtype: "success" }))).toEqual([]);
    expect(streamEventToActivity("not json")).toEqual([]);
  });
});

const validDraft: Draft = {
  overallEn: "ok", counts: { critical: 0, major: 0, minor: 0, nit: 1 },
  findings: [{ id: "f1", ref: "#1", path: "a.go", line: 5, side: "RIGHT", startLine: null,
    startSide: null, anchorable: true, priority: "Nit", body: "**[Nit]** x",
    suggestion: null, included: true, editedBody: null }],
  verify: [],
};

function spawnerWriting(content: (n: number) => string): ClaudeSpawner {
  let n = 0;
  return { async run({ outFile }) { writeFileSync(outFile, content(n++)); } };
}

const deps = () => ({
  spawner: spawnerWriting(() => JSON.stringify(validDraft)),
  claudeConfigDir: "/tmp/cfg", shimDir: "/tmp/bin", guardSettings: "/tmp/guard.json",
  pluginDir: "/Resources/plugin",
  dataDir: mkdtempSync(join(tmpdir(), "gen-")),
});

describe("buildPrompt", () => {
  it("names the skill, forbids writes, and includes the out-file path", () => {
    const p = buildPrompt({ url: "http://pr/65", outFile: "/tmp/out.json", language: "en" });
    expect(p).toContain("review-pr");
    expect(p).toContain("http://pr/65");
    expect(p).toMatch(/do NOT post|never post|do not post/i);
    expect(p).toContain("/tmp/out.json");
    expect(p).toMatch(/mutating gh|POST\/PUT\/PATCH\/DELETE|gh pr review/i);
    expect(p).toMatch(/bullets|single long paragraph/i); // overallEn must be formatted, not a wall of text
  });

  it("includes prior draft and feedback when re-drafting", () => {
    const p = buildPrompt({ url: "http://pr/65", outFile: "/tmp/o.json", language: "en", priorDraft: validDraft, feedback: "drop #1" });
    expect(p).toContain("drop #1");
    expect(p).toContain("#1");
    expect(p).toContain('"overallEn": "ok"');
  });
});

describe("generate", () => {
  it("returns a validated draft", async () => {
    const d = await generate(deps(), { url: "http://pr/65", language: "en", effort: "high" });
    expect(d.findings[0].ref).toBe("#1");
  });

  it("retries once on invalid JSON then succeeds", async () => {
    const d = { ...deps(), spawner: spawnerWriting((n) => (n === 0 ? "NOT JSON" : JSON.stringify(validDraft))) };
    const out = await generate(d, { url: "http://pr/65", language: "en", effort: "high" });
    expect(out.counts.nit).toBe(1);
  });

  it("throws after a second invalid output", async () => {
    const d = { ...deps(), spawner: spawnerWriting(() => "STILL NOT JSON") };
    await expect(generate(d, { url: "http://pr/65", language: "en", effort: "high" })).rejects.toThrow();
  });
});
