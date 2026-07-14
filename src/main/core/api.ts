import { Store } from "./store";
import { PrRecord, PostVerdict } from "./schema";

export interface ApiDeps {
  store: Store;
  nowIso: () => string;
  enqueueGen: (key: string, feedback?: string) => void;
  enqueuePost: (key: string) => void;
  enqueueForceApprove: (key: string) => void;
}

type Err = { error: string };
const NF: Err = { error: "not found" };

export const DRAFT_LOCKED_MESSAGE =
  "Some findings are already attached to a draft review on GitHub. Retry the post to send the rest, or discard the draft review on GitHub.";
const LOCKED: Err = { error: DRAFT_LOCKED_MESSAGE };

/** True once a post is in flight or some mutation from the current post cycle
 *  has actually landed on (or been opened against) GitHub — a reply posted, a
 *  thread resolved, a pending review created, or a finding attached to (or
 *  permanently folded into) it — and that review hasn't been submitted yet.
 *  Editing or dropping an item past this point cannot un-post what already
 *  landed, so toggleItem/editItem/submitFeedback reject while this holds.
 *
 *  `pendingReviewId != null` locks on its own, even with nothing attached yet:
 *  executor.ts persists that id *before* the first addReviewThread call, so the
 *  window between those two saves is a real gap — a full network round-trip,
 *  not a crash window — during which the review already exists on GitHub. A
 *  user edit landing in that gap ships with the post's *old* captured body
 *  while the UI shows the *new* one as posted (see executor.ts's backstop
 *  comment for why body edits, unlike dropped ids, are invisible to it). The
 *  `state === "POSTING"` check closes the narrower window before that: the
 *  whole post is committed to landing once POSTING starts, even before
 *  reconcilePendingReview's first save. Locking on a bare pending review is
 *  correct conservatism, not over-locking — the review genuinely exists.
 *
 *  See executor.ts's DRAFT_CHANGED_AFTER_POST backstop for the mirror check on
 *  the executor side, which catches a toggle/edit that slips past this lock.
 *  That backstop does NOT cover a re-draft from feedback — runGeneration nulls
 *  postProgress on every regeneration, so there's no stale id left for it to
 *  catch there; a clean re-draft is instead caught by execute() asking GitHub
 *  directly before taking its no-findings fast path. */
export function draftLocked(rec: PrRecord): boolean {
  if (rec.state === "POSTING") return true;
  const p = rec.postProgress;
  return p != null && !p.reviewPosted &&
    (p.pendingReviewId != null ||
     p.repliesPosted.length > 0 || p.threadsResolved.length > 0 ||
     p.threadsAdded.length > 0 || p.threadsFailed.length > 0);
}

function findItem(rec: PrRecord, ref: string) {
  return rec.draft?.findings.find((f) => f.ref === ref) ?? rec.draft?.verify.find((v) => v.ref === ref);
}

export const api = {
  list(deps: ApiDeps) {
    const items = deps.store.list().map((r) => ({
      key: r.key, number: r.number, repo: r.repo, title: r.title, state: r.state,
      mode: r.mode, counts: r.draft?.counts ?? null, updatedAt: r.updatedAt,
      dismissed: !!r.dismissed,
    }));
    return { items };
  },

  get(deps: ApiDeps, key: string): PrRecord | Err {
    return deps.store.get(key) ?? NF;
  },

  toggleItem(deps: ApiDeps, key: string, ref: string, included: boolean): PrRecord | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
    if (draftLocked(rec)) return LOCKED;
    const item = findItem(rec, ref);
    if (!item) return { error: "item not found" };
    item.included = included;
    rec.updatedAt = deps.nowIso();
    deps.store.put(rec);
    return rec;
  },

  editItem(deps: ApiDeps, key: string, ref: string, editedBody: string | null): PrRecord | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
    if (draftLocked(rec)) return LOCKED;
    const item = findItem(rec, ref);
    if (!item) return { error: "item not found" };
    item.editedBody = editedBody;
    rec.updatedAt = deps.nowIso();
    deps.store.put(rec);
    return rec;
  },

  submitFeedback(deps: ApiDeps, key: string, text: string): { ok: true } | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
    // A re-draft nulls postProgress (runGeneration) — wiping the repliesPosted /
    // threadsResolved ledger that keeps a resumed post from re-posting a reply
    // to the same GitHub thread. While the draft is locked, that ledger is the
    // only thing preventing a duplicate mutation, so a fresh draft must wait
    // until the user resolves the lock (retry post, or force-approve).
    if (draftLocked(rec)) return LOCKED;
    if (rec.draft) deps.store.snapshot(rec);
    rec.feedbackHistory.push({ at: deps.nowIso(), text, producedVersion: rec.draftVersion + 1 });
    rec.state = "GENERATING";
    rec.updatedAt = deps.nowIso();
    deps.store.put(rec);
    deps.enqueueGen(key, text);
    return { ok: true };
  },

  approve(deps: ApiDeps, key: string, verdict: PostVerdict): { ok: true } | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
    rec.postVerdict = PostVerdict.parse(verdict);   // disposition the executor reads back
    rec.state = "POSTING";
    rec.updatedAt = deps.nowIso();
    deps.store.put(rec);
    deps.enqueuePost(key);
    return { ok: true };
  },

  forceApprove(deps: ApiDeps, key: string): { ok: true } | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
    rec.forceApprove = true;         // routes crash-recovery back to the force-approve lane
    rec.state = "POSTING";
    rec.updatedAt = deps.nowIso();
    deps.store.put(rec);
    deps.enqueueForceApprove(key);
    return { ok: true };
  },

  dismiss(deps: ApiDeps, key: string): PrRecord | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
    rec.dismissed = true;          // view flag only — lifecycle state is untouched
    rec.updatedAt = deps.nowIso();
    deps.store.put(rec);
    return rec;
  },

  restore(deps: ApiDeps, key: string): PrRecord | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
    rec.dismissed = false;         // unhide; the next poll re-evaluates the real state
    rec.updatedAt = deps.nowIso();
    deps.store.put(rec);
    return rec;
  },

  delete(deps: ApiDeps, key: string): { ok: true } | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
    deps.store.delete(key);
    return { ok: true };
  },
};
