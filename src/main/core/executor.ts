import { Gh, ReviewThreadInput } from "./gh";
import { Draft, Finding, PrRecord, PostProgress, PostVerdict, emptyPostProgress } from "./schema";

const APPROVE_BODY = "LGTM :+1:";

export const PENDING_REVIEW_CONFLICT =
  "An unsubmitted pending review already exists on this PR — submit or discard it on GitHub, then retry.";

/** Thrown when the current draft no longer matches what is already attached to the
 *  pending review — e.g. a finding was dropped (or a re-draft rewrote the findings)
 *  after its thread had already landed on GitHub. Submitting now would ship that
 *  stale thread anyway, silently contradicting what the draft shows. There is no
 *  safe automatic recovery (deleting the review could destroy a hand-written draft;
 *  see reconcilePendingReview), so this aborts and tells the user what to do. */
export const DRAFT_CHANGED_AFTER_POST =
  "The draft changed after part of it was already attached to a review on GitHub — discard the draft review on GitHub, then retry.";

/** A finding's two ways onto the PR. `line` is the precise inline thread; `file`
 *  is the whole-file thread — the honest fallback when GitHub won't anchor to the
 *  line, which it refuses for anything outside the diff hunks. Every spec carries
 *  a `file` attempt so a mis-marked `anchorable` can still land as a thread. */
export interface ThreadSpec {
  id: string;
  line: ReviewThreadInput | null;
  file: ReviewThreadInput;
}

/** A file-level thread renders under the file, not a line — so the line has to
 *  survive in the text or the reader can't tell what the comment is about. */
export function fileThreadBody(f: Finding): string {
  const body = f.editedBody ?? f.body;
  if (!Number.isFinite(f.line) || f.line <= 0) return body;
  const loc = f.startLine != null && f.startLine !== f.line
    ? `\`lines ${f.startLine}–${f.line}\``
    : `\`line ${f.line}\``;
  return `${loc}\n\n${body}`;
}

export function buildThreadSpecs(draft: Draft): ThreadSpec[] {
  return draft.findings.filter((f) => f.included).map((f) => {
    const file: ReviewThreadInput = {
      path: f.path, body: fileThreadBody(f), subjectType: "FILE",
    };
    if (!f.anchorable) return { id: f.id, line: null, file };

    const line: ReviewThreadInput = {
      path: f.path, body: f.editedBody ?? f.body, subjectType: "LINE",
      line: f.line, side: f.side,
    };
    if (f.startLine != null) {
      line.startLine = f.startLine;
      line.startSide = f.startSide ?? f.side;
    }
    return { id: f.id, line, file };
  });
}

/** The submitted review's body. An APPROVE leads with the LGTM line. `failed` holds
 *  the findings GitHub refused as *both* a line thread and a file thread — the last
 *  resort, so they still ship rather than being dropped. It is normally empty. */
export function buildSubmitBody(verdict: PostVerdict, failed: Finding[]): string {
  const folded = failed
    .map((f) => `${f.path}:${f.line} — ${f.editedBody ?? f.body}`)
    .join("\n\n");
  return verdict === "approve"
    ? [APPROVE_BODY, folded].filter(Boolean).join("\n\n")
    : folded;
}

/** Default disposition when the user didn't pick one (automated mode, or a
 *  resumed post from before verdicts existed). Route on severity, not mere
 *  presence: a draft whose only open items are Nit findings (and/or resolve
 *  replies) is an "approve" — the nits ship on the approval and the author
 *  needn't come back. Anything heavier — a Critical/Major/Minor finding, or an
 *  unresolved follow-up/needs-call thread the author still owes — is a "comment"
 *  that re-requests you. */
export function defaultVerdict(draft: Draft): PostVerdict {
  const hasNonNit = draft.findings.some((f) => f.included && f.priority !== "Nit");
  const hasOpenThreads = draft.verify.some((v) => v.included && v.verdict !== "resolve");
  return hasNonNit || hasOpenThreads ? "comment" : "approve";
}

/** The REST payload for the only case that needs no threads: a clean PR. An
 *  approve with no findings is a bare LGTM; a comment with no findings posts
 *  nothing at all (the substance is the replies/resolves). Findings, when there
 *  are any, go through the GraphQL pending-review flow in execute() instead. */
export function buildReviewPayload(
  rec: PrRecord, headSha: string, verdict: PostVerdict = defaultVerdict(rec.draft!),
) {
  return verdict === "approve"
    ? { event: "APPROVE", body: APPROVE_BODY, commit_id: headSha }
    : null;
}

/** What the PR's actual state says we should do with the review we may have opened. */
type Reconciled =
  | { kind: "review"; reviewId: string }        // a PENDING draft to add threads to
  | { kind: "landed"; url: string };            // already submitted — do not post again

