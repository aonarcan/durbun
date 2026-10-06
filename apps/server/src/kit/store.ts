import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  computeStatus,
  type Feature,
  type FeatureCollection,
  type LayerInfo,
  type LayerSummary,
  type RasterInfo,
  type ServerEvent,
  type SourceHealth,
} from '@durbun/core';
import { isRasterResult, type LayerDefinition, type SourceDefinition, type SourceResult } from './source.ts';

interface LayerState {
  info: LayerInfo;
  bySource: Map<string, Feature[]>;
  version: number;
  hash: string;
  updatedAt?: Date;
}

interface HealthState {
  def: SourceDefinition;
  disabled: boolean;
  attempted: boolean;
  lastAttemptAt?: Date;
  lastSuccessAt?: Date;
  lastDurationMs?: number;
  itemCount: number;
  newestItemAt?: string;
  consecutiveFailures: number;
  lastError?: string;
  nextRunAt?: Date;
}

/**
 * Latest state of every layer and source, kept in memory. Emits a ServerEvent
 * on "event" whenever a layer's data or a source's health changes.
 */
export class Store extends EventEmitter<{ event: [ServerEvent] }> {
  private readonly layers = new Map<string, LayerState>();
  private readonly health = new Map<string, HealthState>();
  private readonly now: () => number;

  constructor(layers: LayerDefinition[], sources: SourceDefinition[], disabled: Set<string>, now = Date.now) {
    super();
    this.now = now;
    for (const l of layers) {
      const sourceIds = sources.filter((s) => s.layer === l.id).map((s) => s.id);
      this.layers.set(l.id, { info: { ...l, sources: sourceIds }, bySource: new Map(), version: 0, hash: '' });
    }
    for (const s of sources) {
      if (!this.layers.has(s.layer)) throw new Error(`Source ${s.id} points at unknown layer ${s.layer}`);
      this.health.set(s.id, { def: s, disabled: disabled.has(s.id), attempted: false, itemCount: 0, consecutiveFailures: 0 });
    }
  }

  // ---- layers ----

  setSourceFeatures(sourceId: string, features: Feature[]): void {
    const h = this.mustHealth(sourceId);
    const layer = this.layers.get(h.def.layer)!;
    layer.bySource.set(sourceId, features);
    const all = [...layer.bySource.values()].flat();
    const hash = createHash('sha1').update(JSON.stringify(all)).digest('hex');
    layer.updatedAt = new Date(this.now());
    if (hash === layer.hash) return;
    layer.hash = hash;
    layer.version += 1;
    this.emit('event', {
      type: 'layer',
      layer: layer.info.id,
      version: layer.version,
      count: all.length,
      updatedAt: layer.updatedAt.toISOString(),
    });
  }

  /** New tile frames for an image layer (e.g. the latest radar times). */
  setSourceRaster(sourceId: string, raster: RasterInfo): void {
    const h = this.mustHealth(sourceId);
    const layer = this.layers.get(h.def.layer)!;
    const hash = createHash('sha1').update(JSON.stringify(raster)).digest('hex');
    layer.updatedAt = new Date(this.now());
    if (hash === layer.hash) return;
    layer.hash = hash;
    layer.info = { ...layer.info, raster };
    layer.version += 1;
    this.emit('event', {
      type: 'layer',
      layer: layer.info.id,
      version: layer.version,
      count: raster.frames.length,
      updatedAt: layer.updatedAt.toISOString(),
      raster,
    });
  }

  getCollection(layerId: string): FeatureCollection | undefined {
    const layer = this.layers.get(layerId);
    if (!layer) return undefined;
    return { type: 'FeatureCollection', features: [...layer.bySource.values()].flat() };
  }

  layerSummaries(): LayerSummary[] {
    return [...this.layers.values()].map((l) => ({
      ...l.info,
      version: l.version,
      count: l.info.raster ? l.info.raster.frames.length : [...l.bySource.values()].reduce((n, f) => n + f.length, 0),
      ...(l.updatedAt ? { updatedAt: l.updatedAt.toISOString() } : {}),
    }));
  }

  // ---- health ----

  isDisabled(sourceId: string): boolean {
    return this.mustHealth(sourceId).disabled;
  }

  recordAttempt(sourceId: string): void {
    const h = this.mustHealth(sourceId);
    h.attempted = true;
    h.lastAttemptAt = new Date(this.now());
  }

  recordSuccess(sourceId: string, result: SourceResult, durationMs: number): void {
    const h = this.mustHealth(sourceId);
    h.lastSuccessAt = new Date(this.now());
    h.lastDurationMs = durationMs;
    h.consecutiveFailures = 0;
    delete h.lastError;
    const times = isRasterResult(result)
      ? result.raster.frames.map((f) => f.time)
      : result.map((f) => f.properties.observedAt);
    h.itemCount = times.length;
    const newest = times.reduce<string | undefined>((max, t) => (t && (!max || t > max) ? t : max), undefined);
    if (newest) h.newestItemAt = newest;
    else delete h.newestItemAt;
    if (isRasterResult(result)) this.setSourceRaster(sourceId, result.raster);
    else this.setSourceFeatures(sourceId, result);
    this.emitHealth(sourceId);
  }

  recordFailure(sourceId: string, error: string, durationMs: number): void {
    const h = this.mustHealth(sourceId);
    h.consecutiveFailures += 1;
    h.lastError = error;
    h.lastDurationMs = durationMs;
    this.emitHealth(sourceId);
  }

  setNextRun(sourceId: string, at: Date): void {
    this.mustHealth(sourceId).nextRunAt = at;
  }

  sourceHealth(sourceId: string): SourceHealth {
    const h = this.mustHealth(sourceId);
    const d = h.def;
    return {
      id: d.id,
      name: d.name,
      layer: d.layer,
      homepage: d.homepage,
      intervalSec: d.intervalSec,
      requiresTurkishIp: Boolean(d.requiresTurkishIp),
      status: computeStatus(
        {
          attempted: h.attempted,
          consecutiveFailures: h.consecutiveFailures,
          intervalSec: d.intervalSec,
          disabled: h.disabled,
          ...(h.lastSuccessAt ? { lastSuccessAt: h.lastSuccessAt.getTime() } : {}),
        },
        this.now(),
      ),
      itemCount: h.itemCount,
      consecutiveFailures: h.consecutiveFailures,
      ...(h.lastAttemptAt ? { lastAttemptAt: h.lastAttemptAt.toISOString() } : {}),
      ...(h.lastSuccessAt ? { lastSuccessAt: h.lastSuccessAt.toISOString() } : {}),
      ...(h.lastDurationMs !== undefined ? { lastDurationMs: h.lastDurationMs } : {}),
      ...(h.newestItemAt ? { newestItemAt: h.newestItemAt } : {}),
      ...(h.lastError ? { lastError: h.lastError } : {}),
      ...(h.nextRunAt ? { nextRunAt: h.nextRunAt.toISOString() } : {}),
    };
  }

  allHealth(): SourceHealth[] {
    return [...this.health.keys()].map((id) => this.sourceHealth(id));
  }

  private emitHealth(sourceId: string): void {
    this.emit('event', { type: 'health', source: this.sourceHealth(sourceId) });
  }

  private mustHealth(sourceId: string): HealthState {
    const h = this.health.get(sourceId);
    if (!h) throw new Error(`Unknown source ${sourceId}`);
    return h;
  }
}
