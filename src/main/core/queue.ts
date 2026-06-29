interface Job { id: string; fn: () => Promise<void>; }

export class JobQueue {
  private queued: Job[] = [];
  private running = new Set<string>();
  private ids = new Set<string>();
  private idleResolvers: (() => void)[] = [];

  constructor(private concurrency: number) {}

  has(id: string): boolean {
    return this.ids.has(id);
  }

  get size(): number {
    return this.queued.length + this.running.size;
  }

  submit(id: string, fn: () => Promise<void>): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.queued.push({ id, fn });
    this.pump();
  }

  onIdle(): Promise<void> {
    if (this.size === 0) return Promise.resolve();
    return new Promise((r) => this.idleResolvers.push(r));
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.queued.length > 0) {
      const job = this.queued.shift()!;
      this.running.add(job.id);
      job.fn()
        .catch((e) => console.error(`[queue] job ${job.id} failed:`, e))
        .finally(() => {
          this.running.delete(job.id);
          this.ids.delete(job.id);
          this.pump();
          if (this.size === 0) {
            this.idleResolvers.splice(0).forEach((r) => r());
          }
        });
    }
  }
}
