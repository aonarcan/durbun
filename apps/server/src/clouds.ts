import { PNG } from 'pngjs';
import type { HttpClient } from './kit/http.ts';

/**
 * Cloud tiles from EUMETSAT's Meteosat infrared image (EUMETView WMS,
 * updated every 15 minutes). The infrared picture is grey everywhere, so it
 * would hide the map; this turns cold (bright) cloud tops into white with
 * matching transparency and makes the warm ground clear.
 *
 * EUMETView answers slowly (seconds per request) whatever the image size, so
 * for the area around Türkiye one large picture per zoom level is fetched and
 * cut into tiles. Tiles elsewhere are fetched one by one.
 */

// The layer's own WMS endpoint. (The shared /geoserver/wms endpoint was serving
// an outdated, patchy copy of this layer in October 2026.)
const WMS = 'https://view.eumetsat.int/geoserver/msg_fes/ir108/ows';
const HALF_WORLD = 20037508.342789244;
const TILE = 256;
const FRESH_MS = 10 * 60_000;
/** Old pictures are still shown for this long if EUMETView is down. */
const STALE_MS = 2 * 3600_000;

/** Türkiye and its neighbours: west, south, east, north. */
export const MOSAIC_AREA = { west: 15, south: 30, east: 55, north: 50 } as const;
const MOSAIC_ZOOMS = new Set([3, 4, 5, 6]);

/** Web Mercator bounds of a z/x/y tile: [minX, minY, maxX, maxY]. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * HALF_WORLD) / 2 ** z;
  const minX = -HALF_WORLD + x * size;
  const maxY = HALF_WORLD - y * size;
  return [minX, maxY - size, minX + size, maxY];
}

function wms(bbox: [number, number, number, number], width: number, height: number): string {
  return (
    `${WMS}?service=WMS&request=GetMap&version=1.3.0&layers=ir108&styles=` +
    `&format=image/png&transparent=true&crs=EPSG:3857&width=${width}&height=${height}` +
    `&bbox=${bbox.map((n) => n.toFixed(2)).join(',')}`
  );
}

export function wmsUrl(z: number, x: number, y: number): string {
  return wms(tileBounds(z, x, y), TILE, TILE);
}

/** Tile column and row containing a point. */
export function tileOf(z: number, lng: number, lat: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, y];
}

/** The block of tiles covering MOSAIC_AREA at a zoom: first column/row and counts. */
export function mosaicRange(z: number): { x0: number; y0: number; nx: number; ny: number } {
  const [x0, y0] = tileOf(z, MOSAIC_AREA.west, MOSAIC_AREA.north);
  const [x1, y1] = tileOf(z, MOSAIC_AREA.east, MOSAIC_AREA.south);
  return { x0, y0, nx: x1 - x0 + 1, ny: y1 - y0 + 1 };
}

/**
 * Infrared brightness to white cloud with transparency, in place on RGBA
 * pixels. At or below `clear` becomes transparent; at or above `solid`
 * nearly opaque. In EUMETView's 10.8 µm image (brighter = colder) the warm
 * sea is about 40, land at night 90–115, and clouds from about 120 up to
 * 230 for cold storm tops. (Very cold winter ground in the east can show as
 * thin cloud.)
 */
export function cloudPixels(rgba: Buffer, clear = 110, solid = 200): Buffer {
  for (let i = 0; i < rgba.length; i += 4) {
    const t = Math.min(1, Math.max(0, (rgba[i]! - clear) / (solid - clear)));
    const alpha = Math.round(t * 235 * (rgba[i + 3]! / 255));
    rgba[i] = 255;
    rgba[i + 1] = 255;
    rgba[i + 2] = 255;
    rgba[i + 3] = alpha;
  }
  return rgba;
}

/** A whole infrared PNG to a cloud PNG. */
export function infraredToClouds(input: Buffer, clear = 110, solid = 200): Buffer {
  const png = PNG.sync.read(input);
  cloudPixels(png.data, clear, solid);
  return PNG.sync.write(png);
}

interface Mosaic {
  at: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  /** Cloud RGBA pixels, nx*256 wide. */
  pixels: Buffer;
}