/** GitHub allows exactly one pending review per user per PR, so before opening one we
 *  reconcile what is actually on the PR against what we last persisted:
 *
 *   - stored id, still PENDING   → resume into it, keeping the threads already added.
 *   - stored id, now SUBMITTED   → the review LANDED and only our bookkeeping was lost
 *                                  (a crash between GitHub's 200 and our disk write).
 *                                  Re-posting would put a second review on the author's
 *                                  PR, so we recover the URL and stop.
 *   - stored id, node gone       → the user discarded the draft in the browser; its
 *                                  threads went with it, so recreate and re-add all.
 *   - nothing stored, none live  → create.
 *   - a pending review we cannot account for → ABORT. It is either a crash orphan or a
 *     draft the user wrote by hand, and the API cannot tell those apart. Deleting would
 *     destroy their work with no undo; adopting would post their private comments inside
 *     an autopilot review. So we touch neither and say so. */
async function reconcilePendingReview(
  gh: Gh, rec: PrRecord, login: string, prNodeId: string, commitOid: string,
  progress: PostProgress, save: () => void,
): Promise<Reconciled> {
  const review = progress.review;
  if (review.pendingReviewId) {
    const stored = await gh.reviewState(review.pendingReviewId);
    if (stored?.state === "PENDING") return { kind: "review", reviewId: review.pendingReviewId };
    if (stored) return { kind: "landed", url: stored.url };
    review.pendingReviewId = null;   // discarded — fall through and rebuild it
    review.threadsAdded = [];
    review.threadsFailed = [];
  }

  const live = await gh.findPendingReview(rec.owner, rec.repo, rec.number, login);
  if (live) throw new Error(PENDING_REVIEW_CONFLICT);

  review.pendingReviewId = await gh.createPendingReview(prNodeId, commitOid);
  review.threadsAdded = [];    // a fresh draft holds none of the old threads
  review.threadsFailed = [];
  save();
  return { kind: "review", reviewId: review.pendingReviewId };
}

/** GitHub refusing to anchor a comment — the API rejects any line outside the diff
 *  hunks (the web UI can do it; the API cannot). This is the *only* failure the
 *  fallback ladder may absorb: anything else (transport, auth, rate limit) must
 *  propagate, or one network blip would silently post the whole review as body text. */
const DIFF_REJECTION = /must be part of the diff|diff.?hunk can't be blank|not part of the diff/i;

export function isDiffRejection(e: unknown): boolean {
  return DIFF_REJECTION.test(String(e));
}

/** LINE → FILE → caller folds it into the body. Returns false only when GitHub
 *  refuses the finding as a file-level thread too (a file the PR doesn't touch). */
async function addThreadWithFallback(gh: Gh, reviewId: string, spec: ThreadSpec): Promise<boolean> {
  if (spec.line) {
    try {
      await gh.addReviewThread(reviewId, spec.line);
      return true;
    } catch (e) {
      if (!isDiffRejection(e)) throw e;
    }
  }
  try {
    await gh.addReviewThread(reviewId, spec.file);
    return true;
  } catch (e) {
    if (!isDiffRejection(e)) throw e;
    return false;
  }
}

