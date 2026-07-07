import { describe, it, expect } from "vitest";
import { GeneratedDraft, PrRecord, prKey, fileKey, LANGUAGE_LABEL } from "../src/main/core/schema";

describe("GeneratedDraft", () => {
  it("applies defaults for user-only fields Claude omits", () => {
    const parsed = GeneratedDraft.parse({
      overallEn: "take",
      counts: { critical: 0, major: 0, minor: 0, nit: 1 },
      findings: [{
        id: "f1", ref: "#1", path: "a.go", line: 10, side: "RIGHT",
        anchorable: true, priority: "Nit", body: "**[Nit]** ...",
      }],
      verify: [],
    });
    expect(parsed.findings[0].included).toBe(true);
    expect(parsed.findings[0].editedBody).toBeNull();
    expect(parsed.findings[0].startLine).toBeNull();
  });

  it("rejects an invalid priority", () => {
    expect(() => GeneratedDraft.parse({
      overallEn: "t", counts: { critical: 0, major: 0, minor: 0, nit: 0 },
      findings: [{ id: "f1", ref: "#1", path: "a.go", line: 1, side: "RIGHT",
        anchorable: true, priority: "Blocker", body: "x" }],
      verify: [],
    })).toThrow();
  });
});

describe("keys", () => {
  it("builds prKey and fileKey", () => {
    expect(prKey("github.com", "O", "R", 65)).toBe("github.com/O/R#65");
    expect(fileKey("github.com", "O", "R", 65)).toBe("github.com__O__R__65");
  });
});

describe("PrRecord", () => {
  it("validates a minimal record", () => {
    const rec = PrRecord.parse({
      key: "github.com/O/R#65", host: "github.com",
      owner: "O", repo: "R", number: 65, url: "http://x", title: "t",
      author: "a", baseRef: "develop", state: "DISCOVERED", mode: "first-review",
      headSha: "abc", draftVersion: 0, draft: null, feedbackHistory: [],
      postResult: null, postProgress: null, error: null,
      discoveredAt: "2026-06-29T00:00:00Z", generatedAt: null,
      updatedAt: "2026-06-29T00:00:00Z", doneAt: null,
    });
    expect(rec.state).toBe("DISCOVERED");
  });
});

describe("Language labels", () => {
  it("maps codes to display names", () => {
    expect(LANGUAGE_LABEL).toEqual({ en: "English", ko: "Korean", ja: "Japanese" });
  });
});
