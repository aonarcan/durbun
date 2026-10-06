import type { Feature, LayerInfo, RasterInfo } from '@durbun/core';
import type { HttpClient } from './http.ts';

export interface SourceContext {
  http: HttpClient;
  /** Aborted when the fetch times out or the server shuts down. */
  signal: AbortSignal;
  now: Date;
}

/**
 * One data source. A source fetches, normalises into Dürbün features and hands
 * them to its layer; the scheduler takes care of timing, timeouts, backoff and
 * health reporting.
 */
export interface SourceDefinition {
  id: string;
  name: { tr: string; en: string };
  layer: string;
  /** Public page a person can open to see the same data. */
  homepage: string;
  intervalSec: number;
  timeoutSec?: number;
  /** The source refuses connections from outside Turkey. */
  requiresTurkishIp?: boolean;
  /**
   * Settings the source cannot work without (e.g. a free API key in .env).
   * While any is missing the source stays switched off and the status page shows the hint.
   */
  setup?: { env: string[]; hint: { tr: string; en: string } };
  fetch(ctx: SourceContext): Promise<SourceResult>;
}

/** Features for a feature layer, or tile frames for an image layer (radar). */
export type SourceResult = Feature[] | { raster: RasterInfo };

export function isRasterResult(r: SourceResult): r is { raster: RasterInfo } {
  return !Array.isArray(r);
}

/**
 * A layer as declared in code; its source list is filled in from the sources.
 * With `merge`, features from several sources that share an id (the same
 * aircraft seen by two networks) are combined into one.
 */
export type LayerDefinition = Omit<LayerInfo, 'sources'> & { merge?: (a: Feature, b: Feature) => Feature };