export async function execute(
  gh: Gh, rec: PrRecord, login: string, nowIso: string,
  onProgress?: (p: PostProgress) => void,
): Promise<PrRecord> {
  // Pre-flight: never post to a PR that is no longer open (merged or closed),
  // then the head-SHA staleness check. Both come from one gh call.
  const { state: prState, headSha: liveSha, nodeId } = await gh.prStatus(rec.owner, rec.repo, rec.number);
  if (prState !== "OPEN") {
    // Spend the ledger here too, for exactly the reason forceApprove's non-OPEN exit
    // does: the PR is gone, so this cycle can never be completed and the ledger can
    // never be spent by the normal route (`reviewPosted = true` below never runs).
    // CLOSED offers neither of the ledger's two escapes — Retry post requires
    // NEEDS_REVIEW/ERROR, force-approve requires POSTED_AWAITING_AUTHOR/STALE/ERROR —
    // so an unspent ledger surviving into CLOSED would wedge the record forever,
    // silently skipped by every regeneration gate (hasUnspentLedger) until
    // store.prune eventually deletes it. If the PR is later reopened, that is a new
    // cycle and must start clean, same reasoning as forceApprove.
    return { ...rec, state: "CLOSED", postProgress: null, updatedAt: nowIso };
  }
  if (liveSha !== rec.headSha) {
    return { ...rec, state: "STALE", updatedAt: nowIso };
  }

  const draft = rec.draft!;
  const verdict = rec.postVerdict ?? defaultVerdict(draft);
  const progress = rec.postProgress ?? emptyPostProgress();
  const save = () => onProgress?.(progress);  // persist after each action → crash-safe resume

  // 1. In-thread replies (confirm + follow-up), for included verify items with a
  //    non-empty body. Skipped by GitHub's *own* id for the thread we'd reply to,
  //    never by the verify item's local id: this draft may be a re-draft of the one
  //    that posted the reply, in which case the same GitHub thread wears a brand-new
  //    local id (see schema.ts's SentToGitHub).
  for (const v of draft.verify.filter((v) => v.included && v.verdict !== "needs-call")) {
    if (progress.sent.repliedTargets.includes(v.replyTargetDatabaseId)) continue;
    const body = v.editedBody ?? v.replyBody;
    if (!body) continue;
    await gh.postReply(rec.owner, rec.repo, rec.number, v.replyTargetDatabaseId, body);
    progress.sent.repliedTargets.push(v.replyTargetDatabaseId);
    save();
  }

  // 2. Resolve only the resolve-verdict threads — again skipped by GitHub's thread id.
  for (const v of draft.verify.filter((v) => v.included && v.verdict === "resolve")) {
    if (progress.sent.resolvedThreads.includes(v.threadNodeId)) continue;
    await gh.resolveThread(v.threadNodeId);
    progress.sent.resolvedThreads.push(v.threadNodeId);
    save();
  }

  // 3. The review itself. With findings, every one becomes a thread on a pending
  //    review that is then submitted as a whole — one review, one notification.
  //    With no findings, it's normally a bare REST approve (or nothing at all) —
  //    but a pendingReviewId already on the record means *we* opened a draft on
  //    GitHub at some point, so even zero current specs must reconcile with it
  //    rather than take the fast path. And when we hold no pendingReviewId at
  //    all, that alone does not prove none exists: a *spent* cycle (reviewPosted,
  //    which execute() also sets when it had nothing to submit) can still leave a
  //    pending review we opened live on the PR, and the next generation clears the
  //    ledger — along with our record of it. A user can also hand-write a draft
  //    review in the browser. So the zero-specs branch below asks GitHub directly
  //    before assuming the fast path is safe, rather than inferring "no pending
  //    review" from our own bookkeeping.
  let reviewUrl: string | null = rec.postResult?.reviewUrl ?? null;
  if (!progress.reviewPosted) {
    const specs = buildThreadSpecs(draft);

    if (specs.length === 0 && !progress.review.pendingReviewId) {
      // Build the payload before asking GitHub anything: a "comment" verdict
      // with zero findings is null — nothing is posted, so nothing can collide
      // with a pending review, ours or anyone else's. Guard only the actual
      // REST call, or a hand-written draft the user keeps open on the PR turns
      // every replies-only post into a hard, un-retriable ERROR (the replies in
      // steps 1–2 above have already landed by the time this throws).
      const payload = buildReviewPayload(rec, liveSha, verdict);
      if (payload) {
        if (await gh.findPendingReview(rec.owner, rec.repo, rec.number, login)) {
          // Someone's pending review is live — ours from a cycle that ended without
          // submitting it, or the user's own hand-written draft. Landing a REST
          // review beside it would violate GitHub's one-pending-review-per-user
          // limit and, if it's our orphan, wedge every future post behind this same
          // conflict until the user discards it by hand.
          throw new Error(PENDING_REVIEW_CONFLICT);
        }
        const res = await gh.postReview(rec.owner, rec.repo, rec.number, payload);
        reviewUrl = res.html_url;
      }
    } else {
      const target = await reconcilePendingReview(gh, rec, login, nodeId, liveSha, progress, save);

      if (target.kind === "landed") {
        // The review is already on the PR — a crash lost only our record of it.
        reviewUrl = target.url;
      } else {
        const reviewId = target.reviewId;

        // Backstop: the draft may have changed after part of it was already
        // attached — practically, a finding dropped or edited via the
        // (now-locked) toggle/edit API is the only way an id can still slip
        // through to here. It does NOT cover a re-draft: the review half of the
        // ledger (threadsAdded/threadsFailed/pendingReviewId) is reset by
        // runGeneration, so no stale id survives for this check to catch. What
        // protects a re-draft is that regeneration is *refused* while the ledger
        // is unspent (api.hasUnspentLedger gates every entry point), and — for a
        // pending review we opened in a cycle that ended without submitting it —
        // reconcilePendingReview / the fast path's findPendingReview asking GitHub
        // and throwing PENDING_REVIEW_CONFLICT. Runs *after* reconcile: the
        // discarded-draft branch above legitimately resets both lists, and that
        // reset must win.
        //
        // Id-stability note: this compares finding *ids* only — never bodies.
        // Ids come from the model's JSON and are not content-stable across
        // drafts. That's sound only because the review half of the ledger never
        // outlives the draft it was keyed against, and toggle/editItem are locked
        // (draftLocked) the instant a pending review exists, closing the window (a
        // full network round-trip between persisting pendingReviewId and the first
        // addReviewThread) where a same-id edit could otherwise slip through: this
        // check would see the id unchanged and pass, and execute() would then post
        // the *old* captured body while the UI showed the *new* one as sent — id
        // stability says nothing about content staying put. If a future change
        // starts carrying the review half across a re-draft (the way the sent half
        // deliberately is), id reuse could defeat this comparison silently.
        const review = progress.review;
        const specIds = new Set(specs.map((s) => s.id));
        const attached = [...review.threadsAdded, ...review.threadsFailed];
        if (attached.some((id) => !specIds.has(id))) throw new Error(DRAFT_CHANGED_AFTER_POST);

        for (const spec of specs) {
          if (review.threadsAdded.includes(spec.id) || review.threadsFailed.includes(spec.id)) continue;
          const landed = await addThreadWithFallback(gh, reviewId, spec);
          (landed ? review.threadsAdded : review.threadsFailed).push(spec.id);
          save();
        }

        const failed = draft.findings.filter((f) => review.threadsFailed.includes(f.id));
        const body = buildSubmitBody(verdict, failed);
        // A submit with no threads and an empty body is rejected by GitHub. An
        // approve always has the LGTM line, so it is never empty; a comment with
        // nothing attached and nothing to say submits nothing, same as today's
        // no-findings behavior — the pending review (if any) is left untouched,
        // never deleted.
        const hasContent = review.threadsAdded.length > 0 || review.threadsFailed.length > 0 || body.length > 0;
        if (hasContent) {
          const res = await gh.submitReview(reviewId, verdict === "approve" ? "APPROVE" : "COMMENT", body);
          reviewUrl = res.url;
        }
      }
    }

    progress.reviewPosted = true;   // mark done even when skipped, so resume doesn't retry
    save();
  }

  // 4. Re-request self only when the verdict says "comment" — i.e. you're coming
  //    back to verify the author's response. An "approve" means you're finished.
  if (verdict === "comment" && !progress.reviewerRequested) {
    try {
      await gh.requestReviewer(rec.owner, rec.repo, rec.number, login);
    } catch { /* self-only; ignore (e.g. user is the author) */ }
    progress.reviewerRequested = true;
    save();
  }

  const state = verdict === "comment" ? "POSTED_AWAITING_AUTHOR" : "DONE";
  return {
    ...rec,
    state,
    postProgress: progress,
    // Straight from the sent-ledger — it already holds exactly the GitHub thread
    // ids we resolved, this cycle and (after a re-draft) any earlier attempt of it.
    postResult: { reviewUrl, postedAt: nowIso, resolvedThreadIds: [...progress.sent.resolvedThreads] },
    updatedAt: nowIso,
    doneAt: state === "DONE" ? nowIso : null,
  };
}

