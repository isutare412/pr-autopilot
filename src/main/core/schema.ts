import { z } from "zod";

export const Language = z.enum(["en", "ko", "ja"]);
export type Language = z.infer<typeof Language>;
export const LANGUAGE_LABEL: Record<Language, string> = { en: "English", ko: "Korean", ja: "Japanese" };

export const Effort = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof Effort>;

export const Priority = z.enum(["Critical", "Major", "Minor", "Nit"]);
export type Priority = z.infer<typeof Priority>;

export const Side = z.enum(["RIGHT", "LEFT"]);
export type Side = z.infer<typeof Side>;

export const Verdict = z.enum(["resolve", "follow-up", "needs-call"]);
export type Verdict = z.infer<typeof Verdict>;

export const Mode = z.enum(["first-review", "re-review"]);
export type Mode = z.infer<typeof Mode>;

/** The reviewer's posting disposition, chosen at post time:
 *  - "approve"  → submit an APPROVE review (with any nit comments), don't re-queue, mark DONE.
 *  - "comment"  → submit a COMMENT review (or just replies/resolves), re-request self, await author. */
export const PostVerdict = z.enum(["approve", "comment"]);
export type PostVerdict = z.infer<typeof PostVerdict>;

export const OperatingMode = z.enum(["disabled", "supervised", "automated"]);
export type OperatingMode = z.infer<typeof OperatingMode>;

export const PrState = z.enum([
  "DISCOVERED", "GENERATING", "NEEDS_REVIEW", "POSTING",
  "POSTED_AWAITING_AUTHOR", "DONE", "STALE", "ERROR", "CLOSED",
]);
export type PrState = z.infer<typeof PrState>;

export const Finding = z.object({
  id: z.string(),
  ref: z.string(),
  path: z.string(),
  line: z.number().int(),
  side: Side,
  startLine: z.number().int().nullable().default(null),
  startSide: Side.nullable().default(null),
  anchorable: z.boolean(),
  priority: Priority,
  body: z.string(),
  suggestion: z.string().nullable().default(null),
  included: z.boolean().default(true),
  editedBody: z.string().nullable().default(null),
});
export type Finding = z.infer<typeof Finding>;

export const VerifyItem = z.object({
  id: z.string(),
  ref: z.string(),
  threadNodeId: z.string(),
  replyTargetDatabaseId: z.number().int(),
  path: z.string(),
  line: z.number().int(),
  verdict: Verdict,
  rationaleEn: z.string(),
  replyBody: z.string(),
  included: z.boolean().default(true),
  editedBody: z.string().nullable().default(null),
});
export type VerifyItem = z.infer<typeof VerifyItem>;

export const Counts = z.object({
  critical: z.number().int(),
  major: z.number().int(),
  minor: z.number().int(),
  nit: z.number().int(),
});
export type Counts = z.infer<typeof Counts>;

export const Draft = z.object({
  overallEn: z.string(),
  counts: Counts,
  findings: z.array(Finding),
  verify: z.array(VerifyItem),
});
export type Draft = z.infer<typeof Draft>;

/** What Claude must emit. Same as Draft but user-only fields are optional/defaulted. */
export const GeneratedDraft = Draft;

export const FeedbackEntry = z.object({
  at: z.string(),
  text: z.string(),
  producedVersion: z.number().int(),
});
export type FeedbackEntry = z.infer<typeof FeedbackEntry>;

export const PostResult = z.object({
  reviewUrl: z.string().nullable(),
  postedAt: z.string(),
  resolvedThreadIds: z.array(z.string()),
});
export type PostResult = z.infer<typeof PostResult>;

/** The half of a post cycle that has already LANDED on GitHub — keyed by the
 *  GitHub-side id each mutation landed against, never by one of our own ids.
 *
 *  That keying is the entire point of splitting PostProgress in two. A reply is
 *  attached to a comment's `replyTargetDatabaseId`, a resolve to a thread's
 *  `threadNodeId`; those ids belong to the PR, outlive any draft of ours, and
 *  neither mutation can be taken back. Our verify-item `id`s, by contrast, are
 *  minted afresh by every generation — so a re-draft renames the very same GitHub
 *  threads, a ledger keyed by them silently stops matching, and a resumed post
 *  replies a second time to a thread that already carries our reply. Keyed by
 *  GitHub's own ids this half stays true across a re-draft, which is why
 *  orchestrator.runGeneration deliberately carries it into the new cycle. */
