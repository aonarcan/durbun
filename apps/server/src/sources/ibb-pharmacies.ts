import { isValidLngLat, point, type Feature } from '@durbun/core';
import type { SourceDefinition } from '../kit/source.ts';
import { toNumber, turkishTitleCase } from '../kit/text.ts';
import { IBB_MAP_HEADERS } from './ibb-incidents.ts';

/** One on-duty pharmacy as İBB's map service returns it. */
export interface IbbPharmacy {
  ADI: string;
  ADRES?: string;
  TELEFON?: string;
  LON: string;
  LAT: string;
  ILCEID?: string;
  ILCEADI?: string;
}

export interface IbbPharmacyResponse {
  ArrayOfAramaList?: { AramaList?: IbbPharmacy[] | IbbPharmacy };
}

export function parseIbbPharmacies(body: IbbPharmacyResponse): Feature[] {
  const raw = body.ArrayOfAramaList?.AramaList;
  // The service converts XML to JSON, so a single result arrives as an object, not a list.
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Feature[] = [];
  const seen = new Set<string>();
  for (const p of list) {
    const lat = toNumber(p.LAT);
    const lng = toNumber(p.LON);
    if (lat === undefined || lng === undefined || !isValidLngLat(lng, lat)) continue;
    const name = turkishTitleCase(p.ADI);
    const district = p.ILCEADI ? turkishTitleCase(p.ILCEADI) : '';
    const id = `ibb-pharmacy:${p.ILCEID ?? ''}:${name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      type: 'Feature',
      id,
      geometry: point(lng, lat),
      properties: {
        id,
        layer: 'pharmacies',
        source: 'ibb-pharmacies',
        title: name,
        kind: 'pharmacy',
        details: {
          district: district || null,
          address: p.ADRES?.trim() || null,
          phone: p.TELEFON?.trim() || null,
        },
      },
    });
  }
  return out;
}

export const ibbPharmacies: SourceDefinition = {
  id: 'ibb-pharmacies',
  name: { tr: 'İBB nöbetçi eczaneler', en: 'İBB on-duty pharmacies' },
  layer: 'pharmacies',
  homepage: 'https://uym.ibb.gov.tr/yharita6/',
  intervalSec: 30 * 60,
  async fetch({ http, signal, now }) {
    const url = `https://cbsproxy.ibb.gov.tr/?eczanews&ilceID=&lon=&lat=&t=${now.getTime()}`;
    const body = await http.getJson<IbbPharmacyResponse>(url, { signal, headers: IBB_MAP_HEADERS });
    const features = parseIbbPharmacies(body);
    if (features.length === 0) throw new Error('No pharmacies in the response');
    return features;
  },
};
