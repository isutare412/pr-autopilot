import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, saveSettings, DEFAULT_SETTINGS, SettingsStore } from "../src/main/settings";

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

  it("defaults operatingMode to supervised and round-trips other modes", () => {
    expect(DEFAULT_SETTINGS.operatingMode).toBe("supervised");
    expect(DEFAULT_SETTINGS.automatedConfirmed).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    saveSettings(dir, { ...DEFAULT_SETTINGS, operatingMode: "automated", automatedConfirmed: true });
    expect(loadSettings(dir).operatingMode).toBe("automated");
    expect(loadSettings(dir).automatedConfirmed).toBe(true);
  });

  it("falls back to defaults when operatingMode is invalid", () => {
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ operatingMode: "turbo" }));
    expect(loadSettings(dir).operatingMode).toBe("supervised");
  });

  it("defaults the queue filters to hidden and round-trips them", () => {
    expect(DEFAULT_SETTINGS.showDone).toBe(false);
    expect(DEFAULT_SETTINGS.showDismissed).toBe(false);
    expect(DEFAULT_SETTINGS.showClosed).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    saveSettings(dir, { ...DEFAULT_SETTINGS, showDone: true, showDismissed: true, showClosed: true });
    const s = loadSettings(dir);
    expect(s.showDone).toBe(true);
    expect(s.showDismissed).toBe(true);
    expect(s.showClosed).toBe(true);
  });

  it("defaults queueSort to activity/desc and round-trips a non-default", () => {
    expect(DEFAULT_SETTINGS.queueSort).toEqual({ key: "activity", dir: "desc" });
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    saveSettings(dir, { ...DEFAULT_SETTINGS, queueSort: { key: "repo", dir: "asc" } });
    expect(loadSettings(dir).queueSort).toEqual({ key: "repo", dir: "asc" });
  });
});

describe("SettingsStore", () => {
  const freshDir = () => mkdtempSync(join(tmpdir(), "pa-"));

  it("get returns the initial settings", () => {
    const s = new SettingsStore(freshDir(), DEFAULT_SETTINGS);
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
  });

  it("update merges a patch, persists to disk, and returns the new snapshot", () => {
    const dir = freshDir();
    const s = new SettingsStore(dir, DEFAULT_SETTINGS);
    const next = s.update({ genConcurrency: 5 });
    expect(next.genConcurrency).toBe(5);
    expect(s.get().genConcurrency).toBe(5);
    expect(loadSettings(dir).genConcurrency).toBe(5);                        // persisted
    expect(s.get().retentionDays).toBe(DEFAULT_SETTINGS.retentionDays);     // other fields untouched
  });

  it("notifies subscribers with (next, prev) on update", () => {
    const s = new SettingsStore(freshDir(), DEFAULT_SETTINGS);
    const seen: Array<[number, number]> = [];
    s.subscribe((next, prev) => seen.push([prev.genConcurrency, next.genConcurrency]));
    s.update({ genConcurrency: 4 });
    expect(seen).toEqual([[DEFAULT_SETTINGS.genConcurrency, 4]]);
  });

  it("unsubscribe stops further notifications", () => {
    const s = new SettingsStore(freshDir(), DEFAULT_SETTINGS);
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.update({ genConcurrency: 3 });
    off();
    s.update({ genConcurrency: 4 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing subscriber so others still run and update does not throw", () => {
    const s = new SettingsStore(freshDir(), DEFAULT_SETTINGS);
    const good = vi.fn();
    s.subscribe(() => { throw new Error("bad subscriber"); });
    s.subscribe(good);
    expect(() => s.update({ genConcurrency: 3 })).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });

  it("throws on an invalid patch and leaves memory and disk unchanged", () => {
    const dir = freshDir();
    const s = new SettingsStore(dir, DEFAULT_SETTINGS);
    s.update({ genConcurrency: 2 });                          // known-good baseline on disk
    expect(() => s.update({ genConcurrency: -1 })).toThrow(); // positive-int schema rejects -1
    expect(s.get().genConcurrency).toBe(2);                   // memory unchanged
    expect(loadSettings(dir).genConcurrency).toBe(2);         // disk unchanged
  });
});
