import { Store } from "./store";
import { JobQueue } from "./queue";
import { Gh, SearchPr } from "./gh";
import { execute, forceApprove } from "./executor";
import { hasUnspentLedger } from "./api";
import { decideWork, authorAwaitingReview, keysToProbe } from "./poller";
import {
  PrRecord, Draft, Mode, Language, Effort, OperatingMode, PostProgress,
  prKey, emptyPostProgress,
} from "./schema";

export interface OrchestratorDeps {
  store: Store;
  gh: Gh;
  generate: (input: { url: string; priorDraft?: Draft; feedback?: string; language: Language; effort: Effort }, onActivity?: (labels: string[]) => void) => Promise<Draft>;
  notifier: { send: (title: string, message: string, url: string) => Promise<void> };
  nowIso: () => string;
  login: string;
  retentionDays: () => number;
  concurrency: number;
  host: string;
  language: () => Language;
  effort: () => Effort;
  operatingMode: () => OperatingMode;
  repoAllow?: () => string[];
  repoDeny?: () => string[];
}

/** Shown on a record whose post cycle stalled half-landed and can no longer be
 *  regenerated automatically (see hasUnspentLedger). It is an ERROR, not a silent
 *  STALE, so the user gets the two escapes the UI already offers from ERROR —
 *  Retry post and force-approve — plus the option of clearing the draft review on
 *  GitHub by hand. */
export const POST_STALLED_MID_CYCLE =
  "Part of this review already posted to GitHub (a reply, a resolved thread, or a draft review) " +
  "and the PR has moved on since — its head commit changed, so the rest can't be posted against " +
  "this draft, and re-drafting would duplicate what already landed. Retry the post, force-approve " +
  "to finish with a bare LGTM, or discard the draft review on GitHub and start over.";

/** What a fresh draft inherits from the post cycle it replaces.
 *
 *  - The SENT half (replies posted, threads resolved) is keyed by GitHub's own ids
 *    and describes mutations that are on the PR *permanently*. A re-draft does not
 *    un-post them, so it must not forget them either — dropping this ledger is what
 *    let a resumed post reply a second time to a thread that already had our reply.
 *    It survives, so the next post skips those threads by their GitHub ids even
 *    though the new draft gave them brand-new local ids.
 *  - The REVIEW half (pendingReviewId, threadsAdded/threadsFailed) is keyed by the
 *    *old* draft's finding ids and points at a pending review the new findings have
 *    nothing to do with. It is meaningless now, so it resets. (That reset is exactly
 *    why regeneration is refused while the ledger is unspent: it would orphan a real
 *    pending review. See hasUnspentLedger.)
 *  - A *spent* cycle (reviewPosted) starts the next one clean. Its replies belong to
 *    a review that already landed; a later re-review must be free to reply to those
 *    same threads again. */
function carryLedger(prev: PostProgress | null): PostProgress | null {
  if (!prev || prev.reviewPosted) return null;
  return {
    ...emptyPostProgress(),
    sent: {
      repliedTargets: [...prev.sent.repliedTargets],
      resolvedThreads: [...prev.sent.resolvedThreads],
    },
  };
}

export class Orchestrator {
  readonly store: Store;
  readonly genQueue: JobQueue;
  readonly postQueue: JobQueue;
  generate: OrchestratorDeps["generate"];
  private d: OrchestratorDeps;

  constructor(deps: OrchestratorDeps) {
    this.d = deps;
    this.store = deps.store;
    this.generate = deps.generate;
    this.genQueue = new JobQueue(deps.concurrency);
    this.postQueue = new JobQueue(deps.concurrency);
  }

  setConcurrency(n: number): void {
    this.genQueue.setConcurrency(n);
    this.postQueue.setConcurrency(n);
  }

  enqueueGen = (key: string, feedback?: string) => {
    this.genQueue.submit(key, async () => {
      const rec = this.store.get(key);
      if (!rec) return;
      await this.runGeneration(key, rec.mode,
        { url: rec.url, owner: rec.owner, repo: rec.repo, number: rec.number, title: rec.title }, feedback, true);
    });
  };

  enqueuePost = (key: string, auto = false) => {
    this.postQueue.submit(key, () => this.runPost(key, auto));
  };

  enqueueForceApprove = (key: string) => {
    this.postQueue.submit(key, () => this.runForceApprove(key));
  };

