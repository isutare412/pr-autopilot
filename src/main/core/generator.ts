import { readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Draft, GeneratedDraft, Language } from "./schema";
import { buildPrompt } from "./prompt";

export { buildPrompt };

export interface ClaudeSpawner {
  run(args: { prompt: string; outFile: string; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; settings: string; pluginDir: string; onActivity?: (labels: string[]) => void }): Promise<void>;
}

/**
 * argv for the headless generation run.
 * - `--dangerously-skip-permissions` is required: headless `claude -p` cannot
 *   answer permission prompts, so under the enterprise config's "default" mode
 *   the skill's gh reads and the Write of the draft are silently denied (claude
 *   exits 0 having written nothing). The read-only-for-PR guarantee does NOT rely
 *   on claude's permission layer — it is enforced independently by the gh shim
 *   (PATH) and the PreToolUse hook (--settings), both of which still block
 *   mutating gh under skip-permissions.
 * - `--effort high`: the cockpit drafts at "high" regardless of the user's global
 *   effort level (this is a separate headless session).
 * - `--output-format stream-json --verbose`: emit a live event feed on stdout so
 *   the UI can show what the model is doing. The draft itself still arrives via
 *   the out-file, so this is purely additive — see streamEventToActivity.
 */
export function claudeArgs(prompt: string, settings: string, pluginDir: string): string[] {
  return ["-p", prompt, "--settings", settings, "--dangerously-skip-permissions",
    "--effort", "high", "--output-format", "stream-json", "--verbose", "--plugin-dir", pluginDir];
}

const truncate = (s: unknown, n: number): string => { const t = String(s ?? ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function labelForTool(name: string, input: any): string {
  const base = (p: unknown) => String(p ?? "").split("/").pop() || String(p ?? "");
  switch (name) {
    case "Bash": return input?.description ? String(input.description) : `$ ${truncate(input?.command, 52)}`;
    case "Read": return `read ${base(input?.file_path)}`;
    case "Write": return `write ${base(input?.file_path)}`;
    case "Edit": return `edit ${base(input?.file_path)}`;
    case "Grep": return `grep ${truncate(input?.pattern, 36)}`;
    case "Glob": return `glob ${truncate(input?.pattern, 36)}`;
    case "Skill": return `skill: ${truncate(input?.skill ?? input?.command ?? input?.name, 36)}`;
    case "Task": return `subagent: ${truncate(input?.description, 36)}`;
    case "WebFetch": return `fetch ${truncate(input?.url, 44)}`;
    case "TodoWrite": return "updating plan";
    default: return name.toLowerCase();
  }
}

/** Map one stream-json line to zero or more human-readable activity labels.
 *  Best-effort: unparseable / irrelevant lines yield []. */
export function streamEventToActivity(line: string): string[] {
  let e: any;
  try { e = JSON.parse(line); } catch { return []; }
  if (e?.type === "system" && e.subtype === "init") return ["session started"];
  if (e?.type !== "assistant" || !Array.isArray(e.message?.content)) return [];
  const out: string[] = [];
  for (const b of e.message.content) {
    if (b?.type === "tool_use" && b.name) out.push(labelForTool(b.name, b.input));
    else if (b?.type === "text" && typeof b.text === "string") {
      const t = b.text.trim().replace(/\s+/g, " ");
      if (t) out.push(`“${truncate(t, 60)}”`);
    }
  }
  return out;
}

export function realClaudeSpawner(): ClaudeSpawner {
  return {
    run({ prompt, env, cwd, timeoutMs, settings, pluginDir, onActivity }) {
      return new Promise((resolve, reject) => {
        const p = spawn("claude", claudeArgs(prompt, settings, pluginDir), {
          cwd, env, stdio: ["ignore", "pipe", "pipe"],
        });
        let err = "";
        p.stderr.on("data", (d) => (err += d));
        // Parse the stream-json feed line-by-line for progress. Best-effort: any
        // failure here is swallowed — the draft comes from the out-file, not stdout.
        let buf = "";
        p.stdout.on("data", (d) => {
          buf += d;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
            if (!line.trim() || !onActivity) continue;
            try { const labels = streamEventToActivity(line); if (labels.length) onActivity(labels); } catch { /* ignore */ }
          }
        });
        const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("claude timed out")); }, timeoutMs);
        p.on("error", (e) => { clearTimeout(timer); reject(e); });
        p.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`claude exited ${code}: ${err}`)); });
      });
    },
  };
}

export interface GenDeps {
  spawner: ClaudeSpawner;
  claudeConfigDir: string;
  shimDir: string;
  guardSettings: string;
  pluginDir: string;
  dataDir: string;
}

const TIMEOUT_MS = 8 * 60 * 1000;

export async function generate(deps: GenDeps, input: { url: string; priorDraft?: Draft; feedback?: string; language: Language }, onActivity?: (labels: string[]) => void): Promise<Draft> {
  const tmp = mkdtempSync(join(deps.dataDir, "gen-"));
  try {
    const outFile = join(tmp, "draft.json");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CLAUDE_CONFIG_DIR: deps.claudeConfigDir,
      PATH: `${deps.shimDir}:${process.env.PATH ?? ""}`,
    };

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (existsSync(outFile)) rmSync(outFile);
      const prompt = buildPrompt({ url: input.url, outFile, priorDraft: input.priorDraft, feedback: input.feedback, language: input.language });
      try {
        await deps.spawner.run({ prompt, outFile, cwd: tmp, env, timeoutMs: TIMEOUT_MS, settings: deps.guardSettings, pluginDir: deps.pluginDir, onActivity });
        if (!existsSync(outFile)) throw new Error("generator produced no out-file");
        return GeneratedDraft.parse(JSON.parse(readFileSync(outFile, "utf8")));
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`generation failed after retry: ${String(lastErr)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
