import { isValidLngLat, point, type Feature, type TransitDirection, type TransitStop, type TransitVehicle } from '@durbun/core';
import type { HttpClient } from '../kit/http.ts';
import type { SourceDefinition } from '../kit/source.ts';

/**
 * İETT, İstanbul's bus operator, publishes SOAP web services on İBB's API
 * gateway (open data, İBB Open Data Licence): every bus's position in one
 * call, stops, lines, the stops of a line, the buses on a line, line notices
 * and yesterday's trips. Most answer with a JSON string inside the SOAP result.
 */

const IETT = 'https://api.ibb.gov.tr/iett';
export const IETT_URLS = {
  fleet: `${IETT}/FiloDurum/SeferGerceklesme.asmx`,
  network: `${IETT}/UlasimAnaVeri/HatDurakGuzergah.asmx`,
  lineStops: `${IETT}/ibb/ibb.asmx`,
  notices: `${IETT}/UlasimDinamikVeri/Duyurular.asmx`,
  archive: `${IETT}/ibb/ibb360.asmx`,
};

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return XML_ENTITIES[e] ?? all;
  });
}

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The text inside a SOAP method's result element, or the fault İETT reported. */
export function soapResult(xml: string, method: string): string {
  const m = new RegExp(`<${method}Result>([\\s\\S]*)</${method}Result>`).exec(xml);
  if (m) return unescapeXml(m[1]!);
  if (new RegExp(`<${method}Result\\s*/>`).test(xml)) return '';
  const fault = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(xml);
  throw new Error(fault ? `İETT: ${unescapeXml(fault[1]!).trim().slice(0, 140)}` : 'İETT: unexpected answer');
}