  async runGeneration(key: string, mode: Mode, pr: SearchPr, feedback?: string, skipIfTerminal = false): Promise<void> {
    await this.store.withLock(key, async () => {
      let rec = this.store.get(key);
      // A terminal record means another lane finished this PR while a regen sat
      // queued — e.g. a give-up force-approve on a STALE record won the postQueue
      // race and set DONE. Don't resurrect it. Only the recovery/feedback/STALE
      // lane (enqueueGen) opts in; poll-driven re-review, which legitimately
      // regenerates a DONE record whose head advanced, calls without the flag.
      if (skipIfTerminal && rec && (rec.state === "DONE" || rec.state === "CLOSED")) return;
      const now = this.d.nowIso();
      // Record the live head we're about to review against, captured at generation
      // start (the review's `gh pr diff` runs against this head). Recording a stale
      // value here — e.g. the poll-time sha or the previous record's frozen headSha —
      // makes every post STALE, and the STALE→regenerate recovery would then loop
      // forever instead of catching up to the head the author pushed.
      let headSha: string;
      if (!rec) {
        const v = await this.d.gh.view(pr.owner, pr.repo, pr.number);
        headSha = v.headRefOid;
        rec = {
          key, host: this.d.host, owner: pr.owner, repo: pr.repo, number: pr.number,
          url: pr.url, title: v.title, author: v.author, baseRef: v.baseRefName,
          state: "GENERATING", mode, headSha, draftVersion: 0, draft: null,
          feedbackHistory: [], postResult: null, postProgress: null, error: null,
          discoveredAt: now, generatedAt: null, updatedAt: now, doneAt: null,
        };
      } else {
        headSha = await this.d.gh.headSha(pr.owner, pr.repo, pr.number);
        rec = { ...rec, state: "GENERATING", mode, headSha, updatedAt: now };
      }
      this.store.put(rec);

      try {
        const priorDraft = feedback ? rec.draft ?? undefined : undefined;
        // Stream "what CC is doing" into the record (throttled) so the UI can show it live.
        // Reads/writes the store directly (no withLock): single-threaded, and the only other
        // writer for this key is the final put below, which runs after generate() resolves.
        const steps: string[] = [];
        let lastWrite = 0;
        const onActivity = (labels: string[]) => {
          steps.push(...labels);
          const t = Date.now();
          if (t - lastWrite < 700) return;
          lastWrite = t;
          const cur = this.store.get(key);
          if (cur && cur.state === "GENERATING") this.store.put({ ...cur, genActivity: steps.slice(-500) });
        };
        const draft = await this.generate({ url: rec.url, priorDraft, feedback, language: this.d.language(), effort: this.d.effort() }, onActivity);
        const updated: PrRecord = {
          ...rec, draft, state: "NEEDS_REVIEW", draftVersion: rec.draftVersion + 1,
          headSha, generatedAt: this.d.nowIso(), updatedAt: this.d.nowIso(), error: null,
          // A fresh draft begins a new post cycle. postResult (stale review URL) and
          // postVerdict (stale disposition) belong to the old one and go. What happens
          // to the ledger is the whole reason PostProgress has two halves:
          postProgress: carryLedger(rec.postProgress),
          postResult: null, postVerdict: undefined,
        };
        this.store.put(updated);
        if (this.d.operatingMode() === "automated") {
          // No human gate: flip to POSTING and post via the same path a manual approve uses.
          this.autoPost(key);
        } else {
          await this.d.notifier.send("PR Autopilot", `Draft ready: ${rec.repo} #${rec.number}`, rec.url);
        }
      } catch (e) {
        this.store.put({ ...rec, state: "ERROR", error: { step: "generate", message: String(e) }, updatedAt: this.d.nowIso() });
      }
    });
  }

  /** Flip a NEEDS_REVIEW record to POSTING and enqueue an automatic post.
   *  Writes the store directly (no withLock): callers are already serialized per key. */
  private autoPost(key: string): void {
    const rec = this.store.get(key);
    if (!rec) return;
    this.store.put({ ...rec, state: "POSTING", updatedAt: this.d.nowIso() });
    this.enqueuePost(key, true);
  }

  /** Post every draft currently awaiting review. Called when switching into
   *  Automated so an existing backlog does not sit forever. Returns the keys. */
  autoPostReady(): string[] {
    const keys: string[] = [];
    for (const rec of this.store.list()) {
      if (rec.state === "NEEDS_REVIEW") { this.autoPost(rec.key); keys.push(rec.key); }
    }
    return keys;
  }

  async runPost(key: string, auto = false): Promise<void> {
    await this.store.withLock(key, async () => {
      const rec = this.store.get(key);
      if (!rec || !rec.draft) return;
      try {
        const updated = await execute(this.d.gh, rec, this.d.login, this.d.nowIso(),
          (p) => { const cur = this.store.get(key); if (cur) this.store.put({ ...cur, postProgress: p }); });
        this.store.put(updated);
        if (updated.state === "STALE") {
          // execute() returns STALE by spreading `rec`, so an unspent postProgress
          // survives into the STALE record. Regenerating it here — the recovery that
          // normally catches the draft up to the head the author just pushed — would
          // orphan the pending review we opened and re-post against threads we've
          // already replied to. Nothing automatic can untangle that, so surface it as
          // an actionable ERROR instead of stalling silently.
          if (hasUnspentLedger(updated)) {
            this.store.put({ ...updated, state: "ERROR",
              error: { step: "post", message: POST_STALLED_MID_CYCLE }, updatedAt: this.d.nowIso() });
          } else {
            this.enqueueGen(key);
          }
        }
        else if (auto && (updated.state === "DONE" || updated.state === "POSTED_AWAITING_AUTHOR"))
          await this.d.notifier.send("PR Autopilot", `Posted review: ${rec.repo} #${rec.number}`, rec.url);
      } catch (e) {
        // Re-read: execute()'s onProgress callback may have persisted postProgress —
        // both halves — after `rec` was snapshotted above. Spreading the stale `rec`
        // here would discard that progress and leave the app unaware of an
        // already-created pending review (review half) and of the replies and resolves
        // already sent (sent half), risking an orphaned review and duplicate replies on
        // retry. Fall back to `rec` only if the record vanished entirely.
        const cur = this.store.get(key) ?? rec;
        this.store.put({ ...cur, state: "ERROR", error: { step: "post", message: String(e) }, updatedAt: this.d.nowIso() });
      }
    });
  }

