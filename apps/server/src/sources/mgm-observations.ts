import { isValidLngLat, point, type Feature } from '@durbun/core';
import type { SourceDefinition } from '../kit/source.ts';
import { MGM_HEADERS } from './mgm-warnings.ts';

/** A province centre from MGM's list (servis.mgm.gov.tr/web/merkezler/iller). */
export interface MgmCentre {
  il: string;
  ilPlaka: number;
  enlem: number;
  boylam: number;
  sondurumIstNo: number;
}

/** Latest observation from a station (servis.mgm.gov.tr/web/sondurumlar/ilmerkezleri). */
export interface MgmObservation {
  istNo: number;
  sicaklik: number;
  nem: number;
  ruzgarHiz: number;
  ruzgarYon: number;
  hadiseKodu: string;
  denizeIndirgenmisBasinc: number;
  yagis24Saat: number;
  gorus: number;
  veriZamani: string;
}

/** MGM's weather codes, as mgm.gov.tr spells them out. */
export const CONDITIONS: Record<string, string> = {
  A: 'Açık',
  AB: 'Az bulutlu',
  PB: 'Parçalı bulutlu',
  CB: 'Çok bulutlu',
  HY: 'Hafif yağmurlu',
  Y: 'Yağmurlu',
  KY: 'Kuvvetli yağmurlu',
  KKY: 'Karla karışık yağmurlu',
  HKY: 'Hafif kar yağışlı',
  K: 'Kar yağışlı',
  YKY: 'Yoğun kar yağışlı',
  HSY: 'Hafif sağanak yağışlı',
  SY: 'Sağanak yağışlı',
  KSY: 'Kuvvetli sağanak yağışlı',
  MSY: 'Mevzi sağanak yağışlı',
  DY: 'Dolu',
  GSY: 'Gök gürültülü sağanak yağışlı',
  KGY: 'Kuvvetli gök gürültülü sağanak yağışlı',
  SIS: 'Sisli',
  PUS: 'Puslu',
  DMN: 'Dumanlı',
  KF: 'Kum veya toz taşınımı',
  R: 'Rüzgârlı',
  GKR: 'Güneyli kuvvetli rüzgâr',
  KKR: 'Kuzeyli kuvvetli rüzgâr',
  SCK: 'Sıcak',
  SGK: 'Soğuk',
  HHY: 'Yağışlı',
};

const COMPASS = ['K', 'KKD', 'KD', 'DKD', 'D', 'DGD', 'GD', 'GGD', 'G', 'GGB', 'GB', 'BGB', 'B', 'BKB', 'KB', 'KKB'];

/** Degrees to a Turkish compass point (K = north, D = east, G = south, B = west). */
export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
}

/** MGM marks missing values with -9999. */
const value = (n: number | undefined): number | undefined => (n === undefined || n <= -9999 ? undefined : n);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function parseMgmObservations(centres: MgmCentre[], observations: MgmObservation[]): Feature[] {
  const byStation = new Map(observations.map((o) => [o.istNo, o]));
  const out: Feature[] = [];
  for (const c of centres) {
    const o = byStation.get(c.sondurumIstNo);
    if (!o || !isValidLngLat(c.boylam, c.enlem)) continue;
    const temp = value(o.sicaklik);
    const wind = value(o.ruzgarHiz);
    const dir = value(o.ruzgarYon);
    const id = `mgm-now:${c.ilPlaka}`;
    out.push({
      type: 'Feature',
      id,
      geometry: point(c.boylam, c.enlem),
      properties: {
        id,
        layer: 'weather-now',
        source: 'mgm-observations',
        title: temp === undefined ? c.il : `${c.il} ${round1(temp)} °C`,
        kind: 'observation',
        ...(temp !== undefined ? { value: round1(temp) } : {}),
        observedAt: new Date(o.veriZamani).toISOString(),
        style: {
          ...(dir !== undefined && wind !== undefined && wind > 0 ? { windDir: dir } : {}),
          ...(wind !== undefined ? { windKmh: Math.round(wind) } : {}),
        },
        details: {
          condition: CONDITIONS[o.hadiseKodu] ?? o.hadiseKodu,
          temperatureC: temp === undefined ? null : round1(temp),
          humidity: value(o.nem) === undefined ? null : `%${Math.round(o.nem)}`,
          wind: wind === undefined ? null : `${Math.round(wind)} km/sa${dir !== undefined ? `, ${compass(dir)}` : ''}`,
          pressureHpa: value(o.denizeIndirgenmisBasinc) === undefined ? null : round1(o.denizeIndirgenmisBasinc),
          rain24h: value(o.yagis24Saat) === undefined ? null : `${round1(o.yagis24Saat)} mm`,
          visibilityKm: value(o.gorus) === undefined ? null : round1(o.gorus / 1000),
        },
      },
    });
  }
  return out;
}

let centresCache: { at: number; centres: MgmCentre[] } | undefined;

export const mgmObservations: SourceDefinition = {
  id: 'mgm-observations',
  name: { tr: 'MGM il merkezi gözlemleri', en: 'MGM province observations' },
  layer: 'weather-now',
  homepage: 'https://www.mgm.gov.tr/',
  intervalSec: 10 * 60,
  async fetch({ http, signal, now }) {
    // The station list rarely changes; fetch it once a day.
    if (!centresCache || now.getTime() - centresCache.at > 24 * 3600_000) {
      const centres = await http.getJson<MgmCentre[]>('https://servis.mgm.gov.tr/web/merkezler/iller', {
        signal,
        headers: MGM_HEADERS,
      });
      if (!Array.isArray(centres) || centres.length === 0) throw new Error('MGM returned no province centres');
      centresCache = { at: now.getTime(), centres };
    }
    const obs = await http.getJson<MgmObservation[]>('https://servis.mgm.gov.tr/web/sondurumlar/ilmerkezleri', {
      signal,
      headers: MGM_HEADERS,
    });
    if (!Array.isArray(obs)) throw new Error('MGM returned something other than a list');
    return parseMgmObservations(centresCache.centres, obs);
  },
};
