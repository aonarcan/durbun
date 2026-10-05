/**
 * Source health, as shown on the source status page. Every collector reports
 * here; a source only counts as done when it shows up on that page.
 */

export type SourceStatus = 'pending' | 'ok' | 'degraded' | 'failing' | 'disabled';

export interface SourceHealth {
  id: string;
  name: { tr: string; en: string };
  layer: string;
  /** Public page a person can open to see the source. */
  homepage: string;
  intervalSec: number;
  /** Source only answers connections from Turkish IP addresses. */
  requiresTurkishIp: boolean;
  status: SourceStatus;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  /** Time the last successful fetch took, in milliseconds. */
  lastDurationMs?: number;
  /** Items delivered by the last successful fetch. */
  itemCount: number;
  /** Newest observation time among those items, to judge how fresh the data is. */
  newestItemAt?: string;
  consecutiveFailures: number;
  lastError?: string;
  nextRunAt?: string;
}

export interface HealthInputs {
  lastSuccessAt?: number;
  consecutiveFailures: number;
  intervalSec: number;
  disabled?: boolean;
  attempted: boolean;
}

/**
 * Status rules:
 * - disabled: switched off in config.
 * - pending: nothing tried yet.
 * - ok: the last attempt worked.
 * - degraded: recent attempts failed, but data from within 3 intervals is still on the map.
 * - failing: failing and no recent data.
 */
export function computeStatus(h: HealthInputs, now: number): SourceStatus {
  if (h.disabled) return 'disabled';
  if (!h.attempted) return 'pending';
  if (h.consecutiveFailures === 0) return h.lastSuccessAt === undefined ? 'pending' : 'ok';
  if (h.lastSuccessAt !== undefined && now - h.lastSuccessAt <= 3 * h.intervalSec * 1000) return 'degraded';
  return 'failing';
}
