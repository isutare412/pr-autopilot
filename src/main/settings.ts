import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Language, Effort, OperatingMode, QueueSort, DEFAULT_QUEUE_SORT } from "./core/schema";

export const Settings = z.object({
  githubHost: z.string().default("github.com"),
  commentLanguage: Language.default("en"),
  effort: Effort.default("high"),
  operatingMode: OperatingMode.default("supervised"),
  automatedConfirmed: z.boolean().default(false),
  pollIntervalSec: z.number().int().positive().default(600),
  showDone: z.boolean().default(false),
  showDismissed: z.boolean().default(false),
  showClosed: z.boolean().default(false),
  queueSort: QueueSort.default(DEFAULT_QUEUE_SORT),
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

type Listener = (next: Settings, prev: Settings) => void;

/** Single source of truth for settings: holds the current snapshot, persists
 *  and notifies on update, and lets consumers react to changes. Electron-free. */
export class SettingsStore {
  private current: Settings;
  private listeners = new Set<Listener>();

  constructor(private dir: string, initial: Settings = loadSettings(dir)) {
    this.current = initial;
  }

  get(): Settings {
    return this.current;
  }

  /** Merge a patch, validate, persist, commit, then notify. Returns the new snapshot.
   *  Persists BEFORE committing in-memory: a disk failure throws and leaves state unchanged. */
  update(patch: Partial<Settings>): Settings {
    const prev = this.current;
    const next = Settings.parse({ ...prev, ...patch });
    saveSettings(this.dir, next);
    this.current = next;
    for (const l of this.listeners) {
      try { l(next, prev); } catch (e) { console.error("[settings] listener failed:", e); }
    }
    return next;
  }

  /** Register a reaction; returns an unsubscribe fn. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}
