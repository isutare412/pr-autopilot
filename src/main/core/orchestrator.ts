import { Store } from "./store";
import { JobQueue } from "./queue";
import { Gh, SearchPr } from "./gh";
import { execute } from "./executor";
import { decideWork, authorAwaitingReview } from "./poller";
import { PrRecord, Draft, Mode, Language, Effort, OperatingMode, prKey } from "./schema";

export interface OrchestratorDeps {
  store: Store;
  gh: Gh;
  generate: (input: { url: string; priorDraft?: Draft; feedback?: string; language: Language; effort: Effort }, onActivity?: (labels: string[]) => void) => Promise<Draft>;
  notifier: { send: (title: string, message: string, url: string) => Promise<void> };
  nowIso: () => string;
  login: string;
  retentionDays: number;
  concurrency: number;
  host: string;
  language: () => Language;
  effort: () => Effort;
  operatingMode: () => OperatingMode;
  repoAllow?: string[];
  repoDeny?: string[];
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

  enqueueGen = (key: string, feedback?: string) => {
    this.genQueue.submit(key, async () => {
      const rec = this.store.get(key);
      if (!rec) return;
      await this.runGeneration(key, rec.mode, rec.headSha,
        { url: rec.url, owner: rec.owner, repo: rec.repo, number: rec.number, title: rec.title }, feedback);
    });
  };

  enqueuePost = (key: string, auto = false) => {
    this.postQueue.submit(key, () => this.runPost(key, auto));
  };

  async runGeneration(key: string, mode: Mode, sha: string, pr: SearchPr, feedback?: string): Promise<void> {
    await this.store.withLock(key, async () => {
      let rec = this.store.get(key);
      const now = this.d.nowIso();
      if (!rec) {
        const v = await this.d.gh.view(pr.owner, pr.repo, pr.number);
        rec = {
          key, host: this.d.host, owner: pr.owner, repo: pr.repo, number: pr.number,
          url: pr.url, title: v.title, author: v.author, baseRef: v.baseRefName,
          state: "GENERATING", mode, headSha: v.headRefOid, draftVersion: 0, draft: null,
          feedbackHistory: [], postResult: null, postProgress: null, error: null,
          discoveredAt: now, generatedAt: null, updatedAt: now, doneAt: null,
        };
      } else {
        rec = { ...rec, state: "GENERATING", mode, updatedAt: now };
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
          if (cur && cur.state === "GENERATING") this.store.put({ ...cur, genActivity: steps.slice(-10) });
        };
        const draft = await this.generate({ url: rec.url, priorDraft, feedback, language: this.d.language(), effort: this.d.effort() }, onActivity);
        const updated: PrRecord = {
          ...rec, draft, state: "NEEDS_REVIEW", draftVersion: rec.draftVersion + 1,
          headSha: sha || rec.headSha, generatedAt: this.d.nowIso(), updatedAt: this.d.nowIso(), error: null,
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
        if (updated.state === "STALE") this.enqueueGen(key);
        else if (auto) await this.d.notifier.send("PR Autopilot", `Posted review: ${rec.repo} #${rec.number}`, rec.url);
      } catch (e) {
        this.store.put({ ...rec, state: "ERROR", error: { step: "post", message: String(e) }, updatedAt: this.d.nowIso() });
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

    const work = decideWork({ queue, existing, liveHeads, authorRepliedKeys,
      repoAllow: this.d.repoAllow, repoDeny: this.d.repoDeny, host: this.d.host });
    for (const w of work) {
      this.genQueue.submit(w.key, () => this.runGeneration(w.key, w.mode, w.sha, w.pr));
    }
  }

  pruneNow(): string[] {
    return this.store.prune(this.d.retentionDays, this.d.nowIso());
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
      else if (rec.state === "POSTING") { this.enqueuePost(rec.key); resumedPost.push(rec.key); }
    }
    return { regenerated, resumedPost };
  }
}