export const SentToGitHub = z.object({
  repliedTargets: z.array(z.number().int()),   // replyTargetDatabaseId of every reply posted
  resolvedThreads: z.array(z.string()),        // threadNodeId of every thread resolved
});
export type SentToGitHub = z.infer<typeof SentToGitHub>;

/** The half that belongs to the *current draft*: the GraphQL pending review this
 *  draft's findings are being attached to, and which of them made it in. Keyed by
 *  local finding id — correct precisely because, unlike the sent half above, these
 *  ids are meaningless once the draft is regenerated (the new findings are
 *  different comments, and the review they would attach to is a different review).
 *  So runGeneration resets this half. Persisted after every mutation so a crash
 *  resumes into the same draft review instead of starting a second one (GitHub
 *  allows only one pending review per user per PR). */
export const ReviewInProgress = z.object({
  pendingReviewId: z.string().nullable(),
  threadsAdded: z.array(z.string()),    // finding ids that became threads
  threadsFailed: z.array(z.string()),   // finding ids GitHub rejected → folded into the body
});
export type ReviewInProgress = z.infer<typeof ReviewInProgress>;

/** The executor's idempotency ledger for one post cycle, in two halves that
 *  behave differently across a re-draft — see each. `reviewPosted` ends the
 *  cycle: once the review is submitted the whole ledger is *spent*, and the next
 *  generation starts from a clean one (a later re-review must be free to reply to
 *  the same threads again). */
export const PostProgress = z.object({
  sent: SentToGitHub,
  review: ReviewInProgress,
  reviewPosted: z.boolean(),
  reviewerRequested: z.boolean(),
});
export type PostProgress = z.infer<typeof PostProgress>;

export function emptyPostProgress(): PostProgress {
  return {
    sent: { repliedTargets: [], resolvedThreads: [] },
    review: { pendingReviewId: null, threadsAdded: [], threadsFailed: [] },
    reviewPosted: false, reviewerRequested: false,
  };
}

export const PrRecord = z.object({
  key: z.string(),
  host: z.string(),
  owner: z.string(),
  repo: z.string(),
  number: z.number().int(),
  url: z.string(),
  title: z.string(),
  author: z.string(),
  baseRef: z.string(),
  state: PrState,
  dismissed: z.boolean().optional(),   // view flag: hidden from the queue/tray; does not affect lifecycle state
  mode: Mode,
  headSha: z.string(),
  draftVersion: z.number().int(),
  draft: Draft.nullable(),
  feedbackHistory: z.array(FeedbackEntry),
  postResult: PostResult.nullable(),
  postProgress: PostProgress.nullable(),
  postVerdict: PostVerdict.optional(),   // disposition chosen at approve time; absent → derive from draft
  forceApprove: z.boolean().optional(),   // transient: a give-up approval is in flight (crash-recovery routing)
  error: z.object({ step: z.string(), message: z.string() }).nullable(),
  genActivity: z.array(z.string()).optional(), // live "what CC is doing" feed, present only while GENERATING
  discoveredAt: z.string(),
  generatedAt: z.string().nullable(),
  updatedAt: z.string(),
  doneAt: z.string().nullable(),
});
export type PrRecord = z.infer<typeof PrRecord>;

/** Re-key a postProgress persisted in the pre-split shape, where `repliesPosted`
 *  and `threadsResolved` held *local verify-item ids*, onto the GitHub-side ids
 *  those mutations actually landed against. The record carries the draft those
 *  ids were minted from, so the mapping is normally exact.
 *
 *  When an id cannot be mapped (a draft that no longer holds it) the mutation is
 *  unrecoverable — we know something landed but not on what. So we fail safe and
 *  mark *every* thread in the draft as already sent: skipping a reply the user can
 *  still post by hand is recoverable; posting a second copy into the author's
 *  thread is not. When there is no draft at all to fall back onto (the "every
 *  thread" pool is empty), that same fail-safe would otherwise come back empty —
 *  see reKey's placeholder fallback below for how it stays non-empty instead. */
