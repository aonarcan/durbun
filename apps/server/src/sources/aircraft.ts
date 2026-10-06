import { isValidLngLat, point, type Feature } from '@durbun/core';
import { HttpError } from '../kit/http.ts';
import type { SourceContext, SourceDefinition } from '../kit/source.ts';

/**
 * Live aircraft from public volunteer networks. adsb.fi and adsb.lol need no
 * account; OpenSky sees the most over Türkiye but needs a free account for
 * useful polling. The same aircraft (ICAO address) seen by several networks
 * becomes one marker (see mergeAircraft).
 */

/** Türkiye with the Aegean, the Black Sea coast and the borders. */
export const AIR_AREA = { south: 34.5, north: 43.5, west: 24.5, east: 45.5 } as const;

/**
 * Three 250-nautical-mile (463 km) circles along 39°N, 6° apart, cover
 * Türkiye from 24°E to 47°E; where neighbouring circles meet they still
 * reach 35.5°N–42.5°N. Three requests instead of four, because adsb.lol
 * refuses a fourth request in quick succession (HTTP 429).
 */
export const CIRCLES: [lng: number, lat: number][] = [
  [29.5, 39],
  [35.5, 39],
  [41.5, 39],
];

/** Positions older than this are dropped rather than shown in the wrong place. */
const MAX_POSITION_AGE_SEC = 60;

const FT_TO_M = 0.3048;
const KN_TO_KMH = 1.852;

/** One aircraft in the readsb JSON format both adsb.fi and adsb.lol use. */
export interface ReadsbAircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  track?: number;
  true_heading?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  emergency?: string;
  category?: string;
  lat?: number;
  lon?: number;
  seen_pos?: number;
  dbFlags?: number;
}

export interface ReadsbResponse {
  /** adsb.fi: seconds; adsb.lol: milliseconds. */
  now: number;
  aircraft?: ReadsbAircraft[];
  ac?: ReadsbAircraft[];
}

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

const inArea = (lng: number, lat: number) =>
  lat >= AIR_AREA.south && lat <= AIR_AREA.north && lng >= AIR_AREA.west && lng <= AIR_AREA.east;

/** Squawk codes pilots set in an emergency: hijack, radio failure, general emergency. */
const EMERGENCY_SQUAWKS: Record<string, string> = {
  '7500': 'Kaçırma (7500)',
  '7600': 'Telsiz arızası (7600)',
  '7700': 'Acil durum (7700)',
};

interface AircraftFields {
  hex: string;
  lng: number;
  lat: number;
  seenAt: number;
  network: string;
  callsign?: string;
  registration?: string;
  typeCode?: string;
  typeName?: string;
  altFt?: number;
  onGround: boolean;
  speedKn?: number;
  track?: number;
  verticalFtMin?: number;
  squawk?: string;
  /** The owner asked for the identity to be hidden (FAA LADD or PIA programmes). */
  privacy: boolean;
}

function toFeature(a: AircraftFields): Feature {
  const id = `aircraft:${a.hex}`;
  const emergency = a.squawk ? EMERGENCY_SQUAWKS[a.squawk] : undefined;
  const callsign = a.privacy ? undefined : a.callsign;
  const registration = a.privacy ? undefined : a.registration;
  const altM = a.altFt === undefined ? undefined : Math.round(a.altFt * FT_TO_M);
  return {
    type: 'Feature',
    id,
    geometry: point(Number(a.lng.toFixed(5)), Number(a.lat.toFixed(5))),
    properties: {
      id,
      layer: 'aircraft',
      source: a.network,
      title: callsign ?? registration ?? (a.privacy ? (a.typeName ?? a.typeCode ?? 'Uçak') : a.hex.toUpperCase()),
      kind: emergency ? 'emergency' : a.onGround ? 'ground' : 'air',
      ...(a.altFt !== undefined ? { value: a.onGround ? 0 : a.altFt } : {}),
      observedAt: new Date(a.seenAt).toISOString(),
      style: {
        ...(a.track !== undefined ? { track: Math.round(a.track) } : {}),
        ...(a.speedKn !== undefined ? { speedKn: Math.round(a.speedKn) } : {}),
        altM: a.onGround ? 0 : (altM ?? 0),
      },
      details: {
        emergency: emergency ?? null,
        callsign: callsign ?? null,
        registration: registration ?? null,
        aircraftType: [a.typeName, a.typeCode].filter(Boolean).join(' · ') || null,
        altitude: a.onGround
          ? 'Yerde'
          : a.altFt !== undefined
            ? `${nf.format(a.altFt)} ft · ${nf.format(altM!)} m`
            : null,
        speed: a.speedKn !== undefined ? `${nf.format(a.speedKn)} kn · ${nf.format(a.speedKn * KN_TO_KMH)} km/sa` : null,
        verticalRate: a.verticalFtMin ? `${a.verticalFtMin > 0 ? '+' : '−'}${nf.format(Math.abs(a.verticalFtMin))} ft/dk` : null,
        heading: a.track !== undefined ? `${Math.round(a.track)}°` : null,
        squawk: a.squawk ?? null,
        icao24: a.hex.toUpperCase(),
        privacy: a.privacy ? 'Sahibi kimlik bilgilerinin gizlenmesini istemiş' : null,
        networks: a.network,
      },
    },
  };
}

