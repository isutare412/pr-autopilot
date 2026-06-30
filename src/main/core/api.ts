import { Store } from "./store";
import { PrRecord } from "./schema";

export interface ApiDeps {
  store: Store;
  nowIso: () => string;
  enqueueGen: (key: string, feedback?: string) => void;
  enqueuePost: (key: string) => void;
}

type Err = { error: string };
const NF: Err = { error: "not found" };

function findItem(rec: PrRecord, ref: string) {
  return rec.draft?.findings.find((f) => f.ref === ref) ?? rec.draft?.verify.find((v) => v.ref === ref);
}

export const api = {
  list(deps: ApiDeps) {
    const items = deps.store.list().map((r) => ({
      key: r.key, number: r.number, repo: r.repo, title: r.title, state: r.state,
      mode: r.mode, counts: r.draft?.counts ?? null, updatedAt: r.updatedAt,
    }));
    return { items };
  },

  get(deps: ApiDeps, key: string): PrRecord | Err {
    return deps.store.get(key) ?? NF;
  },

  toggleItem(deps: ApiDeps, key: string, ref: string, included: boolean): PrRecord | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
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
    if (rec.draft) deps.store.snapshot(rec);
    rec.feedbackHistory.push({ at: deps.nowIso(), text, producedVersion: rec.draftVersion + 1 });
    rec.state = "GENERATING";
    rec.updatedAt = deps.nowIso();
    deps.store.put(rec);
    deps.enqueueGen(key, text);
    return { ok: true };
  },

  approve(deps: ApiDeps, key: string): { ok: true } | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
    rec.state = "POSTING";
    rec.updatedAt = deps.nowIso();
    deps.store.put(rec);
    deps.enqueuePost(key);
    return { ok: true };
  },

  dismiss(deps: ApiDeps, key: string): PrRecord | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
    rec.state = "DISMISSED";
    const now = deps.nowIso();
    rec.updatedAt = now;
    rec.doneAt = now;
    deps.store.put(rec);
    return rec;
  },

  restore(deps: ApiDeps, key: string): PrRecord | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
    const regenerate = !rec.postResult && !rec.draft && !rec.error;
    rec.state = rec.postResult
      ? "POSTED_AWAITING_AUTHOR"
      : rec.draft
        ? "NEEDS_REVIEW"
        : rec.error
          ? "ERROR"
          : "GENERATING";
    rec.doneAt = null;
    rec.updatedAt = deps.nowIso();
    deps.store.put(rec);
    if (regenerate) deps.enqueueGen(key);
    return rec;
  },

  delete(deps: ApiDeps, key: string): { ok: true } | Err {
    const rec = deps.store.get(key);
    if (!rec) return NF;
    deps.store.delete(key);
    return { ok: true };
  },
};
