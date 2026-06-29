import { join } from "node:path";
import { execSync } from "node:child_process";

export function expandTilde(p: string): string {
  return p.startsWith("~") ? join(process.env.HOME ?? "", p.slice(1)) : p;
}

const STD_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

/** A login-shell PATH merged with standard dirs, so a Finder/login-launched
 *  .app can find claude/gh/node even though it doesn't inherit the shell PATH. */
export function resolvePath(): string {
  let shellPath = "";
  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    shellPath = execSync(`${shell} -lc 'echo -n $PATH'`, { encoding: "utf8" }).trim();
  } catch { /* fall back to std dirs only */ }
  const parts = [...shellPath.split(":").filter(Boolean), ...STD_DIRS];
  return [...new Set(parts)].join(":");
}
