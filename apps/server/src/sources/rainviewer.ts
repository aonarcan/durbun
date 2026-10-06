import type { RasterInfo } from '@durbun/core';
import type { SourceDefinition } from '../kit/source.ts';

/** RainViewer's list of radar frames (api.rainviewer.com/public/weather-maps.json). */
export interface RainViewerMaps {
  host: string;
  radar: { past?: { time: number; path: string }[]; nowcast?: { time: number; path: string }[] };
}

/** Radar frames for the last two hours, as tile URL templates (colour scheme 2, smoothed, snow shown). */
export function parseRainViewer(maps: RainViewerMaps): RasterInfo {
  const frames = [...(maps.radar.past ?? []), ...(maps.radar.nowcast ?? [])].map((f) => ({
    time: new Date(f.time * 1000).toISOString(),
    url: `${maps.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
  }));
  if (frames.length === 0) throw new Error('RainViewer listed no radar frames');
  // RainViewer's free tiles stop at zoom 7; the map stretches them beyond.
  return { frames, tileSize: 256, maxzoom: 7, opacity: 0.75 };
}

export const rainViewerRadar: SourceDefinition = {
  id: 'rainviewer-radar',
  name: { tr: 'RainViewer yağış radarı', en: 'RainViewer rain radar' },
  layer: 'radar',
  homepage: 'https://www.rainviewer.com/map.html',
  intervalSec: 5 * 60,
  async fetch({ http, signal }) {
    const maps = await http.getJson<RainViewerMaps>('https://api.rainviewer.com/public/weather-maps.json', { signal });
    return { raster: parseRainViewer(maps) };
  },
};
