import { Gh, ReviewThreadInput } from "./gh";
import { Draft, Finding, PrRecord, PostProgress, PostVerdict } from "./schema";

const APPROVE_BODY = "LGTM :+1:";

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

async function openPendingReview(
  gh: Gh, prNodeId: string, commitOid: string, progress: PostProgress, save: () => void,
): Promise<string> {
  if (progress.pendingReviewId) return progress.pendingReviewId;
  progress.pendingReviewId = await gh.createPendingReview(prNodeId, commitOid);
  save();
  return progress.pendingReviewId;
}

/** Try the precise line thread; on GitHub refusing the anchor, retry the same
 *  finding as a file-level thread. Returns false only when even that is refused.
 *  Task 6 adds the error discrimination — for now any failure propagates. */
async function addThreadWithFallback(gh: Gh, reviewId: string, spec: ThreadSpec): Promise<boolean> {
  if (spec.line) {
    await gh.addReviewThread(reviewId, spec.line);
    return true;
  }
  await gh.addReviewThread(reviewId, spec.file);
  return true;
}

export async function execute(
  gh: Gh, rec: PrRecord, login: string, nowIso: string,
  onProgress?: (p: PostProgress) => void,
): Promise<PrRecord> {
  // Pre-flight: never post to a PR that is no longer open (merged or closed),
  // then the head-SHA staleness check. Both come from one gh call.
  const { state: prState, headSha: liveSha, nodeId } = await gh.prStatus(rec.owner, rec.repo, rec.number);
  if (prState !== "OPEN") {
    return { ...rec, state: "CLOSED", updatedAt: nowIso };
  }
  if (liveSha !== rec.headSha) {
    return { ...rec, state: "STALE", updatedAt: nowIso };
  }

  const draft = rec.draft!;
  const verdict = rec.postVerdict ?? defaultVerdict(draft);
  const progress = rec.postProgress ?? {
    repliesPosted: [], threadsResolved: [], reviewPosted: false, reviewerRequested: false,
    pendingReviewId: null, threadsAdded: [], threadsFailed: [],
  };
  const save = () => onProgress?.(progress);  // persist after each action → crash-safe resume
  const resolvedThreadIds: string[] = [...progress.threadsResolved.map((id) => draft.verify.find((v) => v.id === id)?.threadNodeId).filter(Boolean) as string[]];

  // 1. In-thread replies (confirm + follow-up), for included verify items with a non-empty body.
  for (const v of draft.verify.filter((v) => v.included && v.verdict !== "needs-call")) {
    if (progress.repliesPosted.includes(v.id)) continue;
    const body = v.editedBody ?? v.replyBody;
    if (!body) continue;
    await gh.postReply(rec.owner, rec.repo, rec.number, v.replyTargetDatabaseId, body);
    progress.repliesPosted.push(v.id);
    save();
  }

  // 2. Resolve only the resolve-verdict threads.
  for (const v of draft.verify.filter((v) => v.included && v.verdict === "resolve")) {
    if (progress.threadsResolved.includes(v.id)) continue;
    await gh.resolveThread(v.threadNodeId);
    progress.threadsResolved.push(v.id);
    resolvedThreadIds.push(v.threadNodeId);
    save();
  }

  // 3. The review itself. With findings, every one becomes a thread on a pending
  //    review that is then submitted as a whole — one review, one notification.
  //    With no findings it's a bare REST approve (or nothing at all).
  let reviewUrl: string | null = rec.postResult?.reviewUrl ?? null;
  if (!progress.reviewPosted) {
    const specs = buildThreadSpecs(draft);

    if (specs.length === 0) {
      const payload = buildReviewPayload(rec, liveSha, verdict);
      if (payload) {
        const res = await gh.postReview(rec.owner, rec.repo, rec.number, payload);
        reviewUrl = res.html_url;
      }
    } else {
      const reviewId = await openPendingReview(gh, nodeId, liveSha, progress, save);

      for (const spec of specs) {
        if (progress.threadsAdded.includes(spec.id) || progress.threadsFailed.includes(spec.id)) continue;
        const landed = await addThreadWithFallback(gh, reviewId, spec);
        (landed ? progress.threadsAdded : progress.threadsFailed).push(spec.id);
        save();
      }

      const failed = draft.findings.filter((f) => progress.threadsFailed.includes(f.id));
      const res = await gh.submitReview(
        reviewId, verdict === "approve" ? "APPROVE" : "COMMENT", buildSubmitBody(verdict, failed),
      );
      reviewUrl = res.url;
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
    postResult: { reviewUrl, postedAt: nowIso, resolvedThreadIds },
    updatedAt: nowIso,
    doneAt: state === "DONE" ? nowIso : null,
  };
}

/** Give-up approval: post a bare LGTM APPROVE against the live head and finish.
 *  Ignores the draft entirely — no replies, no resolves, no findings — so any open
 *  threads/comments are left exactly as they are. Approves the *live* head, so a
 *  STALE record just works (no STALE bail, unlike execute()). Only pre-flight is the
 *  open-PR check: a merged/closed PR becomes CLOSED rather than a failed approve. */
export async function forceApprove(gh: Gh, rec: PrRecord, nowIso: string): Promise<PrRecord> {
  const { state: prState, headSha: liveSha } = await gh.prStatus(rec.owner, rec.repo, rec.number);
  if (prState !== "OPEN") return { ...rec, state: "CLOSED", forceApprove: false, updatedAt: nowIso };

  const res = await gh.postReview(rec.owner, rec.repo, rec.number, {
    event: "APPROVE", body: APPROVE_BODY, commit_id: liveSha,
  });
  return {
    ...rec, state: "DONE", postVerdict: "approve", headSha: liveSha,
    postResult: { reviewUrl: res.html_url, postedAt: nowIso, resolvedThreadIds: [] },
    forceApprove: false, updatedAt: nowIso, doneAt: nowIso,
  };
}
