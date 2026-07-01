import { Gh } from "./gh";
import { Draft, PrRecord, PostProgress, PostVerdict } from "./schema";

/** Default disposition when the user didn't pick one (automated mode, or a
 *  resumed post from before verdicts existed): "comment" (and re-queue) whenever
 *  there's anything still open, else a clean "approve". */
export function defaultVerdict(draft: Draft): PostVerdict {
  const hasFindings = draft.findings.some((f) => f.included);
  const hasOpenThreads = draft.verify.some((v) => v.included && v.verdict !== "resolve");
  return hasFindings || hasOpenThreads ? "comment" : "approve";
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
      ? { event: "APPROVE", body: "LGTM :+1:", commit_id: headSha }
      : null;
  }

  const comments = anchorable.map((f) => {
    const c: any = { path: f.path, line: f.line, side: f.side, body: f.editedBody ?? f.body };
    if (f.startLine != null) { c.start_line = f.startLine; c.start_side = f.startSide ?? f.side; }
    return c;
  });

  const body = unanchorable.length === 0 ? "" :
    unanchorable.map((f) => `${f.path}:${f.line} — ${f.editedBody ?? f.body}`).join("\n\n");

  // Approving with comments attaches the nits to an APPROVE; otherwise it's a neutral COMMENT.
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
