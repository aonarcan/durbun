import { isValidLngLat, point, type Feature, type Geometry } from '@durbun/core';
import type { HttpClient } from '../kit/http.ts';
import type { SourceDefinition } from '../kit/source.ts';

/**
 * İstanbul's rail network: metro, tram, funicular, cable car and Marmaray.
 * - Metro İstanbul's API (open data): its 18 lines with official colours and
 *   hours, 248 stations with lifts and toilets, and live service notices.
 * - İBB's rail map files (open data, June 2025): the track of every line,
 *   including those Metro İstanbul doesn't run (Marmaray, M11) and lines
 *   still being built, and their stations.
 * No feed gives live train positions.
 */

const METRO = 'https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2';
export const RAIL_URLS = {
  lines: `${METRO}/GetLines`,
  stations: `${METRO}/GetStations`,
  status: `${METRO}/GetServiceStatuses`,
  track: 'https://data.ibb.gov.tr/dataset/8b8603dd-2642-4789-a891-4bb7cb2c94e8/resource/fe4ec165-9d11-4b83-b031-caea3cfaae55/download/rayli_sistem_hat_verisi.geojson',
  trackStations:
    'https://data.ibb.gov.tr/dataset/04ec9805-2483-46c7-914f-30c50857a846/resource/3dc8203f-3613-48a8-85e9-24fffb7821ad/download/rayli_sistem_istasyon_poi_verisi.geojson',
};

interface MetroAnswer<T> {
  Success: boolean;
  Data: T[] | null;
}

export interface MetroLine {
  Id: number;
  Name: string;
  LongDescription?: string;
  IsActive?: boolean | null;
  Color?: { Color_R: string; Color_G: string; Color_B: string } | null;
  FirstTime?: string;
  LastTime?: string;
}

export interface MetroStation {
  Id: number;
  Name: string;
  LineId: number;
  LineName: string;
  Description?: string;
  Order?: number;
  IsActive?: boolean | null;
  DetailInfo?: {
    Escolator?: number;
    Lift?: number;
    BabyRoom?: boolean;
    WC?: boolean;
    Masjid?: boolean;
    Latitude?: string;
    Longitude?: string;
  } | null;
}

export interface MetroStatus {
  LineId: number;
  LineName?: string;
  Description?: string;
  IsActive?: boolean;
  UpdateDate?: string;
}

interface TrackFeature {
  properties: Record<string, string | number | null | undefined>;
  geometry: { type: string; coordinates: unknown } | null;
}

/** Colours for lines Metro İstanbul doesn't run; neutral, not official. */
const OTHER_COLORS: Record<string, string> = { Marmaray: '#55606e' };
const FALLBACK_COLOR = '#6c7a89';

const hex = (n: string | number) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0');
const colorOf = (l?: MetroLine) => (l?.Color ? `#${hex(l.Color.Color_R)}${hex(l.Color.Color_G)}${hex(l.Color.Color_B)}` : undefined);

/** "M7 (U3) Mahmutbey - …" → "M7"; Marmaray → "Marmaray"; lines without a code → undefined. */
export function lineCode(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (/marmaray/i.test(name)) return 'Marmaray';
  const m = /^\s*(M\d{1,2}[AB]?|T\d|F\d|TF\d)\b/i.exec(name);
  return m ? m[1]!.toUpperCase() : undefined;
}

