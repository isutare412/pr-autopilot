import type { SearchPr, ReviewThread } from "./gh";
import type { PrRecord, Mode } from "./schema";
import { prKey } from "./schema";

/**
 * True when the author has the last word in one of my open review threads — the
 * ball is in my court, so a re-review is warranted. Only counts unresolved
 * threads that I started; returns false while I have replied last (I'm waiting
 * on the author), so an unchanged thread does not re-trigger on every poll.
 */
export function authorAwaitingReview(threads: ReviewThread[], login: string): boolean {
  return threads.some((t) => {
    if (t.isResolved) return false;
    if (t.comments[0]?.authorLogin !== login) return false; // not a thread I started
    const last = t.comments[t.comments.length - 1];
    return !!last && last.authorLogin !== login; // author (or anyone but me) spoke last
  });
}

export interface WorkItem { key: string; mode: Mode; sha: string; pr: SearchPr; }

const BUSY = new Set(["GENERATING", "POSTING"]);

/** A repo passes unless denied; if allow is non-empty it must also be allowed.
 *  Entries match the bare repo name or `owner/repo`. Deny wins over allow. */
export function repoAllowed(owner: string, repo: string, allow: string[], deny: string[]): boolean {
  const names = [repo, `${owner}/${repo}`];
  if (deny.some((d) => names.includes(d))) return false;
  if (allow.length > 0 && !allow.some((a) => names.includes(a))) return false;
  return true;
}

export function decideWork(args: {
  queue: SearchPr[];
  existing: Map<string, PrRecord>;
  liveHeads: Map<string, string>;
  authorRepliedKeys: Set<string>;
  repoAllow?: string[];
  repoDeny?: string[];
  host?: string;
}): WorkItem[] {
  const allow = args.repoAllow ?? [];
  const deny = args.repoDeny ?? [];
  const host = args.host ?? "git.linecorp.com";
  const work: WorkItem[] = [];
  for (const pr of args.queue) {
    if (!repoAllowed(pr.owner, pr.repo, allow, deny)) continue;
    const key = prKey(host, pr.owner, pr.repo, pr.number);
    const rec = args.existing.get(key);
    const sha = args.liveHeads.get(key) ?? rec?.headSha ?? "";

    if (!rec) { work.push({ key, mode: "first-review", sha, pr }); continue; }
    if (BUSY.has(rec.state)) continue;
    if (rec.state === "DISMISSED") continue; // user deleted it: never re-review until pruned, even if the head advances

    const shaAdvanced = sha && sha !== rec.headSha;
    const authorReplied = args.authorRepliedKeys.has(key);

    if (rec.state === "POSTED_AWAITING_AUTHOR") {
      if (authorReplied || shaAdvanced) work.push({ key, mode: "re-review", sha, pr });
      continue;
    }
    if (shaAdvanced) {
      const mode: Mode = rec.mode === "re-review" ? "re-review" : "first-review";
      work.push({ key, mode, sha, pr });
    }
  }
  return work;
}
