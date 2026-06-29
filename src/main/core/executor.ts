import { Gh } from "./gh";
import { PrRecord, PostProgress } from "./schema";

export function buildReviewPayload(rec: PrRecord, headSha: string) {
  const draft = rec.draft!;
  const included = draft.findings.filter((f) => f.included);
  const anchorable = included.filter((f) => f.anchorable);
  const unanchorable = included.filter((f) => !f.anchorable);

  if (included.length === 0) {
    return { event: "APPROVE", body: "LGTM :+1:", commit_id: headSha };
  }

  const comments = anchorable.map((f) => {
    const c: any = { path: f.path, line: f.line, side: f.side, body: f.editedBody ?? f.body };
    if (f.startLine != null) { c.start_line = f.startLine; c.start_side = f.startSide ?? f.side; }
    return c;
  });

  const body = unanchorable.length === 0 ? "" :
    unanchorable.map((f) => `${f.path}:${f.line} — ${f.editedBody ?? f.body}`).join("\n\n");

  return { event: "COMMENT", body, commit_id: headSha, comments };
}

export async function execute(
  gh: Gh, rec: PrRecord, login: string, nowIso: string,
  onProgress?: (p: PostProgress) => void,
): Promise<PrRecord> {
  // Pre-flight staleness check.
  const liveSha = await gh.headSha(rec.owner, rec.repo, rec.number);
  if (liveSha !== rec.headSha) {
    return { ...rec, state: "STALE", updatedAt: nowIso };
  }

  const draft = rec.draft!;
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

  // 3. Batched review for new findings (or LGTM approve).
  let reviewUrl: string | null = rec.postResult?.reviewUrl ?? null;
  if (!progress.reviewPosted) {
    const payload = buildReviewPayload(rec, liveSha);
    const res = await gh.postReview(rec.owner, rec.repo, rec.number, payload);
    reviewUrl = res.html_url;
    progress.reviewPosted = true;
    save();
  }

  // Determine whether findings remain (drives re-request + terminal state).
  const hasFindings = draft.findings.some((f) => f.included);
  const hasOpenThreads = draft.verify.some((v) => v.included && v.verdict !== "resolve");
  const findingsRemain = hasFindings || hasOpenThreads;

  // 4. Re-request self when findings remain.
  if (findingsRemain && !progress.reviewerRequested) {
    try {
      await gh.requestReviewer(rec.owner, rec.repo, rec.number, login);
    } catch { /* self-only; ignore (e.g. user is the author) */ }
    progress.reviewerRequested = true;
    save();
  }

  const state = findingsRemain ? "POSTED_AWAITING_AUTHOR" : "DONE";
  return {
    ...rec,
    state,
    postProgress: progress,
    postResult: { reviewUrl, postedAt: nowIso, resolvedThreadIds },
    updatedAt: nowIso,
    doneAt: state === "DONE" ? nowIso : null,
  };
}
