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
import { TrackStore, type TrackPoint } from './tracks.ts';

interface LayerState {
  info: LayerInfo;
  bySource: Map<string, Feature[]>;
  /** All sources' features together (merged by id where the layer asks for it). */
  combined: Feature[];
  merge?: (a: Feature, b: Feature) => Feature;
  version: number;
  hash: string;
  updatedAt?: Date;
}

interface HealthState {
  def: SourceDefinition;
  disabled: boolean;
  /** Set when the source is off because a setting it needs is missing. */
  setupHint?: { tr: string; en: string };
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
  private readonly tracks: TrackStore;

  constructor(
    layers: LayerDefinition[],
    sources: SourceDefinition[],
    disabled: Set<string>,
    now = Date.now,
    env: Record<string, string | undefined> = process.env,
  ) {
    super();
    this.now = now;
    this.tracks = new TrackStore(
      new Map(layers.filter((l) => l.tracks).map((l) => [l.id, l.tracks!.keepMinutes * 60_000])),
    );
    for (const { merge, ...l } of layers) {
      const sourceIds = sources.filter((s) => s.layer === l.id).map((s) => s.id);
      this.layers.set(l.id, {
        info: { ...l, sources: sourceIds },
        bySource: new Map(),
        combined: [],
        ...(merge ? { merge } : {}),
        version: 0,
        hash: '',
      });
    }
    for (const s of sources) {
      if (!this.layers.has(s.layer)) throw new Error(`Source ${s.id} points at unknown layer ${s.layer}`);
      const needsSetup = s.setup?.env.some((name) => !env[name]);
      this.health.set(s.id, {
        def: s,
        disabled: disabled.has(s.id) || Boolean(needsSetup),
        ...(needsSetup && s.setup ? { setupHint: s.setup.hint } : {}),
        attempted: false,
        itemCount: 0,
        consecutiveFailures: 0,
      });
    }
  }

  private combine(layer: LayerState): Feature[] {
    const all = [...layer.bySource.values()].flat();
    if (!layer.merge) return all;
    const byId = new Map<string, Feature>();
    for (const f of all) {
      const seen = byId.get(f.properties.id);
      byId.set(f.properties.id, seen ? layer.merge(seen, f) : f);
    }
    return [...byId.values()];
  }

  // ---- layers ----

  setSourceFeatures(sourceId: string, features: Feature[]): void {
    const h = this.mustHealth(sourceId);
    const layer = this.layers.get(h.def.layer)!;
    layer.bySource.set(sourceId, features);
    const all = this.combine(layer);
    layer.combined = all;
    this.tracks.record(layer.info.id, all, this.now());
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
    return { type: 'FeatureCollection', features: layer.combined };
  }

  /** Where one aircraft or ship has been. */
  track(featureId: string): TrackPoint[] | undefined {
    return this.tracks.track(featureId);
  }

  /** Short trails behind every moving item of a layer. */
  tails(layerId: string): FeatureCollection | undefined {
    const layer = this.layers.get(layerId);
    if (!layer?.info.tracks) return undefined;
    return { type: 'FeatureCollection', features: this.tracks.tails(layerId, layer.info.tracks.tailMinutes, this.now()) };
  }

  layerSummaries(): LayerSummary[] {
    return [...this.layers.values()].map((l) => ({
      ...l.info,
      version: l.version,
      count: l.info.raster ? l.info.raster.frames.length : l.combined.length,
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
      ...(h.setupHint ? { setupHint: h.setupHint } : {}),
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
