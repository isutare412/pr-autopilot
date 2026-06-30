// ---- Types mirrored from the API (kept local so the UI bundle has no server imports) ----

export interface UiFinding {
  ref: string;
  path: string;
  line: number;
  priority: string;
  body: string;
  editedBody: string | null;
  included: boolean;
  anchorable: boolean;
}

export interface UiVerify {
  ref: string;
  verdict: string;
  included: boolean;
  path?: string;
  line?: number;
  rationaleEn?: string;
  replyBody?: string;
  editedBody?: string | null;
}

export interface UiDraft {
  overallEn: string;
  counts: { critical: number; major: number; minor: number; nit: number };
  findings: UiFinding[];
  verify: UiVerify[];
}

export interface UiRow {
  key: string;
  number: number;
  repo: string;
  title: string;
  state: string;
  mode: string;
  counts: UiDraft["counts"] | null;
  updatedAt: string;
}

export interface UiRecord {
  key: string;
  host: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  author: string;
  baseRef: string;
  state: string;
  mode: string;
  headSha: string;
  draftVersion: number;
  draft: UiDraft | null;
  feedbackHistory: Array<{ at: string; text: string; producedVersion: number }>;
  postResult: { reviewUrl: string | null; postedAt: string; resolvedThreadIds: string[] } | null;
  postProgress: { repliesPosted: string[]; threadsResolved: string[]; reviewPosted: boolean; reviewerRequested: boolean } | null;
  postVerdict?: "approve" | "comment";
  error: { step: string; message: string } | null;
  genActivity?: string[];
  discoveredAt: string;
  generatedAt: string | null;
  updatedAt: string;
  doneAt: string | null;
}
