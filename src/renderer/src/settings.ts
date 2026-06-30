// Local mirror of src/main/settings.ts — keep in sync manually.
// NOTE: drift risk — if main/settings.ts adds/changes fields, update this file too.
// The renderer must not import from src/main/** (drags node:fs/zod/electron into bundle).

export interface Settings {
  githubHost: string;
  commentLanguage: "en" | "ko" | "ja";
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  pollIntervalSec: number;
  genConcurrency: number;
  retentionDays: number;
  claudeConfigDir: string;
  claudePath: string;
  repoAllow: string[];
  repoDeny: string[];
  notify: boolean;
  openAtLogin: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  githubHost: "github.com",
  commentLanguage: "en",
  effort: "high",
  pollIntervalSec: 600,
  genConcurrency: 2,
  retentionDays: 30,
  claudeConfigDir: "~/.claude",
  claudePath: "",
  repoAllow: [],
  repoDeny: [],
  notify: true,
  openAtLogin: true,
};
