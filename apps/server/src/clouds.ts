import { PNG } from 'pngjs';
import type { HttpClient } from './kit/http.ts';

/**
 * Cloud tiles from EUMETSAT's Meteosat infrared image (EUMETView WMS,
 * updated every 15 minutes). The infrared picture is grey everywhere, so it
 * would hide the map; this turns cold (bright) cloud tops into white with
 * matching transparency and makes the warm ground clear.
 */

const WMS = 'https://view.eumetsat.int/geoserver/wms';
const HALF_WORLD = 20037508.342789244;

/** Web Mercator bounds of a z/x/y tile: [minX, minY, maxX, maxY]. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * HALF_WORLD) / 2 ** z;
  const minX = -HALF_WORLD + x * size;
  const maxY = HALF_WORLD - y * size;
  return [minX, maxY - size, minX + size, maxY];
}

export function wmsUrl(z: number, x: number, y: number): string {
  const bbox = tileBounds(z, x, y).map((n) => n.toFixed(2)).join(',');
  return (
    `${WMS}?service=WMS&request=GetMap&version=1.3.0&layers=msg_fes:ir108&styles=` +
    `&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox=${bbox}`
  );
}

/** Brightness at or below `clear` becomes transparent; at or above `solid` nearly opaque white. */
export function infraredToClouds(input: Buffer, clear = 105, solid = 185): Buffer {
  const src = PNG.sync.read(input);
  const out = new PNG({ width: src.width, height: src.height });
  for (let i = 0; i < src.data.length; i += 4) {
    const grey = src.data[i]!;
    const srcAlpha = src.data[i + 3]!;
    const t = Math.min(1, Math.max(0, (grey - clear) / (solid - clear)));
    out.data[i] = 255;
    out.data[i + 1] = 255;
    out.data[i + 2] = 255;
    out.data[i + 3] = Math.round(t * 235 * (srcAlpha / 255));
  }
  return PNG.sync.write(out);
}

interface Cached {
  at: number;
  png: Buffer;
}

/** Fetches, converts and caches cloud tiles for 10 minutes. */
export function createCloudTiles(http: HttpClient, now = Date.now) {
  const cache = new Map<string, Cached>();
  return async function cloudTile(z: number, x: number, y: number): Promise<Buffer> {
    const key = `${z}/${x}/${y}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < 10 * 60_000) return hit.png;
    const raw = await http.getBuffer(wmsUrl(z, x, y), { signal: AbortSignal.timeout(20_000) });
    const png = infraredToClouds(raw);
    cache.set(key, { at: now(), png });
    if (cache.size > 600) cache.delete(cache.keys().next().value!);
    return png;
  };
}