/** adsb.fi or adsb.lol answer → aircraft features inside the area, deduplicated across circles. */
export function parseReadsb(responses: ReadsbResponse[], network: string): Feature[] {
  const byHex = new Map<string, Feature>();
  for (const r of responses) {
    const nowMs = r.now > 1e12 ? r.now : r.now * 1000;
    for (const a of r.aircraft ?? r.ac ?? []) {
      if (a.lat === undefined || a.lon === undefined || !isValidLngLat(a.lon, a.lat) || !inArea(a.lon, a.lat)) continue;
      if ((a.seen_pos ?? 0) > MAX_POSITION_AGE_SEC) continue;
      const hex = a.hex.toLowerCase().replace(/^~/, '');
      if (byHex.has(hex)) continue;
      const onGround = a.alt_baro === 'ground';
      const flags = a.dbFlags ?? 0;
      byHex.set(
        hex,
        toFeature({
          hex,
          lng: a.lon,
          lat: a.lat,
          seenAt: Math.round(nowMs - (a.seen_pos ?? 0) * 1000),
          network,
          ...(a.flight?.trim() ? { callsign: a.flight.trim() } : {}),
          ...(a.r ? { registration: a.r } : {}),
          ...(a.t ? { typeCode: a.t } : {}),
          ...(a.desc ? { typeName: a.desc } : {}),
          ...(typeof a.alt_baro === 'number' ? { altFt: a.alt_baro } : a.alt_geom !== undefined ? { altFt: a.alt_geom } : {}),
          onGround,
          ...(a.gs !== undefined ? { speedKn: a.gs } : {}),
          ...(a.track !== undefined ? { track: a.track } : a.true_heading !== undefined ? { track: a.true_heading } : {}),
          ...(a.baro_rate ?? a.geom_rate ? { verticalFtMin: a.baro_rate ?? a.geom_rate } : {}),
          ...(a.squawk ? { squawk: a.squawk } : {}),
          privacy: (flags & (4 | 8)) !== 0,
        }),
      );
    }
  }
  return [...byHex.values()];
}

/** OpenSky's state vectors (see openskynetwork.github.io/opensky-api/rest.html for the field order). */
export interface OpenSkyResponse {
  time: number;
  states: (string | number | boolean | null | number[])[][] | null;
}

export function parseOpenSky(r: OpenSkyResponse): Feature[] {
  const out: Feature[] = [];
  for (const s of r.states ?? []) {
    const [icao, callsign, , timePosition, , lon, lat, baroAlt, onGround, velocity, track, vRate, , geoAlt, squawk] = s as [
      string,
      string | null,
      string,
      number | null,
      number,
      number | null,
      number | null,
      number | null,
      boolean,
      number | null,
      number | null,
      number | null,
      unknown,
      number | null,
      string | null,
    ];
    if (lon === null || lat === null || timePosition === null) continue;
    if (!isValidLngLat(lon, lat) || !inArea(lon, lat) || r.time - timePosition > MAX_POSITION_AGE_SEC) continue;
    const altM = baroAlt ?? geoAlt;
    out.push(
      toFeature({
        hex: icao.toLowerCase(),
        lng: lon,
        lat,
        seenAt: timePosition * 1000,
        network: 'OpenSky',
        ...(callsign?.trim() ? { callsign: callsign.trim() } : {}),
        ...(altM !== null ? { altFt: Math.round(altM / FT_TO_M) } : {}),
        onGround,
        ...(velocity !== null ? { speedKn: velocity * 3.6 / KN_TO_KMH } : {}),
        ...(track !== null ? { track } : {}),
        ...(vRate ? { verticalFtMin: Math.round((vRate / FT_TO_M) * 60) } : {}),
        ...(squawk ? { squawk } : {}),
        privacy: false,
      }),
    );
  }
  return out;
}

/** What to call an aircraft: callsign, else registration, else its type (privacy) or ICAO address. */
function aircraftTitle(d: Record<string, string | number | boolean | null>): string {
  if (d.callsign) return String(d.callsign);
  if (d.registration) return String(d.registration);
  if (d.privacy) return String(d.aircraftType ?? 'Uçak').split(' · ')[0]!;
  return String(d.icao24);
}

/**
 * The same aircraft from two networks: the newer position wins, details the
 * newer one lacks (registration, type) come from the other, and both networks are named.
 */
