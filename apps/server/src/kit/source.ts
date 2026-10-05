import type { Feature, LayerInfo } from '@durbun/core';
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
  fetch(ctx: SourceContext): Promise<Feature[]>;
}

/** A layer as declared in code; its source list is filled in from the sources. */
export type LayerDefinition = Omit<LayerInfo, 'sources'>;
