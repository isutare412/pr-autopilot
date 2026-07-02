import { Gh } from "./gh";
import { Draft, PrRecord, PostProgress, PostVerdict } from "./schema";

const APPROVE_BODY = "LGTM :+1:";

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

/** Build the batched review submission, or null when there's no review to post
 *  (a "comment" disposition with no new findings — the substance is the
 *  replies/resolves, so an empty COMMENT review would just be noise). */
export function buildReviewPayload(
  rec: PrRecord, headSha: string, verdict: PostVerdict = defaultVerdict(rec.draft!),
) {
  const draft = rec.draft!;
  const included = draft.findings.filter((f) => f.included);
  const anchorable = included.filter((f) => f.anchorable);
  const unanchorable = included.filter((f) => !f.anchorable);

  if (included.length === 0) {
    return verdict === "approve"
      ? { event: "APPROVE", body: APPROVE_BODY, commit_id: headSha }
      : null;
  }

  const comments = anchorable.map((f) => {
    const c: any = { path: f.path, line: f.line, side: f.side, body: f.editedBody ?? f.body };
    if (f.startLine != null) { c.start_line = f.startLine; c.start_side = f.startSide ?? f.side; }
    return c;
  });

  const unanchorableText = unanchorable.length === 0 ? "" :
    unanchorable.map((f) => `${f.path}:${f.line} — ${f.editedBody ?? f.body}`).join("\n\n");

  // An APPROVE always leads with the LGTM line; a nit that can't anchor inline is
  // appended below it so it still ships. A COMMENT carries only the finding text
  // (unanchorable folded into the body, else empty).
  const body = verdict === "approve"
    ? [APPROVE_BODY, unanchorableText].filter(Boolean).join("\n\n")
    : unanchorableText;

  return { event: verdict === "approve" ? "APPROVE" : "COMMENT", body, commit_id: headSha, comments };
}

export async function execute(
  gh: Gh, rec: PrRecord, login: string, nowIso: string,
  onProgress?: (p: PostProgress) => void,
): Promise<PrRecord> {
  // Pre-flight: never post to a PR that is no longer open (merged or closed),
  // then the head-SHA staleness check. Both come from one gh call.
  const { state: prState, headSha: liveSha } = await gh.prStatus(rec.owner, rec.repo, rec.number);
  if (prState !== "OPEN") {
    return { ...rec, state: "CLOSED", updatedAt: nowIso };
  }
  if (liveSha !== rec.headSha) {
    return { ...rec, state: "STALE", updatedAt: nowIso };
  }

  const draft = rec.draft!;
  const verdict = rec.postVerdict ?? defaultVerdict(draft);
  const progress = rec.postProgress ?? { repliesPosted: [], threadsResolved: [], reviewPosted: false, reviewerRequested: false };
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

  // 3. Batched review (APPROVE or COMMENT per the verdict). May be a no-op when
  //    the verdict is "comment" and there are no new findings to attach.
  let reviewUrl: string | null = rec.postResult?.reviewUrl ?? null;
  if (!progress.reviewPosted) {
    const payload = buildReviewPayload(rec, liveSha, verdict);
    if (payload) {
      const res = await gh.postReview(rec.owner, rec.repo, rec.number, payload);
      reviewUrl = res.html_url;
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