/** Cuts one 256-pixel tile out of a mosaic. */
function cut(m: Mosaic, x: number, y: number): Buffer {
  const out = new PNG({ width: TILE, height: TILE });
  const stride = m.nx * TILE * 4;
  const left = (x - m.x0) * TILE * 4;
  for (let row = 0; row < TILE; row++) {
    const start = ((y - m.y0) * TILE + row) * stride + left;
    m.pixels.copy(out.data, row * TILE * 4, start, start + TILE * 4);
  }
  return PNG.sync.write(out);
}

interface Cached {
  at: number;
  png: Buffer;
}

export interface CloudTiles {
  (z: number, x: number, y: number): Promise<Buffer>;
  /** Refreshes the pictures of zoom levels used in the last hour (call every few minutes). */
  refresh(): Promise<void>;
}

/** Fetches, converts and caches cloud tiles. */
export function createCloudTiles(http: HttpClient, now = Date.now): CloudTiles {
  const tiles = new Map<string, Cached>();
  const mosaics = new Map<number, Mosaic>();
  const loading = new Map<number, Promise<Mosaic>>();
  const lastUse = new Map<number, number>();

  const get = async (url: string) => {
    const opts = { signal: AbortSignal.timeout(45_000) };
    // EUMETView drops the odd request.
    return http.getBuffer(url, opts).catch(() => http.getBuffer(url, opts));
  };

  function loadMosaic(z: number): Promise<Mosaic> {
    const running = loading.get(z);
    if (running) return running;
    const { x0, y0, nx, ny } = mosaicRange(z);
    const [minX, , , maxY] = tileBounds(z, x0, y0);
    const [, minY, maxX] = tileBounds(z, x0 + nx - 1, y0 + ny - 1);
    const p = get(wms([minX, minY, maxX, maxY], nx * TILE, ny * TILE))
      .then((buf) => {
        const png = PNG.sync.read(buf);
        if (png.width !== nx * TILE || png.height !== ny * TILE) throw new Error('EUMETView sent a picture of the wrong size');
        const m: Mosaic = { at: now(), x0, y0, nx, ny, pixels: cloudPixels(png.data) };
        mosaics.set(z, m);
        return m;
      })
      .finally(() => loading.delete(z));
    loading.set(z, p);
    return p;
  }

  async function fromMosaic(z: number, x: number, y: number): Promise<Buffer> {
    let m = mosaics.get(z);
    if (!m || now() - m.at >= FRESH_MS) {
      try {
        m = await loadMosaic(z);
      } catch (err) {
        if (!m || now() - m.at >= STALE_MS) throw err; // an older picture beats a hole in the map
      }
    }
    const key = `${z}/${x}/${y}`;
    const hit = tiles.get(key);
    if (hit && hit.at === m.at) return hit.png;
    const png = cut(m, x, y);
    remember(key, m.at, png);
    return png;
  }

  async function single(z: number, x: number, y: number): Promise<Buffer> {
    const key = `${z}/${x}/${y}`;
    const hit = tiles.get(key);
    if (hit && now() - hit.at < FRESH_MS) return hit.png;
    try {
      const png = infraredToClouds(await get(wmsUrl(z, x, y)));
      remember(key, now(), png);
      return png;
    } catch (err) {
      if (hit && now() - hit.at < STALE_MS) return hit.png;
      throw err;
    }
  }

  function remember(key: string, at: number, png: Buffer) {
    tiles.delete(key);
    tiles.set(key, { at, png });
    if (tiles.size > 800) tiles.delete(tiles.keys().next().value!);
  }

  const cloudTile = (async (z: number, x: number, y: number) => {
    if (MOSAIC_ZOOMS.has(z)) {
      const r = mosaicRange(z);
      if (x >= r.x0 && x < r.x0 + r.nx && y >= r.y0 && y < r.y0 + r.ny) {
        lastUse.set(z, now());
        return fromMosaic(z, x, y);
      }
    }
    return single(z, x, y);
  }) as CloudTiles;

  cloudTile.refresh = async () => {
    for (const [z, used] of lastUse) {
      if (now() - used > 3600_000) continue;
      const m = mosaics.get(z);
      if (m && now() - m.at < FRESH_MS) continue;
      await loadMosaic(z).catch(() => {});
    }
  };

  return cloudTile;
}