/** A Turkish all-capitals name ("SİRKECİ") in title case ("Sirkeci"). */
function titleCase(s: string): string {
  return s.toLocaleLowerCase('tr-TR').replace(/(^|[\s\-(/.])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toLocaleUpperCase('tr-TR'));
}

const yesNo = (b: boolean | undefined | null) => (b ? 'Var' : null);

export interface RailInputs {
  lines: MetroLine[];
  stations: MetroStation[];
  status: MetroStatus[];
  track: TrackFeature[];
  trackStations: TrackFeature[];
}

export function railFeatures({ lines, stations, status, track, trackStations }: RailInputs, now: Date): Feature[] {
  const byName = new Map(lines.map((l) => [l.Name.toUpperCase(), l]));
  const byId = new Map(lines.map((l) => [l.Id, l]));
  const notice = new Map<string, string>();
  for (const s of status) {
    if (s.IsActive === false || !s.Description) continue;
    const name = (s.LineName ?? byId.get(s.LineId)?.Name ?? '').toUpperCase();
    if (name) notice.set(name, s.Description.replace(/\s+/g, ' ').trim());
  }
  const observedAt = now.toISOString();
  const out: Feature[] = [];

  // Track: one feature per line (in service) plus one per section being built.
  const groups = new Map<string, { code: string; building: boolean; title: string; lines: [number, number][][] }>();
  let unnamed = 0;
  for (const f of track) {
    const p = f.properties;
    const stage = String(p.PROJE_ASAMA ?? '');
    // "İnşaat" (under construction): JavaScript's case-insensitive match doesn't fold the Turkish İ.
    const building = /inşaat/.test(stage.toLocaleLowerCase('tr-TR'));
    const title = String(p.PROJE_AD_KISA ?? p.PROJE_ADI ?? '').trim();
    const code = lineCode(title) ?? `?${unnamed++}`;
    const key = building ? `${code}:building:${title}` : code;
    const parts =
      f.geometry?.type === 'LineString'
        ? [f.geometry.coordinates as [number, number][]]
        : f.geometry?.type === 'MultiLineString'
          ? (f.geometry.coordinates as [number, number][][])
          : [];
    const g = groups.get(key) ?? { code, building, title, lines: [] };
    g.lines.push(...parts.map((part) => part.map((c) => [Number(c[0].toFixed(5)), Number(c[1].toFixed(5))] as [number, number])));
    groups.set(key, g);
  }
  let n = 0;
  for (const [key, g] of groups) {
    if (g.lines.length === 0) continue;
    const metro = byName.get(g.code);
    const color = colorOf(metro) ?? OTHER_COLORS[g.code] ?? FALLBACK_COLOR;
    const id = g.building ? `rail:building:${n++}` : `rail:${key}`;
    const status = g.building ? undefined : notice.get(g.code);
    const geometry: Geometry = g.lines.length === 1 ? { type: 'LineString', coordinates: g.lines[0]! } : { type: 'MultiLineString', coordinates: g.lines };
    out.push({
      type: 'Feature',
      id,
      geometry,
      properties: {
        id,
        layer: 'metro',
        source: 'metro-istanbul',
        title: g.code.startsWith('?') ? g.title : g.building ? `${g.code} (yapım aşamasında)` : g.code,
        kind: g.building ? 'building' : status ? 'disrupted' : 'line',
        observedAt,
        style: { color, building: g.building ? 1 : 0, line: g.code },
        details: {
          lineName: metro?.LongDescription?.trim() || g.title || null,
          serviceStatus: status ?? (g.building ? 'Yapım aşamasında' : null),
          hours: metro?.FirstTime && metro.LastTime ? `${metro.FirstTime} – ${metro.LastTime}` : null,
          operator: metro ? 'Metro İstanbul' : g.code === 'Marmaray' ? 'TCDD Taşımacılık' : null,
        },
      },
    });
  }

  // Stations: Metro İstanbul's, then stations of other lines in service from İBB's file.
  const covered = new Set(lines.map((l) => l.Name.toUpperCase()));
  for (const s of stations) {
    const lng = Number(s.DetailInfo?.Longitude);
    const lat = Number(s.DetailInfo?.Latitude);
    if (s.IsActive === false || !isValidLngLat(lng, lat)) continue;
    const line = byName.get(s.LineName.toUpperCase()) ?? byId.get(s.LineId);
    const code = line?.Name ?? s.LineName;
    const status = notice.get(code.toUpperCase());
    const d = s.DetailInfo;
    const id = `station:${s.Id}`;
    out.push({
      type: 'Feature',
      id,
      geometry: point(Number(lng.toFixed(6)), Number(lat.toFixed(6))),
      properties: {
        id,
        layer: 'metro',
        source: 'metro-istanbul',
        title: s.Description?.trim() || titleCase(s.Name),
        kind: status ? 'station-disrupted' : 'station',
        observedAt,
        style: { color: colorOf(line) ?? FALLBACK_COLOR, line: code },
        details: {
          line: `${code}${line?.LongDescription ? ` · ${line.LongDescription.trim()}` : ''}`,
          serviceStatus: status ?? null,
          hours: line?.FirstTime && line.LastTime ? `${line.FirstTime} – ${line.LastTime}` : null,
          lifts: d?.Lift ? String(d.Lift) : null,
          escalators: d?.Escolator ? String(d.Escolator) : null,
          toilet: yesNo(d?.WC),
          babyRoom: yesNo(d?.BabyRoom),
          masjid: yesNo(d?.Masjid),
        },
      },
    });
  }
  let k = 0;
  for (const f of trackStations) {
    const p = f.properties;
    if (!/mevcut/.test(String(p.PROJE_ASAMA ?? '').toLocaleLowerCase('tr-TR')) || f.geometry?.type !== 'Point') continue;
    const code = lineCode(String(p.PROJE_ADI ?? ''));
    if (!code || covered.has(code.toUpperCase())) continue;
    const [lng, lat] = f.geometry.coordinates as [number, number];
    if (!isValidLngLat(lng, lat)) continue;
    const id = `station:${code}:${k++}`;
    out.push({
      type: 'Feature',
      id,
      geometry: point(Number(lng.toFixed(6)), Number(lat.toFixed(6))),
      properties: {
        id,
        layer: 'metro',
        source: 'metro-istanbul',
        title: String(p.ISTASYON ?? '').trim() || code,
        kind: 'station',
        observedAt,
        style: { color: OTHER_COLORS[code] ?? FALLBACK_COLOR, line: code },
        details: { line: `${code} · ${String(p.PROJE_ADI ?? '').trim()}` },
      },
    });
  }
  return out;
}

async function metroData<T>(http: HttpClient, url: string, signal: AbortSignal): Promise<T[]> {
  const a = await http.getJson<MetroAnswer<T>>(url, { signal });
  if (!a.Success || !a.Data) throw new Error(`Metro İstanbul: no data from ${url.split('/').pop()}`);
  return a.Data;
}

/** Notices every five minutes; lines, stations and track (which rarely change) once a day. */
export function metroIstanbul(): SourceDefinition {
  let network: { at: number; data: Omit<RailInputs, 'status'> } | undefined;
  return {
    id: 'metro-istanbul',
    name: { tr: 'Metro İstanbul hatları ve duyuruları', en: 'Metro İstanbul lines and notices' },
    layer: 'metro',
    homepage: 'https://www.metro.istanbul/YolcuHizmetleri/SeferDurumlari',
    intervalSec: 300,
    timeoutSec: 60,
    async fetch({ http, signal, now }) {
      if (!network || now.getTime() - network.at > 24 * 3600_000) {
        const [lines, stations, track, trackStations] = await Promise.all([
          metroData<MetroLine>(http, RAIL_URLS.lines, signal),
          metroData<MetroStation>(http, RAIL_URLS.stations, signal),
          http.getJson<{ features: TrackFeature[] }>(RAIL_URLS.track, { signal }).then((g) => g.features),
          http.getJson<{ features: TrackFeature[] }>(RAIL_URLS.trackStations, { signal }).then((g) => g.features),
        ]);
        network = { at: now.getTime(), data: { lines, stations, track, trackStations } };
      }
      const status = await metroData<MetroStatus>(http, RAIL_URLS.status, signal).catch(() => [] as MetroStatus[]);
      return railFeatures({ ...network.data, status }, now);
    },
  };
}

// ---- piers ----

export interface IbbPier {
  ID: number;
  OP?: string;
  NM?: string;
  AH?: string;
  AD?: string;
  LT?: string;
  LN?: string;
  PL?: number;
}

export function pierFeatures(list: IbbPier[]): Feature[] {
  return list.flatMap((p) => {
    const lng = Number(p.LN);
    const lat = Number(p.LT);
    if (!isValidLngLat(lng, lat) || !p.NM) return [];
    const ido = /İDO/i.test(p.OP ?? '');
    const id = `pier:${p.ID}`;
    return [
      {
        type: 'Feature',
        id,
        geometry: point(lng, lat),
        properties: {
          id,
          layer: 'piers',
          source: 'ibb-piers',
          title: p.NM.trim(),
          kind: ido ? 'ido' : 'sehir-hatlari',
          details: {
            operator: p.OP?.trim() || null,
            hours: p.AH?.trim() || null,
            address: p.AD?.trim() || null,
            parking: p.PL ? `${p.PL} araç` : null,
          },
        },
      } satisfies Feature,
    ];
  });
}

export const ibbPiers: SourceDefinition = {
  id: 'ibb-piers',
  name: { tr: 'İBB iskele listesi', en: 'İBB pier list' },
  layer: 'piers',
  homepage: 'https://uym.ibb.gov.tr/yharita6/',
  intervalSec: 24 * 3600,
  async fetch({ http, signal }) {
    const list = await http.getJson<IbbPier[]>('https://tkmservices.ibb.gov.tr/web/api/IntensityMap/v2/Piers', {
      signal,
      headers: { Referer: 'https://uym.ibb.gov.tr/yharita6/' },
    });
    if (!Array.isArray(list) || list.length === 0) throw new Error('No piers in the answer');
    return pierFeatures(list);
  },
};
