import { isValidLngLat, point, type Feature } from '@durbun/core';
import type { SourceDefinition } from '../kit/source.ts';
import { istanbulTimeToIso, toNumber } from '../kit/text.ts';

/** One notice from İBB's traffic map ("Duyurular"). Times are İstanbul local. */
export interface IbbAnnouncement {
  Id: number;
  Baslik: string;
  BaslikIng?: string;
  Metin?: string;
  MetinIng?: string;
  Tipi: number;
  Oncelik?: number;
  KameraId?: number | null;
  Koordinat?: string;
  xKoordinat?: string;
  yKoordinat?: string;
  GirisTarihi?: string;
  BitisTarihi?: string;
  Link?: string;
}

/** İBB's notice types (from the traffic map's own labels), grouped into kinds we style. */
export const IBB_ANNOUNCEMENT_KINDS: Record<number, string> = {
  16: 'accident',
  17: 'roadworks',
  18: 'closure',
  19: 'weather',
  20: 'info',
  21: 'info',
  23: 'congestion',
  24: 'info',
  26: 'info',
  30: 'ferry',
  31: 'info',
  32: 'breakdown',
  33: 'closure',
  34: 'roadworks',
  35: 'roadworks',
  36: 'fire',
  37: 'roadworks',
  38: 'roadworks',
  39: 'ferry',
  40: 'event',
};

const URL = 'https://tkmservices.ibb.gov.tr/web/api/IntensityMap/v1/CurrentAnnouncement';
/** İBB's services answer only when the request looks like it comes from its own map. */
export const IBB_MAP_HEADERS = {
  Referer: 'https://uym.ibb.gov.tr/yharita6/',
  Origin: 'https://uym.ibb.gov.tr',
};

function coordinates(a: IbbAnnouncement): [number, number] | undefined {
  // "Koordinat" is "lat,lng"; the x/y fields repeat it. The map itself trusts "Koordinat".
  const [latText, lngText] = (a.Koordinat ?? '').split(',');
  let lat = toNumber(latText);
  let lng = toNumber(lngText);
  if (lat === undefined || lng === undefined) {
    lat = toNumber(a.yKoordinat);
    lng = toNumber(a.xKoordinat);
  }
  if (lat === undefined || lng === undefined || !isValidLngLat(lng, lat)) return undefined;
  return [lng, lat];
}

export function parseIbbAnnouncements(items: IbbAnnouncement[]): Feature[] {
  const out: Feature[] = [];
  for (const a of items) {
    const at = coordinates(a);
    if (!at) continue;
    const observedAt = istanbulTimeToIso(a.GirisTarihi);
    const validUntil = istanbulTimeToIso(a.BitisTarihi);
    out.push({
      type: 'Feature',
      id: `ibb-incident:${a.Id}`,
      geometry: point(at[0], at[1]),
      properties: {
        id: `ibb-incident:${a.Id}`,
        layer: 'incidents',
        source: 'ibb-incidents',
        title: a.Baslik.trim(),
        ...(a.BaslikIng ? { titleEn: a.BaslikIng.trim() } : {}),
        ...(a.Metin ? { text: a.Metin.trim() } : {}),
        ...(a.MetinIng ? { textEn: a.MetinIng.trim() } : {}),
        kind: IBB_ANNOUNCEMENT_KINDS[a.Tipi] ?? 'info',
        ...(observedAt ? { observedAt } : {}),
        ...(validUntil ? { validUntil } : {}),
        details: {
          ibbType: a.Tipi,
          priority: a.Oncelik ?? null,
          cameraId: a.KameraId ?? null,
        },
      },
    });
  }
  return out;
}

export const ibbIncidents: SourceDefinition = {
  id: 'ibb-incidents',
  name: { tr: 'İBB trafik duyuruları', en: 'İBB traffic notices' },
  layer: 'incidents',
  homepage: 'https://uym.ibb.gov.tr/yharita6/',
  intervalSec: 60,
  async fetch({ http, signal }) {
    const items = await http.getJson<IbbAnnouncement[]>(URL, { signal, headers: IBB_MAP_HEADERS });
    if (!Array.isArray(items)) throw new Error('İBB returned something other than a list');
    return parseIbbAnnouncements(items);
  },
};
