/**
 * Remembers answers by key for a while, shares one request between callers
 * asking at the same time, and remembers failures briefly so a broken source
 * isn't asked again on every click.
 */
export class Memo<T> {
  private readonly entries = new Map<string, { at: number; value?: T; error?: unknown; pending?: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly failTtlMs = Math.min(ttlMs, 60_000),
    private readonly maxEntries = 2000,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = this.now();
    const hit = this.entries.get(key);
    if (hit?.pending) return hit.pending;
    if (hit && 'value' in hit && now - hit.at < this.ttlMs) return Promise.resolve(hit.value as T);
    if (hit?.error !== undefined && now - hit.at < this.failTtlMs) return Promise.reject(hit.error);
    if (this.entries.size >= this.maxEntries) {
      for (const [k, e] of this.entries) if (!e.pending && now - e.at > this.ttlMs) this.entries.delete(k);
    }
    const pending = load().then(
      (value) => {
        this.entries.set(key, { at: this.now(), value });
        return value;
      },
      (error: unknown) => {
        this.entries.set(key, { at: this.now(), error });
        throw error;
      },
    );
    this.entries.set(key, { at: hit?.at ?? 0, pending });
    return pending;
  }
}