function migratePostProgress(old: Record<string, unknown>, rawDraft: unknown): unknown {
  const verify = (rawDraft as { verify?: unknown } | null | undefined)?.verify;
  const items = (Array.isArray(verify) ? verify : []) as Record<string, unknown>[];

  function reKey<T>(localIds: unknown, field: "replyTargetDatabaseId" | "threadNodeId", placeholder: T): T[] {
    const ids = Array.isArray(localIds) ? localIds : [];
    if (ids.length === 0) return [];
    const out = new Set<T>();
    let unmappable = false;
    for (const id of ids) {
      const v = items.find((it) => it.id === id);
      if (v && v[field] != null) out.add(v[field] as T);
      else unmappable = true;
    }
    if (unmappable) for (const it of items) if (it[field] != null) out.add(it[field] as T);
    // The fail-safe above assumes a *current* draft to fall back onto. When there is
    // none (draft is null/gone), `items` is empty, so the loop adds nothing and `out`
    // is left empty — silently turning "we know something landed" into "nothing was
    // ever sent", exactly the one direction this function must never take. A
    // placeholder can't collide with a real GitHub id (a record missing its draft
    // never reaches execute() — runPost bails before calling it — so nothing ever
    // compares this value against a live id); it exists purely so this half stays
    // non-empty, which is what hasUnspentLedger and the UI actually key off of.
    if (out.size === 0) out.add(placeholder);
    return [...out];
  }

  return {
    sent: {
      repliedTargets: reKey<number>(old.repliesPosted, "replyTargetDatabaseId", -1),
      resolvedThreads: reKey<string>(old.threadsResolved, "threadNodeId", "unmapped-on-migration"),
    },
    review: {
      pendingReviewId: old.pendingReviewId ?? null,
      threadsAdded: old.threadsAdded ?? [],
      threadsFailed: old.threadsFailed ?? [],
    },
    reviewPosted: old.reviewPosted ?? false,
    reviewerRequested: old.reviewerRequested ?? false,
  };
}

/** Normalize a raw on-disk record before parsing. Two migrations:
 *
 *  - the removed "DISMISSED" pseudo-state → `{ dismissed: true, state: <recovered> }`,
 *    recovering the lifecycle state from the obsolete `dismissedFrom` snapshot when
 *    present, else inferring it the way the old restore() did.
 *  - the pre-split `postProgress` (flat `repliesPosted`/`threadsResolved` keyed by
 *    local verify ids) → the two-half shape keyed by GitHub's ids. This must run
 *    before PrRecord.parse: the new schema has no `repliesPosted` field, so an
 *    un-migrated record would parse with the unknown keys stripped and an *empty*
 *    sent-ledger — exactly the duplicate-reply bug the split exists to prevent. */
export function migrateRecord(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  if (r.state === "DISMISSED") {
    const inferred = r.postResult ? "POSTED_AWAITING_AUTHOR"
      : r.draft ? "NEEDS_REVIEW"
      : r.error ? "ERROR"
      : "GENERATING";
    r.state = (typeof r.dismissedFrom === "string" ? r.dismissedFrom : undefined) ?? inferred;
    r.dismissed = true;
  }
  const p = r.postProgress;
  if (p && typeof p === "object" && !("sent" in p)) {
    r.postProgress = migratePostProgress(p as Record<string, unknown>, r.draft);
  }
  return r;
}

export function prKey(host: string, owner: string, repo: string, number: number): string {
  return `${host}/${owner}/${repo}#${number}`;
}

export function fileKey(host: string, owner: string, repo: string, number: number): string {
  return `${host}__${owner}__${repo}__${number}`;
}

export const QueueSort = z.object({
  key: z.enum(["activity", "repo"]),
  dir: z.enum(["asc", "desc"]),
});
export type QueueSort = z.infer<typeof QueueSort>;
export const DEFAULT_QUEUE_SORT: QueueSort = { key: "activity", dir: "desc" };
