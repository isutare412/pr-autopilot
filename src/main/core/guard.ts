/** Returns true if this `gh` argv would mutate remote state (must be blocked during generation). */
const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);

export function isMutatingGh(args: string[]): boolean {
  const lower = args.map((a) => a.toLowerCase());

  // HTTP write method via -X / --method in every form pflag accepts:
  //   two-token: -X POST | --method POST
  //   combined:  -XPOST
  //   equals:    -X=POST | --method=POST
  for (let i = 0; i < lower.length; i++) {
    const a = lower[i];
    // two-token form: flag and value as separate argv entries
    if ((a === "-x" || a === "--method") && WRITE_METHODS.has(lower[i + 1] ?? "")) return true;
    // combined / equals form: -XPOST, -X=POST, --method=POST
    const m = a.match(/^(?:-x|--method)(.+)$/);
    if (m) {
      // strip an optional leading "=" left over from the -X=POST / --method=POST form
      const method = m[1].replace(/^=/, "");
      if (WRITE_METHODS.has(method)) return true;
    }
  }

  // graphql mutations (case-insensitive via the lowercased args)
  if (lower.some((a) => /\bmutation\b/.test(a))) return true;

  // write-only REST endpoints
  if (args.some((a) => a.includes("/requested_reviewers") || a.endsWith("/replies"))) return true;

  // gh write subcommands — take the first non-flag token as the command group and the
  // second non-flag token as the subcommand, so leading global flags (e.g.
  // `gh --no-pager pr review`) cannot hide it.
  const positional = lower.filter((a) => !a.startsWith("-"));
  const writeSub: Record<string, Set<string>> = {
    pr: new Set([
      "review", "comment", "merge", "close", "reopen", "edit", "ready",
      "create", "update-branch", "lock", "unlock",
    ]),
    issue: new Set([
      "comment", "close", "reopen", "edit", "create", "delete", "lock",
      "unlock", "pin", "unpin", "transfer", "develop",
    ]),
  };
  if (positional[0] && writeSub[positional[0]]?.has(positional[1] ?? "")) return true;

  return false;
}
