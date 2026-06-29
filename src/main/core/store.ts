import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrRecord, fileKey } from "./schema";

function parseKey(key: string): { host: string; owner: string; repo: string; number: number } {
  const m = key.match(/^([^/]+)\/([^/]+)\/([^/]+)#(\d+)$/);
  if (!m) throw new Error(`bad key: ${key}`);
  return { host: m[1], owner: m[2], repo: m[3], number: Number(m[4]) };
}

export class Store {
  private prsDir: string;
  private snapsDir: string;
  private locks = new Map<string, Promise<unknown>>();

  constructor(private dataDir: string) {
    this.prsDir = join(dataDir, "prs");
    this.snapsDir = join(dataDir, "snapshots");
    mkdirSync(this.prsDir, { recursive: true });
    mkdirSync(this.snapsDir, { recursive: true });
    mkdirSync(join(dataDir, "logs"), { recursive: true });
  }

  private fileFor(key: string): string {
    const { host, owner, repo, number } = parseKey(key);
    return join(this.prsDir, `${fileKey(host, owner, repo, number)}.json`);
  }

  get(key: string): PrRecord | null {
    const f = this.fileFor(key);
    if (!existsSync(f)) return null;
    return PrRecord.parse(JSON.parse(readFileSync(f, "utf8")));
  }

  put(rec: PrRecord): void {
    const f = this.fileFor(rec.key);
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify(rec, null, 2));
    renameSync(tmp, f);
    this.writeIndex();
  }

  list(): PrRecord[] {
    return readdirSync(this.prsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => PrRecord.parse(JSON.parse(readFileSync(join(this.prsDir, f), "utf8"))));
  }

  private writeIndex(): void {
    const idx = this.list().map((r) => ({
      key: r.key, number: r.number, repo: r.repo, title: r.title,
      state: r.state, mode: r.mode, counts: r.draft?.counts ?? null,
      updatedAt: r.updatedAt,
    }));
    const f = join(this.dataDir, "index.json");
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify(idx, null, 2));
    renameSync(tmp, f);
  }

  snapshot(rec: PrRecord): void {
    const { host, owner, repo, number } = parseKey(rec.key);
    const f = join(this.snapsDir, `${fileKey(host, owner, repo, number)}.v${rec.draftVersion}.json`);
    const tmp = `${f}.tmp`;
    writeFileSync(tmp, JSON.stringify(rec.draft, null, 2));
    renameSync(tmp, f);
  }

  prune(retentionDays: number, nowIso: string): string[] {
    const cutoff = new Date(nowIso).getTime() - retentionDays * 86400_000;
    const terminal = new Set(["DONE", "DISMISSED", "POSTED_AWAITING_AUTHOR", "ERROR"]);
    const pruned: string[] = [];
    for (const r of this.list()) {
      if (!terminal.has(r.state)) continue;
      const stamp = new Date(r.doneAt ?? r.updatedAt).getTime();
      if (stamp < cutoff) {
        rmSync(this.fileFor(r.key));
        pruned.push(r.key);
      }
    }
    if (pruned.length) this.writeIndex();
    return pruned;
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => next);
    this.locks.set(key, chained);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }
}
