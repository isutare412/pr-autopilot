import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from "../src/main/settings";

describe("settings", () => {
  it("returns defaults when no file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    expect(loadSettings(dir)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.githubHost).toBe("github.com");
    expect(DEFAULT_SETTINGS.commentLanguage).toBe("en");
    expect(DEFAULT_SETTINGS.openAtLogin).toBe(true);
  });

  it("round-trips saved settings and fills missing keys from defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    saveSettings(dir, { ...DEFAULT_SETTINGS, commentLanguage: "ja", githubHost: "git.example.com" });
    const s = loadSettings(dir);
    expect(s.commentLanguage).toBe("ja");
    expect(s.githubHost).toBe("git.example.com");
    expect(s.genConcurrency).toBe(DEFAULT_SETTINGS.genConcurrency);
  });

  it("falls back to defaults when the file is malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    writeFileSync(join(dir, "settings.json"), "{ this is not valid json");
    expect(() => loadSettings(dir)).not.toThrow();
    expect(loadSettings(dir)).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to defaults when a value fails schema validation", () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ commentLanguage: "fr" }));
    expect(() => loadSettings(dir)).not.toThrow();
    expect(loadSettings(dir)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(dir).commentLanguage).toBe("en");
  });

  it("defaults effort to high and round-trips a non-default effort", () => {
    expect(DEFAULT_SETTINGS.effort).toBe("high");
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    saveSettings(dir, { ...DEFAULT_SETTINGS, effort: "max" });
    expect(loadSettings(dir).effort).toBe("max");
  });

  it("falls back to defaults when effort is not a valid level", () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ effort: "turbo" }));
    expect(loadSettings(dir).effort).toBe("high");
  });

  it("defaults claudePath to an empty string and round-trips a set value", () => {
    expect(DEFAULT_SETTINGS.claudePath).toBe("");
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    saveSettings(dir, { ...DEFAULT_SETTINGS, claudePath: "/opt/claude/bin/claude" });
    expect(loadSettings(dir).claudePath).toBe("/opt/claude/bin/claude");
  });
});
