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

export const PrState = z.enum([
  "DISCOVERED", "GENERATING", "NEEDS_REVIEW", "POSTING",
  "POSTED_AWAITING_AUTHOR", "DONE", "STALE", "ERROR", "DISMISSED",
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

export const PostProgress = z.object({
  repliesPosted: z.array(z.string()),       // verify item ids
  threadsResolved: z.array(z.string()),     // verify item ids
  reviewPosted: z.boolean(),
  reviewerRequested: z.boolean(),
});
export type PostProgress = z.infer<typeof PostProgress>;

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
  mode: Mode,
  headSha: z.string(),
  draftVersion: z.number().int(),
  draft: Draft.nullable(),
  feedbackHistory: z.array(FeedbackEntry),
  postResult: PostResult.nullable(),
  postProgress: PostProgress.nullable(),
  error: z.object({ step: z.string(), message: z.string() }).nullable(),
  genActivity: z.array(z.string()).optional(), // live "what CC is doing" feed, present only while GENERATING
  discoveredAt: z.string(),
  generatedAt: z.string().nullable(),
  updatedAt: z.string(),
  doneAt: z.string().nullable(),
});
export type PrRecord = z.infer<typeof PrRecord>;

export function prKey(host: string, owner: string, repo: string, number: number): string {
  return `${host}/${owner}/${repo}#${number}`;
}

export function fileKey(host: string, owner: string, repo: string, number: number): string {
  return `${host}__${owner}__${repo}__${number}`;
}
