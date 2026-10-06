import { distanceKm, type Feature } from '@durbun/core';

/** [lng, lat, time (ms), altitude (m) or null]. */
export type TrackPoint = [number, number, number, number | null];

interface Track {
  layer: string;
  points: TrackPoint[];
}

/** At most this many points per track; older ones are dropped first. */
const MAX_POINTS = 400;
/** A position this close to the last one is skipped unless this much time has passed. */
const MIN_MOVE_KM = 0.05;
const MIN_GAP_MS = 5 * 60_000;

/**
 * Where moving things (aircraft, ships) have been. Each layer update adds the
 * new positions; tracks older than the layer's keep time are forgotten.
 */
export class TrackStore {
  private readonly tracks = new Map<string, Track>();

  /** Layer id → how long to keep positions, in ms. */
  constructor(private readonly keepMs: Map<string, number>) {}

  record(layer: string, features: Feature[], now: number): void {
    const keep = this.keepMs.get(layer);
    if (!keep) return;
    for (const f of features) {
      if (f.geometry?.type !== 'Point') continue;
      const [lng, lat] = f.geometry.coordinates;
      const t = f.properties.observedAt ? Date.parse(f.properties.observedAt) : now;
      const altRaw = f.properties.style?.altM;
      const alt = typeof altRaw === 'number' ? altRaw : null;
      let track = this.tracks.get(f.properties.id);
      if (!track) {
        track = { layer, points: [] };
        this.tracks.set(f.properties.id, track);
      }
      const last = track.points[track.points.length - 1];
      if (last) {
        if (t <= last[2]) continue; // not newer than what we have
        const moved = distanceKm([last[0], last[1]], [lng, lat]);
        if (moved < MIN_MOVE_KM && t - last[2] < MIN_GAP_MS) continue;
      }
      track.points.push([lng, lat, t, alt]);
      if (track.points.length > MAX_POINTS) track.points.splice(0, track.points.length - MAX_POINTS);
    }
    // Forget old positions, and tracks with nothing left.
    for (const [id, track] of this.tracks) {
      if (track.layer !== layer) continue;
      const cutoff = now - keep;
      let drop = 0;
      while (drop < track.points.length && track.points[drop]![2] < cutoff) drop++;
      if (drop) track.points.splice(0, drop);
      if (track.points.length === 0) this.tracks.delete(id);
    }
  }

  /** Every remembered position of one feature, oldest first. */
  track(id: string): TrackPoint[] | undefined {
    return this.tracks.get(id)?.points;
  }

  /**
   * Short trails for a whole layer: one line per feature that moved in the
   * last `minutes`, ending at its latest known position.
   */
  tails(layer: string, minutes: number, now: number): Feature[] {
    const since = now - minutes * 60_000;
    const out: Feature[] = [];
    for (const [id, track] of this.tracks) {
      if (track.layer !== layer) continue;
      const recent = track.points.filter((p) => p[2] >= since);
      if (recent.length < 2) continue;
      out.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: recent.map((p) => (p[3] === null ? [p[0], p[1]] : [p[0], p[1], p[3]])) },
        properties: { id, layer, source: 'tracks', title: id },
      });
    }
    return out;
  }
}
