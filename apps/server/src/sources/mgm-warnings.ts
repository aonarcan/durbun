import type { Feature } from '@durbun/core';
import type { SourceDefinition } from '../kit/source.ts';
import { provinces, type Province } from '../provinces.ts';

/** MGM's warning JSON (the same MeteoAlarm-style data mgm.gov.tr/meteouyari shows). */
export interface MgmAlert {
  _id?: string;
  alertNo: number;
  text?: Partial<Record<Level, string>>;
  weather?: Partial<Record<Level, string[]>>;
  towns?: Partial<Record<Level, number[]>>;
  begin: string;
  end: string;
  insertDate?: string;
}

export type Level = 'yellow' | 'orange' | 'red';
const LEVELS_HIGH_FIRST: Level[] = ['red', 'orange', 'yellow'];

export const MGM_HEADERS = { Origin: 'https://www.mgm.gov.tr', Referer: 'https://www.mgm.gov.tr/' };

export const LEVEL_NAMES: Record<Level, string> = { yellow: 'Sarı', orange: 'Turuncu', red: 'Kırmızı' };

/** MeteoAlarm hazard types as MGM uses them, in Turkish. */
export const HAZARD_NAMES: Record<string, string> = {
  thunderstorm: 'Gök gürültülü sağanak',
  rain: 'Kuvvetli yağış',
  flood: 'Sel',
  'rain-flood': 'Yağış ve sel',
  wind: 'Kuvvetli rüzgâr',
  snow: 'Kar',
  'snow-ice': 'Kar ve buzlanma',
  ice: 'Buzlanma ve don',
  fog: 'Sis',
  hot: 'Aşırı sıcak',
  'high-temperature': 'Aşırı sıcak',
  cold: 'Aşırı soğuk',
  'low-temperature': 'Aşırı soğuk',
  coast: 'Kıyı olayları',
  coastalevent: 'Kıyı olayları',
  forestfire: 'Orman yangını riski',
  avalanche: 'Çığ',
  avalanches: 'Çığ',
  dust: 'Toz taşınımı',
};

/** MGM town codes are 9PPDD: PP is the province's plate number, DD the district. */
export function plateOfTown(town: number): number {
  return Math.floor(town / 100) % 100;
}

/**
 * One feature per province per warning, at the highest level any of its
 * districts has, with the province outline as geometry.
 */
export function parseMgmAlerts(alerts: MgmAlert[], lookup: Map<number, Province> = provinces()): Feature[] {
  const out: Feature[] = [];
  const seen = new Set<number>();
  for (const a of alerts) {
    if (seen.has(a.alertNo)) continue;
    seen.add(a.alertNo);
    const byPlate = new Map<number, { level: Level; towns: number }>();
    for (const level of LEVELS_HIGH_FIRST) {
      for (const town of a.towns?.[level] ?? []) {
        const plate = plateOfTown(town);
        const cur = byPlate.get(plate);
        if (cur) cur.towns += 1;
        else byPlate.set(plate, { level, towns: 1 });
      }
    }
    for (const [plate, { level, towns }] of byPlate) {
      const p = lookup.get(plate);
      if (!p) continue;
      const hazards = (a.weather?.[level] ?? []).map((h) => HAZARD_NAMES[h] ?? h);
      const id = `mgm-warning:${a.alertNo}:${plate}`;
      out.push({
        type: 'Feature',
        id,
        geometry: p.geometry,
        properties: {
          id,
          layer: 'weather-warnings',
          source: 'mgm-warnings',
          title: `${p.name}: ${LEVEL_NAMES[level]} uyarı${hazards.length ? ` (${hazards.join(', ')})` : ''}`,
          ...(a.text?.[level] ? { text: a.text[level] } : {}),
          kind: level,
          observedAt: new Date(a.begin).toISOString(),
          validUntil: new Date(a.end).toISOString(),
          details: {
            province: p.name,
            warningLevel: LEVEL_NAMES[level],
            hazards: hazards.join(', ') || null,
            districts: towns,
          },
        },
      });
    }
  }
  // Higher levels last, so they draw on top.
  const rank = (f: Feature) => LEVELS_HIGH_FIRST.length - LEVELS_HIGH_FIRST.indexOf(f.properties.kind as Level);
  return out.sort((x, y) => rank(x) - rank(y));
}

export const mgmWarnings: SourceDefinition = {
  id: 'mgm-warnings',
  name: { tr: 'MGM meteorolojik uyarılar', en: 'MGM weather warnings' },
  layer: 'weather-warnings',
  homepage: 'https://www.mgm.gov.tr/meteouyari/',
  intervalSec: 10 * 60,
  async fetch({ http, signal }) {
    const [today, tomorrow] = await Promise.all(
      ['today', 'tomorrow'].map((d) =>
        http.getJson<MgmAlert[]>(`https://servis.mgm.gov.tr/web/meteoalarm/${d}`, { signal, headers: MGM_HEADERS }),
      ),
    );
    if (!Array.isArray(today) || !Array.isArray(tomorrow)) throw new Error('MGM returned something other than a list');
    return parseMgmAlerts([...today, ...tomorrow]);
  },
};