/** Give-up approval: post a bare LGTM APPROVE against the live head and finish.
 *  Ignores the draft entirely — no replies, no resolves, no findings — so any open
 *  threads/comments are left exactly as they are. Approves the *live* head, so a
 *  STALE record just works (no STALE bail, unlike execute()). Only pre-flight is the
 *  open-PR check: a merged/closed PR becomes CLOSED rather than a failed approve.
 *
 *  Both exits end the post cycle, so both spend the ledger (`postProgress: null`):
 *  this is the *only* thing that ends a cycle without going through execute()'s own
 *  `reviewPosted = true`, so it must clear the ledger itself or hasUnspentLedger
 *  stays true forever — wedging every future regeneration entry point (poller.
 *  decideWork, orchestrator's STALE recovery) even though the record is DONE/CLOSED
 *  and nothing will ever spend it. A merged/closed PR is just as final as an
 *  approve: nothing more can land on it, and if it is ever reopened that is a new
 *  cycle that must start clean — same reasoning as the approve path below. */
export async function forceApprove(gh: Gh, rec: PrRecord, nowIso: string): Promise<PrRecord> {
  const { state: prState, headSha: liveSha } = await gh.prStatus(rec.owner, rec.repo, rec.number);
  if (prState !== "OPEN") {
    return { ...rec, state: "CLOSED", postProgress: null, forceApprove: false, updatedAt: nowIso };
  }

  const res = await gh.postReview(rec.owner, rec.repo, rec.number, {
    event: "APPROVE", body: APPROVE_BODY, commit_id: liveSha,
  });
  return {
    ...rec, state: "DONE", postVerdict: "approve", headSha: liveSha,
    postResult: { reviewUrl: res.html_url, postedAt: nowIso, resolvedThreadIds: [] },
    postProgress: null, forceApprove: false, updatedAt: nowIso, doneAt: nowIso,
  };
}