export function mergeAircraft(a: Feature, b: Feature): Feature {
  const [older, newer] = (a.properties.observedAt ?? '') <= (b.properties.observedAt ?? '') ? [a, b] : [b, a];
  const details = { ...older.properties.details };
  for (const [k, v] of Object.entries(newer.properties.details ?? {})) if (v !== null && v !== '') details[k] = v;
  const networks = new Set(
    [older, newer].flatMap((f) => String(f.properties.details?.networks ?? '').split(', ')).filter(Boolean),
  );
  details.networks = [...networks].sort().join(', ');
  // A privacy request from either network holds.
  if (details.privacy) {
    details.callsign = null;
    details.registration = null;
  }
  return { ...newer, properties: { ...newer.properties, title: aircraftTitle(details), details } };
}

/**
 * Asks for each circle in turn. If some circles fail (a rate limit, say) the
 * others still count; the fetch fails only if every circle did.
 */
async function circles(
  ctx: SourceContext,
  url: (lng: number, lat: number) => string,
  gapMs: number,
): Promise<ReadsbResponse[]> {
  const out: ReadsbResponse[] = [];
  let lastError: unknown;
  for (const [i, [lng, lat]] of CIRCLES.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, gapMs)); // adsb.fi allows one request a second
    try {
      out.push(await ctx.http.getJson<ReadsbResponse>(url(lng, lat), { signal: ctx.signal }));
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      lastError = err;
    }
  }
  if (out.length === 0) throw lastError;
  return out;
}

export const adsbFi: SourceDefinition = {
  id: 'adsb-fi',
  name: { tr: 'adsb.fi uçak konumları', en: 'adsb.fi aircraft positions' },
  layer: 'aircraft',
  homepage: 'https://globe.adsb.fi/?lat=39&lon=35&zoom=6',
  intervalSec: 30,
  timeoutSec: 25,
  async fetch(ctx) {
    const res = await circles(ctx, (lng, lat) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lng}/dist/250`, 1100);
    return parseReadsb(res, 'adsb.fi');
  },
};

export const adsbLol: SourceDefinition = {
  id: 'adsb-lol',
  name: { tr: 'adsb.lol uçak konumları', en: 'adsb.lol aircraft positions' },
  layer: 'aircraft',
  homepage: 'https://adsb.lol/?lat=39&lon=35&zoom=6',
  // adsb.lol is stricter than adsb.fi (it answered 429, then 403, to quick repeats), so it is asked
  // less often and more slowly; over Türkiye it mostly sees aircraft adsb.fi already has.
  intervalSec: 90,
  timeoutSec: 40,
  async fetch(ctx) {
    const res = await circles(ctx, (lng, lat) => `https://api.adsb.lol/v2/point/${lat}/${lng}/250`, 3000);
    return parseReadsb(res, 'adsb.lol');
  },
};

const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
let openSkyToken: { value: string; expiresAt: number } | undefined;

/** Exchanges the free account's API client for a token (valid 30 minutes). */
async function openSkyAccessToken(signal: AbortSignal, now: number): Promise<string> {
  if (openSkyToken && now < openSkyToken.expiresAt - 60_000) return openSkyToken.value;
  const res = await fetch(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.OPENSKY_CLIENT_ID ?? '',
      client_secret: process.env.OPENSKY_CLIENT_SECRET ?? '',
    }),
    signal,
  });
  if (!res.ok) throw new HttpError(`OpenSky sign-in failed: HTTP ${res.status} (check OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET)`, res.status);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  openSkyToken = { value: body.access_token, expiresAt: now + body.expires_in * 1000 };
  return body.access_token;
}

export const openSky: SourceDefinition = {
  id: 'opensky',
  name: { tr: 'OpenSky uçak konumları', en: 'OpenSky aircraft positions' },
  layer: 'aircraft',
  homepage: 'https://opensky-network.org/network/explorer',
  // A free account allows 4,000 credits a day; this area costs 3 per look, so one look every 75 s.
  intervalSec: 75,
  setup: {
    env: ['OPENSKY_CLIENT_ID', 'OPENSKY_CLIENT_SECRET'],
    hint: {
      tr: 'Ücretsiz OpenSky hesabı gerekir: OPENSKY_CLIENT_ID ve OPENSKY_CLIENT_SECRET (.env)',
      en: 'Needs a free OpenSky account: OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET in .env',
    },
  },
  async fetch({ http, signal, now }) {
    const token = await openSkyAccessToken(signal, now.getTime());
    const { south, north, west, east } = AIR_AREA;
    const url = `https://opensky-network.org/api/states/all?lamin=${south}&lomin=${west}&lamax=${north}&lomax=${east}`;
    try {
      return parseOpenSky(await http.getJson<OpenSkyResponse>(url, { signal, headers: { Authorization: `Bearer ${token}` } }));
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) openSkyToken = undefined; // expired: sign in again next time
      throw err;
    }
  },
};
