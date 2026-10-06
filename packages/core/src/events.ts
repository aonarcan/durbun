import type { SourceHealth } from './health.ts';
import type { RasterInfo } from './layers.ts';

/** Messages pushed to browsers over Server-Sent Events at /api/events. */
export type ServerEvent =
  | { type: 'layer'; layer: string; version: number; count: number; updatedAt: string; raster?: RasterInfo }
  | { type: 'health'; source: SourceHealth };
