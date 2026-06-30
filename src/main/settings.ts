import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Language, Effort, OperatingMode } from "./core/schema";

export const Settings = z.object({
  githubHost: z.string().default("github.com"),
  commentLanguage: Language.default("en"),
  effort: Effort.default("high"),
  operatingMode: OperatingMode.default("supervised"),
  automatedConfirmed: z.boolean().default(false),
  pollIntervalSec: z.number().int().positive().default(600),
  genConcurrency: z.number().int().positive().default(2),
  retentionDays: z.number().int().positive().default(30),
  claudeConfigDir: z.string().default("~/.claude"),
  claudePath: z.string().default(""),
  repoAllow: z.array(z.string()).default([]),
  repoDeny: z.array(z.string()).default([]),
  notify: z.boolean().default(true),
  openAtLogin: z.boolean().default(true),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = Settings.parse({});

export function loadSettings(dir: string): Settings {
  const f = join(dir, "settings.json");
  if (!existsSync(f)) return Settings.parse({});
  try {
    return Settings.parse(JSON.parse(readFileSync(f, "utf8")));
  } catch {
    return Settings.parse({});
  }
}

export function saveSettings(dir: string, s: Settings): void {
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "settings.json");
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, JSON.stringify(Settings.parse(s), null, 2));
  renameSync(tmp, f);
}