  /** Give-up approval lane: post a bare LGTM and finish. No `!rec.draft` guard —
   *  force-approve needs no draft (covers an ERROR with a failed generation). */
  async runForceApprove(key: string): Promise<void> {
    await this.store.withLock(key, async () => {
      const rec = this.store.get(key);
      if (!rec) return;
      try {
        this.store.put(await forceApprove(this.d.gh, rec, this.d.nowIso()));
      } catch (e) {
        this.store.put({ ...rec, state: "ERROR", forceApprove: false,
          error: { step: "force-approve", message: String(e) }, updatedAt: this.d.nowIso() });
      }
    });
  }

  async runPoll(): Promise<void> {
    const queue = await this.d.gh.searchReviewRequested(this.d.login);
    const existing = new Map(this.store.list().map((r) => [r.key, r]));
    const liveHeads = new Map<string, string>();
    const authorRepliedKeys = new Set<string>();

    for (const pr of queue) {
      const key = prKey(this.d.host, pr.owner, pr.repo, pr.number);
      try {
        liveHeads.set(key, await this.d.gh.headSha(pr.owner, pr.repo, pr.number));
        const rec = existing.get(key);
        if (rec?.state === "POSTED_AWAITING_AUTHOR") {
          const threads = await this.d.gh.reviewThreads(pr.owner, pr.repo, pr.number);
          // Re-review only when the author has the last word (ball in my court),
          // not merely because some past reply exists — else an open follow-up
          // thread would re-trigger every poll. A silent code push is still
          // caught independently via the head-SHA advance in decideWork.
          if (authorAwaitingReview(threads, this.d.login)) authorRepliedKeys.add(key);
        }
      } catch (e) {
        console.error(`[poll] ${key} read failed:`, e);
      }
    }

    // Sweep lingering drafts whose PR dropped out of the open search because it
    // was merged or closed — mark them CLOSED so we never post to them and the
    // queue self-cleans. Still-open (merely unrequested) PRs are left as-is.
    const openKeys = new Set(queue.map((pr) => prKey(this.d.host, pr.owner, pr.repo, pr.number)));
    for (const key of keysToProbe(existing, openKeys)) {
      const rec = existing.get(key)!;
      try {
        const state = await this.d.gh.prState(rec.owner, rec.repo, rec.number);
        if (state !== "OPEN") {
          await this.store.withLock(key, async () => {
            const cur = this.store.get(key);
            if (cur && (cur.state === "NEEDS_REVIEW" || cur.state === "POSTED_AWAITING_AUTHOR")) {
              // Same reasoning as execute()'s non-OPEN exit and forceApprove's: the PR
              // is gone, so any unspent ledger here can never be spent, and CLOSED
              // offers neither of its two escapes — spend it now rather than wedge the
              // record forever. A later reopen is a new cycle and starts clean.
              this.store.put({ ...cur, state: "CLOSED", postProgress: null, updatedAt: this.d.nowIso() });
            }
          });
        }
      } catch (e) {
        console.error(`[poll] ${key} state probe failed:`, e);
      }
    }

    const work = decideWork({ queue, existing, liveHeads, authorRepliedKeys,
      repoAllow: this.d.repoAllow?.(), repoDeny: this.d.repoDeny?.(), host: this.d.host });
    for (const w of work) {
      this.genQueue.submit(w.key, () => this.runGeneration(w.key, w.mode, w.pr));
    }
  }

  pruneNow(): string[] {
    return this.store.prune(this.d.retentionDays(), this.d.nowIso());
  }

  /** Resume work orphaned by a previous daemon exit. At startup nothing is truly
   *  in-flight (a fresh process owns no children from the dead one), so any record
   *  still GENERATING/POSTING is orphaned: re-enqueue it.
   *  - GENERATING → regenerate (read-only w.r.t. GitHub).
   *  - POSTING    → resume the post; the executor skips already-done items via
   *                 postProgress and re-checks head-SHA staleness.
   *  Mutates no record itself — the re-run performs the state transitions. */
  recoverInFlight(): { regenerated: string[]; resumedPost: string[] } {
    const regenerated: string[] = [];
    const resumedPost: string[] = [];
    for (const rec of this.store.list()) {
      if (rec.state === "GENERATING") { this.enqueueGen(rec.key); regenerated.push(rec.key); }
      else if (rec.state === "POSTING") {
        (rec.forceApprove ? this.enqueueForceApprove : this.enqueuePost)(rec.key);
        resumedPost.push(rec.key);
      }
    }
    return { regenerated, resumedPost };
  }
}
