import type { SourceHealth } from './health.ts';

/** Messages pushed to browsers over Server-Sent Events at /api/events. */
export type ServerEvent =
  | { type: 'layer'; layer: string; version: number; count: number; updatedAt: string }
  | { type: 'health'; source: SourceHealth };
