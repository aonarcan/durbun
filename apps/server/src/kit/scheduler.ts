import type { HttpClient } from './http.ts';
import type { SourceDefinition } from './source.ts';
import type { Store } from './store.ts';

const DEFAULT_TIMEOUT_SEC = 30;
const MAX_BACKOFF_SEC = 30 * 60;

export interface SchedulerOptions {
  log?: (line: string) => void;
  random?: () => number;
  /** Spread first runs over this many seconds so sources don't all fire at once. */
  startSpreadSec?: number;
}

/**
 * Seconds until the next run. Success: the source's interval with ±5% jitter.
 * Failure n (1-based): interval × 2^(n−1), capped at 30 minutes (or the
 * interval, if that is longer), with ±10% jitter.
 */
export function nextDelaySec(intervalSec: number, consecutiveFailures: number, random: () => number = Math.random): number {
  if (consecutiveFailures <= 0) return intervalSec * (0.95 + random() * 0.1);
  const cap = Math.max(intervalSec, MAX_BACKOFF_SEC);
  const backoff = Math.min(intervalSec * 2 ** (consecutiveFailures - 1), cap);
  return backoff * (0.9 + random() * 0.2);
}

export class Scheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Map<string, AbortController>();
  private stopped = false;
  private readonly log: (line: string) => void;
  private readonly random: () => number;
  private readonly sources: SourceDefinition[];
  private readonly store: Store;
  private readonly http: HttpClient;
  private readonly opts: SchedulerOptions;

  constructor(sources: SourceDefinition[], store: Store, http: HttpClient, opts: SchedulerOptions = {}) {
    this.sources = sources;
    this.store = store;
    this.http = http;
    this.opts = opts;
    this.log = opts.log ?? ((line) => console.log(line));
    this.random = opts.random ?? Math.random;
  }

  start(): void {
    const spread = this.opts.startSpreadSec ?? 5;
    for (const s of this.sources) {
      if (this.store.isDisabled(s.id)) {
        this.log(`[${s.id}] disabled`);
        continue;
      }
      this.schedule(s, this.random() * spread);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    for (const c of this.running.values()) c.abort();
    this.timers.clear();
  }

  /** Runs one fetch for a source and records the outcome. Never throws. */
  async runOnce(source: SourceDefinition): Promise<boolean> {
    const controller = new AbortController();
    this.running.set(source.id, controller);
    const timeout = AbortSignal.timeout((source.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000);
    const signal = AbortSignal.any([controller.signal, timeout]);
    const started = performance.now();
    this.store.recordAttempt(source.id);
    try {
      const result = await source.fetch({ http: this.http, signal, now: new Date() });
      const ms = Math.round(performance.now() - started);
      this.store.recordSuccess(source.id, result, ms);
      const count = Array.isArray(result) ? `${result.length} items` : `${result.raster.frames.length} frames`;
      this.log(`[${source.id}] ok: ${count} in ${ms} ms`);
      return true;
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      const message = timeout.aborted ? 'Timed out' : err instanceof Error ? err.message : String(err);
      this.store.recordFailure(source.id, message, ms);
      this.log(`[${source.id}] failed after ${ms} ms: ${message}`);
      return false;
    } finally {
      this.running.delete(source.id);
    }
  }

  private schedule(source: SourceDefinition, delaySec: number): void {
    if (this.stopped) return;
    this.store.setNextRun(source.id, new Date(Date.now() + delaySec * 1000));
    const timer = setTimeout(async () => {
      await this.runOnce(source);
      const failures = this.store.sourceHealth(source.id).consecutiveFailures;
      this.schedule(source, nextDelaySec(source.intervalSec, failures, this.random));
    }, delaySec * 1000);
    timer.unref?.();
    this.timers.set(source.id, timer);
  }
}