export async function soap(
  http: HttpClient,
  url: string,
  method: string,
  params: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<string> {
  const args = Object.entries(params)
    .map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`)
    .join('');
  const body =
    '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><${method} xmlns="http://tempuri.org/">${args}</${method}></soap:Body></soap:Envelope>`;
  const xml = await http.postText(url, body, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"http://tempuri.org/${method}"` },
    ...(signal ? { signal } : {}),
  });
  return soapResult(xml, method);
}

/** A JSON-returning method; an empty result is an empty list. */
export async function soapJson<T>(
  http: HttpClient,
  url: string,
  method: string,
  params: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T[]> {
  const text = (await soap(http, url, method, params, signal)).trim();
  return text ? (JSON.parse(text) as T[]) : [];
}

// ---- times ----

const TR_OFFSET_MS = 3 * 3600_000;

/** "12:24:52" today in İstanbul (UTC+3 all year) → ms. A time just after midnight read before it belongs to yesterday. */
export function todayAt(hms: string, now: Date): number | undefined {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hms.trim());
  if (!m) return undefined;
  const local = new Date(now.getTime() + TR_OFFSET_MS);
  let t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), Number(m[1]), Number(m[2]), Number(m[3] ?? 0)) - TR_OFFSET_MS;
  if (t > now.getTime() + 5 * 60_000) t -= 24 * 3600_000;
  return t;
}

/** "2026-10-06 12:25:55" in İstanbul time → ISO. */
export function localDateTime(s: string | undefined): string | undefined {
  const m = s && /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return undefined;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) - TR_OFFSET_MS).toISOString();
}

/** İstanbul's calendar date as yyyymmdd, `daysBack` days before now. */
export function trDate(now: Date, daysBack = 0): string {
  const d = new Date(now.getTime() + TR_OFFSET_MS - daysBack * 24 * 3600_000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ---- the whole fleet ----

export interface FleetVehicle {
  Operator?: string | null;
  Garaj?: string | null;
  KapiNo?: string | null;
  Saat?: string | null;
  Boylam?: string | null;
  Enlem?: string | null;
  Hiz?: string | null;
  Plaka?: string | null;
}

/** İstanbul's bus area, to drop positions at 0,0 and other glitches. */
const ISTANBUL = { west: 27.9, east: 30.0, south: 40.7, north: 41.7 };
/** Positions older than this are buses out of service. */
const MAX_AGE_MS = 10 * 60_000;
const MOVING_KMH = 3;

function bearing(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/**
 * The fleet service gives no heading, so each bus's direction comes from
 * where it was before: the bearing of its last move of 20 m or more.
 */
export class BusHeadings {
  private readonly last = new Map<string, { at: [number, number]; heading?: number }>();

  update(id: string, at: [number, number]): number | undefined {
    const prev = this.last.get(id);
    if (!prev) {
      this.last.set(id, { at });
      return undefined;
    }
    const dLat = (at[1] - prev.at[1]) * 110_570;
    const dLng = (at[0] - prev.at[0]) * 111_320 * Math.cos((at[1] * Math.PI) / 180);
    if (Math.hypot(dLat, dLng) < 20) return prev.heading;
    const heading = Math.round(bearing(prev.at, at));
    this.last.set(id, { at, heading });
    return heading;
  }
}

export function busFeatures(list: FleetVehicle[], now: Date, headings = new BusHeadings()): Feature[] {
  const out: Feature[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const door = v.KapiNo?.trim();
    const lng = Number(v.Boylam);
    const lat = Number(v.Enlem);
    if (!door || seen.has(door) || !isValidLngLat(lng, lat)) continue;
    if (lng < ISTANBUL.west || lng > ISTANBUL.east || lat < ISTANBUL.south || lat > ISTANBUL.north) continue;
    const t = v.Saat ? todayAt(v.Saat, now) : undefined;
    if (t === undefined || now.getTime() - t > MAX_AGE_MS) continue;
    seen.add(door);
    const speed = Math.round(Number(v.Hiz) || 0);
    const moving = speed >= MOVING_KMH;
    const heading = headings.update(door, [lng, lat]);
    const id = `bus:${door}`;
    out.push({
      type: 'Feature',
      id,
      geometry: point(Number(lng.toFixed(6)), Number(lat.toFixed(6))),
      properties: {
        id,
        layer: 'buses',
        source: 'iett-buses',
        title: door,
        kind: moving ? 'moving' : 'stopped',
        value: speed,
        observedAt: new Date(t).toISOString(),
        style: { moving: moving ? 1 : 0, ...(heading !== undefined ? { track: heading } : {}) },
        details: {
          speed: `${speed} km/sa`,
          operator: v.Operator?.trim() || null,
          plate: v.Plaka?.trim() || null,
          garage: v.Garaj?.trim() || null,
        },
      },
    });
  }
  return out;
}

export function iettBuses(headings = new BusHeadings()): SourceDefinition {
  return {
    id: 'iett-buses',
    name: { tr: 'İETT otobüs konumları', en: 'İETT bus positions' },
    layer: 'buses',
    homepage: 'https://data.ibb.gov.tr/dataset/iett-filo-durum-web-servisi',
    intervalSec: 30,
    timeoutSec: 40,
    onDemand: true,
    async fetch({ http, signal, now }) {
      const list = await soapJson<FleetVehicle>(http, IETT_URLS.fleet, 'GetFiloAracKonum_json', {}, signal);
      if (list.length === 0) throw new Error('İETT returned no buses');
      return busFeatures(list, now, headings);
    },
  };
}

// ---- stops ----

export interface IettStop {
  SDURAKKODU: number | string;
  SDURAKADI?: string;
  KOORDINAT?: string;
  ILCEADI?: string;
  SYON?: string;
  AKILLI?: string;
  FIZIKI?: string;
  DURAK_TIPI?: string;
  ENGELLIKULLANIM?: string;
}

/** "POINT (28.69 41.00)" → [lng, lat]. */
export function wktPoint(s: string | undefined): [number, number] | undefined {
  const m = s && /POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(s);
  if (!m) return undefined;
  const [lng, lat] = [Number(m[1]), Number(m[2])];
  return isValidLngLat(lng, lat) ? [lng, lat] : undefined;
}

export function stopFeatures(list: IettStop[]): Feature[] {
  const out: Feature[] = [];
  for (const s of list) {
    const at = wktPoint(s.KOORDINAT);
    const code = String(s.SDURAKKODU ?? '').trim();
    if (!at || !code) continue;
    const id = `stop:${code}`;
    out.push({
      type: 'Feature',
      id,
      geometry: point(Number(at[0].toFixed(6)), Number(at[1].toFixed(6))),
      properties: {
        id,
        layer: 'bus-stops',
        source: 'iett-stops',
        title: s.SDURAKADI?.trim() || code,
        kind: 'stop',
        details: {
          stopCode: code,
          towards: s.SYON?.trim() || null,
          district: s.ILCEADI?.trim() || null,
          shelter: s.FIZIKI?.trim() || null,
          accessible: /^uygun$/i.test(s.ENGELLIKULLANIM?.trim() ?? '') ? 'Evet' : s.ENGELLIKULLANIM ? 'Hayır' : null,
          smartStop: s.AKILLI && s.AKILLI.trim() !== 'YOK' ? 'Var' : null,
        },
      },
    });
  }
  return out;
}

export const iettStops: SourceDefinition = {
  id: 'iett-stops',
  name: { tr: 'İETT durakları', en: 'İETT bus stops' },
  layer: 'bus-stops',
  homepage: 'https://data.ibb.gov.tr/dataset/iett-hat-durak-guzergah-web-servisi',
  intervalSec: 24 * 3600,
  timeoutSec: 90,
  async fetch({ http, signal }) {
    const list = await soapJson<IettStop>(http, IETT_URLS.network, 'GetDurak_json', { DurakKodu: '' }, signal);
    if (list.length === 0) throw new Error('İETT returned no stops');
    return stopFeatures(list);
  },
};

// ---- lines, line stops, buses on a line, notices, yesterday's trips ----

export interface IettLine {
  SHATKODU: string;
  SHATADI?: string;
  TARIFE?: string;
  HAT_UZUNLUGU?: number;
  SEFER_SURESI?: number;
}

export interface LineVehicle {
  kapino: string;
  boylam: string;
  enlem: string;
  hatkodu: string;
  guzergahkodu?: string;
  hatad?: string;
  yon?: string;
  son_konum_zamani?: string;
  yakinDurakKodu?: string;
}

/** "500T_G_D0" → "G". */
export function directionOf(routeCode: string | undefined): TransitDirection | undefined {
  const m = routeCode && /_([GD])_/.exec(routeCode);
  return m ? (m[1] as TransitDirection) : undefined;
}

export function lineVehicles(list: LineVehicle[]): TransitVehicle[] {
  return list.flatMap((v) => {
    const lng = Number(v.boylam);
    const lat = Number(v.enlem);
    if (!v.kapino || !isValidLngLat(lng, lat)) return [];
    const direction = directionOf(v.guzergahkodu);
    const at = localDateTime(v.son_konum_zamani);
    return [
      {
        id: `bus:${v.kapino}`,
        doorNo: v.kapino,
        lng,
        lat,
        ...(direction ? { direction } : {}),
        ...(v.yon ? { towards: v.yon.trim() } : {}),
        ...(v.yakinDurakKodu ? { nearestStopCode: String(v.yakinDurakKodu) } : {}),
        ...(at ? { at } : {}),
      },
    ];
  });
}

/** DurakDetay_GYY answers with an XML table, one row per stop of the line in each direction. */
export function parseLineStops(xml: string): TransitStop[] {
  const out: TransitStop[] = [];
  for (const m of xml.matchAll(/<Table>([\s\S]*?)<\/Table>/g)) {
    const field = (name: string) => {
      const f = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(m[1]!);
      return f ? unescapeXml(f[1]!).trim() : undefined;
    };
    const lng = Number(field('XKOORDINATI'));
    const lat = Number(field('YKOORDINATI'));
    const code = field('DURAKKODU');
    const dir = field('YON');
    if (!code || !isValidLngLat(lng, lat)) continue;
    out.push({
      code,
      name: field('DURAKADI') ?? code,
      lng,
      lat,
      ...(dir === 'G' || dir === 'D' ? { direction: dir } : {}),
      order: Number(field('SIRANO')) || 0,
    });
  }
  return out.sort((a, b) => (a.direction ?? '').localeCompare(b.direction ?? '') || (a.order ?? 0) - (b.order ?? 0));
}

export interface IettNotice {
  HATKODU: string;
  HAT?: string;
  TIP?: string;
  GUNCELLEME_SAATI?: string;
  MESAJ?: string;
}

export interface ArchiveTrip {
  SHATKODU: string;
  SKAPINUMARA: string;
}

/** Yesterday's trips → door number → the lines it ran, most trips first. */
export function linesByBus(trips: ArchiveTrip[]): Map<string, string[]> {
  const counts = new Map<string, Map<string, number>>();
  for (const t of trips) {
    if (!t.SKAPINUMARA || !t.SHATKODU) continue;
    const m = counts.get(t.SKAPINUMARA) ?? new Map<string, number>();
    m.set(t.SHATKODU, (m.get(t.SHATKODU) ?? 0) + 1);
    counts.set(t.SKAPINUMARA, m);
  }
  return new Map([...counts].map(([door, m]) => [door, [...m].sort((a, b) => b[1] - a[1]).map(([line]) => line)]));
}
