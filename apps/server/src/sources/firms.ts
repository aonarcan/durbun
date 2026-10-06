import { point, type Feature } from '@durbun/core';
import type { SourceDefinition } from '../kit/source.ts';
import { provinceAt } from '../provinces.ts';

/**
 * Satellite fire detections from NASA FIRMS: hot spots seen by the VIIRS
 * instruments (three satellites) and MODIS (two), from the public 24-hour
 * files that need no key. A detection is a heat anomaly: usually a fire, but
 * factories and gas flares show up too.
 */

const FIRMS = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire';
/** Detections this far outside the simplified province outlines still count (coasts, islands). */
const BORDER_KM = 15;

interface Instrument {
  id: string;
  name: string;
  /** Path of the 24-hour file for a FIRMS region ("Russia_Asia" covers Türkiye east of 26°E, "Europe" the rest). */
  file: (region: string) => string;
  /** Short codes in the "satellite" column. */
  satellites: Record<string, string>;
}

const INSTRUMENTS: Instrument[] = [
  {
    id: 'firms-viirs-snpp',
    name: 'VIIRS (Suomi NPP)',
    file: (r) => `${FIRMS}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_${r}_24h.csv`,
    satellites: { N: 'Suomi NPP' },
  },
  {
    id: 'firms-viirs-noaa20',
    name: 'VIIRS (NOAA-20)',
    file: (r) => `${FIRMS}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_${r}_24h.csv`,
    satellites: { N20: 'NOAA-20', '1': 'NOAA-20' },
  },
  {
    id: 'firms-viirs-noaa21',
    name: 'VIIRS (NOAA-21)',
    file: (r) => `${FIRMS}/noaa-21-viirs-c2/csv/J2_VIIRS_C2_${r}_24h.csv`,
    satellites: { N21: 'NOAA-21', '2': 'NOAA-21' },
  },
  {
    id: 'firms-modis',
    name: 'MODIS (Aqua, Terra)',
    file: (r) => `${FIRMS}/modis-c6.1/csv/MODIS_C6_1_${r}_24h.csv`,
    satellites: { A: 'Aqua', T: 'Terra' },
  },
];

const CONFIDENCE: Record<string, string> = { low: 'Düşük', nominal: 'Orta', high: 'Yüksek' };

/** VIIRS writes l/n/h; MODIS a percentage. */
export function confidenceLevel(raw: string): 'low' | 'nominal' | 'high' {
  const v = raw.trim().toLowerCase();
  if (v === 'l' || v === 'low') return 'low';
  if (v === 'h' || v === 'high') return 'high';
  if (v === 'n' || v === 'nominal') return 'nominal';
  const pct = Number(v);
  if (Number.isFinite(pct)) return pct < 30 ? 'low' : pct >= 80 ? 'high' : 'nominal';
  return 'nominal';
}

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** A FIRMS CSV → detections in or near Türkiye, tagged with their province. */
export function parseFirms(csv: string, instrument: { id: string; name: string; satellites: Record<string, string> }): Feature[] {
  const lines = csv.trim().split(/\r?\n/);
  const head = (lines.shift() ?? '').split(',');
  const col = (name: string) => head.indexOf(name);
  const [iLat, iLon, iDate, iTime, iSat, iConf, iFrp, iDn] = [
    'latitude',
    'longitude',
    'acq_date',
    'acq_time',
    'satellite',
    'confidence',
    'frp',
    'daynight',
  ].map(col);
  const iBright = col('bright_ti4') >= 0 ? col('bright_ti4') : col('brightness');
  if ([iLat, iLon, iDate, iTime].some((i) => i === undefined || i < 0)) throw new Error('FIRMS file has unexpected columns');
  const out: Feature[] = [];
  for (const line of lines) {
    const c = line.split(',');
    const lat = Number(c[iLat!]);
    const lng = Number(c[iLon!]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 35 || lat > 42.5 || lng < 25.3 || lng > 45) continue;
    const province = provinceAt(lng, lat, BORDER_KM);
    if (!province) continue;
    const time = (c[iTime!] ?? '').padStart(4, '0');
    const observedAt = new Date(`${c[iDate!]}T${time.slice(0, 2)}:${time.slice(2)}:00Z`).toISOString();
    const level = confidenceLevel(c[iConf!] ?? '');
    const frp = Number(c[iFrp!]);
    const sat = c[iSat!] ?? '';
    const id = `fire:${instrument.id}:${lat.toFixed(4)},${lng.toFixed(4)}:${c[iDate!]}T${time}`;
    out.push({
      type: 'Feature',
      id,
      geometry: point(lng, lat),
      properties: {
        id,
        layer: 'fires',
        source: instrument.id,
        title: `Uydu ısı tespiti: ${province.name}`,
        kind: level,
        ...(Number.isFinite(frp) ? { value: frp } : {}),
        observedAt,
        details: {
          province: province.name,
          confidence: CONFIDENCE[level] ?? level,
          frp: Number.isFinite(frp) ? `${nf.format(frp)} MW` : null,
          satellite: `${instrument.satellites[sat] ?? sat} · ${instrument.name.split(' ')[0]}`,
          dayNight: c[iDn!] === 'D' ? 'Gündüz' : c[iDn!] === 'N' ? 'Gece' : null,
          brightnessK: iBright >= 0 && c[iBright] ? `${nf.format(Number(c[iBright]))} K` : null,
        },
      },
    });
  }
  return out;
}

export const firmsSources: SourceDefinition[] = INSTRUMENTS.map((inst) => ({
  id: inst.id,
  name: { tr: `NASA FIRMS ${inst.name}`, en: `NASA FIRMS ${inst.name}` },
  layer: 'fires',
  homepage: 'https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@35.0,39.0,6.0z',
  intervalSec: 30 * 60,
  timeoutSec: 60,
  async fetch({ http, signal }) {
    const [east, west] = await Promise.all(
      ['Russia_Asia', 'Europe'].map((region) => http.getText(inst.file(region), { signal })),
    );
    // The two regional files overlap over western Türkiye; keep each detection once.
    const byId = new Map<string, Feature>();
    for (const f of [...parseFirms(east!, inst), ...parseFirms(west!, inst)]) byId.set(f.properties.id, f);
    return [...byId.values()];
  },
}));
