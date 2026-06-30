import { join } from "node:path";
import { execSync } from "node:child_process";

export function expandTilde(p: string): string {
  return p.startsWith("~") ? join(process.env.HOME ?? "", p.slice(1)) : p;
}

const STD_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

/** User-local bin dirs that CLI tools install into. The Claude Code native
 *  installer lands `claude` in ~/.local/bin; users commonly add it (and ~/bin)
 *  to PATH from ~/.zshrc. A Finder/launchd-launched .app resolves PATH with a
 *  login but NON-interactive shell (`-lc`), which does not source ~/.zshrc, so
 *  those dirs go missing — listing them explicitly is the safety net that keeps
 *  `spawn("claude")` from failing with ENOENT. */
function userBinDirs(): string[] {
  const home = process.env.HOME ?? "";
  return home ? [join(home, ".local/bin"), join(home, "bin")] : [];
}

/** Merge a shell-derived PATH with the standard + user-local bin dirs, dropping
 *  empties and duplicates. Pure (no shell-out) so it is deterministically
 *  testable independent of the runner's own environment. */
export function mergePath(shellPath: string): string {
  const parts = [...shellPath.split(":").filter(Boolean), ...STD_DIRS, ...userBinDirs()];
  return [...new Set(parts)].join(":");
}

/** A login-shell PATH merged with standard + user-local dirs, so a Finder/login-
 *  launched .app can find claude/gh/node even though it doesn't inherit the
 *  shell PATH. */
export function resolvePath(): string {
  let shellPath = "";
  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    shellPath = execSync(`${shell} -lc 'echo -n $PATH'`, { encoding: "utf8" }).trim();
  } catch { /* fall back to std dirs only */ }
  return mergePath(shellPath);
}
