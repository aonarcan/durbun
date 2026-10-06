import { readFileSync } from 'node:fs';
import type { Feature } from '@durbun/core';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/kit/store.ts';
import type { LayerDefinition, SourceDefinition } from '../src/kit/source.ts';
import { timeWithSuffix } from '../src/kit/text.ts';
import { provinceAt } from '../src/provinces.ts';
import { createHttpClient } from '../src/kit/http.ts';
import {
  adsbFi,
  mergeAircraft,
  parseOpenSky,
  parseReadsb,
  type OpenSkyResponse,
  type ReadsbResponse,
} from '../src/sources/aircraft.ts';
import { confidenceLevel, parseFirms } from '../src/sources/firms.ts';
import { kegmDate, parseKegmStraits, stateAt, straitFeatures } from '../src/sources/kegm-straits.ts';
import { aisTime, shipCategory, ShipTable, type AisMessage } from '../src/sources/ships.ts';

const text = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const fixture = <T>(name: string): T => JSON.parse(text(name)) as T;
const byId = (fs: Feature[], id: string) => fs.find((f) => f.properties.id === id)!;

describe('aircraft', () => {
  const fi = parseReadsb([fixture<ReadsbResponse>('adsbfi.json')], 'adsb.fi');
  const lol = parseReadsb([fixture<ReadsbResponse>('adsblol.json')], 'adsb.lol');
  const sky = parseOpenSky(fixture<OpenSkyResponse>('opensky.json'));

  it('reads adsb.fi: callsign, type, altitude and speed, inside the area only', () => {
    // The Athens aircraft is outside the area.
    expect(fi.map((f) => f.properties.id)).toEqual([
      'aircraft:4bab2a',
      'aircraft:4b91f5',
      'aircraft:4bbd08',
      'aircraft:4bb066',
      'aircraft:72944c',
    ]);
    const thy = byId(fi, 'aircraft:4bab2a');
    expect(thy.properties.title).toBe('THY1VN');
    expect(thy.properties.kind).toBe('air');
    expect(thy.properties.value).toBe(4750);
    expect(thy.properties.style).toEqual({ track: 344, speedKn: 222, altM: 1448 });
    expect(thy.properties.details).toMatchObject({
      registration: 'TC-JYJ',
      aircraftType: 'BOEING 737-900 · B739',
      altitude: '4.750 ft · 1.448 m',
      speed: '222 kn · 411 km/sa',
      verticalRate: '−128 ft/dk',
      networks: 'adsb.fi',
    });
    // seen_pos 0.328 s before "now".
    expect(thy.properties.observedAt).toBe(new Date(Math.round(1791270870001 - 328)).toISOString());
    expect(byId(fi, 'aircraft:72944c').properties.kind).toBe('ground');
  });

  it('reads adsb.lol, whose "now" is in milliseconds, and drops stale positions', () => {
    expect(lol.map((f) => f.properties.id)).toEqual(['aircraft:4bab2a', 'aircraft:4b91f5', 'aircraft:73806a']);
    expect(byId(lol, 'aircraft:4bab2a').properties.observedAt).toBe(new Date(1791270873500 - 2330).toISOString());
    const res = fixture<ReadsbResponse>('adsblol.json');
    const stale = { ...res.ac![0]!, seen_pos: 75 };
    expect(parseReadsb([{ now: res.now, ac: [stale] }], 'adsb.lol')).toEqual([]);
  });

  it('reads OpenSky state vectors', () => {
    expect(sky.map((f) => f.properties.id)).toEqual(['aircraft:4bb066', 'aircraft:4bab2a', 'aircraft:4bc8c6']);
    const a = byId(sky, 'aircraft:4bc8c6');
    expect(a.properties.title).toBe('PGT83BX');
    expect(a.properties.value).toBe(38000);
    expect(a.properties.details?.speed).toBe('454 kn · 842 km/sa');
  });

  it('merges the same aircraft from several networks', () => {
    const merged = mergeAircraft(byId(fi, 'aircraft:4bab2a'), byId(sky, 'aircraft:4bab2a'));
    // OpenSky's position is newer (…871 s vs …869.7 s), adsb.fi adds registration and type.
    expect(merged.geometry).toEqual(byId(sky, 'aircraft:4bab2a').geometry);
    expect(merged.properties.details).toMatchObject({ registration: 'TC-JYJ', networks: 'OpenSky, adsb.fi' });
    expect(merged.properties.title).toBe('THY1VN');
  });

  it('hides identities the owner asked to keep private', () => {
    const res = fixture<ReadsbResponse>('adsbfi.json');
    const priv = { ...res.aircraft![0]!, hex: 'abc123', dbFlags: 8 };
    const [f] = parseReadsb([{ now: res.now, aircraft: [priv] }], 'adsb.fi');
    expect(f!.properties.title).toBe('BOEING 737-900');
    expect(f!.properties.details).toMatchObject({ callsign: null, registration: null });
    const merged = mergeAircraft(f!, { ...byId(sky, 'aircraft:4bab2a'), properties: { ...byId(sky, 'aircraft:4bab2a').properties, id: 'aircraft:abc123' } });
    expect(merged.properties.details?.callsign).toBeNull();
    expect(merged.properties.title).toBe('BOEING 737-900');
  });

  it('keeps the circles that answered when one is refused', async () => {
    const urls: string[] = [];
    const body = text('adsbfi.json');
    const http = createHttpClient('test', async (url) => {
      urls.push(url);
      return url.includes('/lon/35.5/') ? new Response('slow down', { status: 429 }) : new Response(body);
    });
    const features = await adsbFi.fetch({ http, signal: new AbortController().signal, now: new Date() });
    expect(urls).toHaveLength(3);
    expect(Array.isArray(features) && features.length > 0).toBe(true);

    const refused = createHttpClient('test', async () => new Response('slow down', { status: 429 }));
    await expect(adsbFi.fetch({ http: refused, signal: new AbortController().signal, now: new Date() })).rejects.toThrow(/429/);
  }, 10_000);

  it('merges in the store so each aircraft appears once', () => {
    const layer: LayerDefinition = {
      id: 'aircraft',
      name: { tr: 'Uçaklar', en: 'Aircraft' },
      group: 'air-sea',
      color: '#000',
      defaultOn: false,
      attribution: 'x',
      merge: mergeAircraft,
    };
    const src = (id: string): SourceDefinition => ({
      id,
      name: { tr: id, en: id },
      layer: 'aircraft',
      homepage: 'https://example.org',
      intervalSec: 30,
      fetch: async () => [],
    });
    const store = new Store([layer], [src('a'), src('b')], new Set(), Date.now, {});
    store.recordSuccess('a', fi, 10);
    store.recordSuccess('b', sky, 10);
    const ids = store.getCollection('aircraft')!.features.map((f) => f.properties.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(6);
    expect(store.layerSummaries()[0]!.count).toBe(6);
    expect('merge' in store.layerSummaries()[0]!).toBe(false);
  });
});

describe('sources that need a key', () => {
  const layer: LayerDefinition = {
    id: 'ships',
    name: { tr: 'Gemiler', en: 'Ships' },
    group: 'air-sea',
    color: '#000',
    defaultOn: false,
    attribution: 'x',
  };
  const keyed: SourceDefinition = {
    id: 'aisstream',
    name: { tr: 'AIS', en: 'AIS' },
    layer: 'ships',
    homepage: 'https://aisstream.io',
    intervalSec: 60,
    setup: { env: ['AISSTREAM_API_KEY'], hint: { tr: 'Anahtar gerekir', en: 'Needs a key' } },
    fetch: async () => [],
  };

  it('stay switched off with a hint until the key is set', () => {
    const off = new Store([layer], [keyed], new Set(), Date.now, {});
    expect(off.isDisabled('aisstream')).toBe(true);
    expect(off.sourceHealth('aisstream')).toMatchObject({ status: 'disabled', setupHint: { en: 'Needs a key' } });
    const on = new Store([layer], [keyed], new Set(), Date.now, { AISSTREAM_API_KEY: 'k' });
    expect(on.isDisabled('aisstream')).toBe(false);
    expect(on.sourceHealth('aisstream').setupHint).toBeUndefined();
  });
});

describe('ships (AIS)', () => {
  const t0 = Date.parse('2026-10-06T07:00:00Z');
  const position = (mmsi: number, lat: number, lng: number, sog: number, extra: Record<string, unknown> = {}): AisMessage => ({
    MessageType: 'PositionReport',
    MetaData: { MMSI: mmsi, ShipName: 'TEST SHIP@@@@', latitude: lat, longitude: lng, time_utc: '2026-10-06 07:00:00.123456 +0000 UTC' },
    Message: {
      PositionReport: { UserID: mmsi, Latitude: lat, Longitude: lng, Sog: sog, Cog: 45.5, TrueHeading: 511, NavigationalStatus: 0, ...extra },
    },
  });

  it('reads AISStream times', () => {
    expect(aisTime('2026-10-06 07:00:00.123456 +0000 UTC')).toBe(Date.parse('2026-10-06T07:00:00.123Z'));
    expect(aisTime('nonsense')).toBeUndefined();
  });

  it('groups ship types', () => {
    expect([70, 84, 60, 30, 37, 52, 35, 0].map(shipCategory)).toEqual([
      'cargo',
      'tanker',
      'passenger',
      'fishing',
      'pleasure',
      'service',
      'other',
      'unknown',
    ]);
  });

  it('builds ships from position and static messages', () => {
    const table = new ShipTable();
    expect(table.apply(position(271000001, 41.01, 28.98, 12.4), t0)).toBe(true);
    table.apply(
      {
        MessageType: 'ShipStaticData',
        MetaData: { MMSI: 271000001, time_utc: '2026-10-06 07:01:00 +0000 UTC' },
        Message: {
          ShipStaticData: {
            UserID: 271000001,
            Name: 'DENIZ YILDIZI@@@',
            Type: 70,
            ImoNumber: 9123456,
            CallSign: 'TCAB1',
            Destination: 'ISTANBUL@@',
            Dimension: { A: 150, B: 30, C: 12, D: 16 },
            MaximumStaticDraught: 8.5,
          },
        },
      },
      t0,
    );
    table.apply(position(271000002, 40.0, 26.0, 0, { NavigationalStatus: 1 }), t0);
    expect(table.apply({ MessageType: 'BaseStationReport', MetaData: { MMSI: 1 }, Message: { BaseStationReport: {} } }, t0)).toBe(false);

    const [moving, anchored] = table.features(t0 + 60_000);
    expect(moving!.properties).toMatchObject({
      id: 'ship:271000001',
      title: 'DENIZ YILDIZI',
      kind: 'cargo',
      value: 12.4,
      style: { moving: 1, course: 46 },
    });
    expect(moving!.properties.details).toMatchObject({
      shipType: 'Yük gemisi',
      navStatus: 'Seyirde (makine)',
      speed: '12,4 kn',
      destination: 'ISTANBUL',
      size: '180 × 28 m',
      draught: '8,5 m',
      imo: '9123456',
    });
    expect(anchored!.properties).toMatchObject({ title: 'TEST SHIP', kind: 'unknown', style: { moving: 0, course: 46 } });
    expect(anchored!.properties.details?.navStatus).toBe('Demirde');
  });

  it('drops ships not heard from for 30 minutes', () => {
    const table = new ShipTable();
    table.apply(position(271000003, 41, 29, 5), t0);
    expect(table.features(t0 + 29 * 60_000)).toHaveLength(1);
    expect(table.features(t0 + 31 * 60_000)).toHaveLength(0);
    expect(table.ships.size).toBe(1);
    table.features(t0 + 7 * 3600_000);
    expect(table.ships.size).toBe(0);
  });
});

describe('Straits (KEGM)', () => {
  const today = parseKegmStraits(text('kegm-2026-10-06.html'), '06-10-2026');
  const tomorrow = parseKegmStraits(text('kegm-2026-10-07.html'), '07-10-2026');

  it('reads each strait and direction with its periods in İstanbul time', () => {
    expect(today.map((d) => `${d.strait} ${d.direction}`)).toEqual([
      'İstanbul Boğazı KUZEY-GÜNEY',
      'İstanbul Boğazı GÜNEY-KUZEY',
      'Çanakkale Boğazı KUZEY-GÜNEY',
      'Çanakkale Boğazı GÜNEY-KUZEY',
    ]);
    expect(today[0]!.periods).toEqual([
      { from: '2026-10-05T21:01:00.000Z', to: '2026-10-06T03:40:00.000Z', state: 'suspended' },
      { from: '2026-10-06T03:40:00.000Z', to: '2026-10-06T07:50:00.000Z', state: 'open' },
      { from: '2026-10-06T07:50:00.000Z', to: '2026-10-06T20:59:00.000Z', state: 'suspended' },
    ]);
    expect(tomorrow).toEqual([]);
  });

  it('says what is open now and when it changes', () => {
    expect(stateAt(today[0]!.periods, Date.parse('2026-10-06T05:00:00Z'))).toEqual({
      state: 'open',
      until: '2026-10-06T07:50:00.000Z',
    });
    expect(stateAt(today[0]!.periods, Date.parse('2026-10-06T20:59:30Z')).state).toBe('suspended');
    expect(stateAt(today[0]!.periods, Date.parse('2026-10-06T21:10:00Z')).state).toBe('unplanned');

    // 10:30 in İstanbul: north→south open until 10:50, south→north suspended until 12:40.
    const [ist, can] = straitFeatures([today, tomorrow], new Date('2026-10-06T07:30:00Z'));
    expect(ist!.properties).toMatchObject({
      id: 'strait:istanbul',
      kind: 'partial',
      title: 'İstanbul Boğazı: tek yön açık',
      details: { northToSouth: "açık, 10:50'de askıda", southToNorth: "askıda, 12:40'ta açık" },
    });
    expect(ist!.properties.schedule?.[0]?.periods).toHaveLength(3);
    // Çanakkale at 10:30: north→south suspended (09:00–15:30), south→north suspended (05:30–12:00).
    expect(can!.properties).toMatchObject({ kind: 'suspended', title: 'Çanakkale Boğazı: trafik askıda' });
  });

  it('writes the page date in İstanbul time', () => {
    expect(kegmDate(new Date('2026-10-06T22:30:00Z'))).toBe('07-10-2026');
  });

  it('puts the right Turkish suffix after a time', () => {
    expect(['12:40', '10:50', '06:40', '15:30', '09:00', '12:00', '00:01', '23:59'].map((t) => timeWithSuffix(t, 'locative'))).toEqual([
      "12:40'ta",
      "10:50'de",
      "06:40'ta",
      "15:30'da",
      "09:00'da",
      "12:00'de",
      "00:01'de",
      "23:59'da",
    ]);
    expect(['23:59', '10:50', '12:40', '06:00'].map((t) => timeWithSuffix(t, 'dative'))).toEqual([
      "23:59'a",
      "10:50'ye",
      "12:40'a",
      "06:00'ya",
    ]);
  });
});

describe('fires (NASA FIRMS)', () => {
  it('keeps detections in Türkiye, tagged with their province', () => {
    const viirs = parseFirms(text('firms-viirs.csv'), { id: 'firms-viirs-snpp', name: 'VIIRS (Suomi NPP)', satellites: { N: 'Suomi NPP' } });
    // Russia, Syria and two points across the Meriç in Greece are dropped.
    expect(viirs.map((f) => f.properties.details?.province)).toEqual(['Kocaeli', 'Kocaeli', 'Kocaeli', 'İstanbul', 'Antalya']);
    const antalya = viirs[4]!;
    expect(antalya.properties).toMatchObject({
      title: 'Uydu ısı tespiti: Antalya',
      kind: 'high',
      value: 42.75,
      observedAt: '2026-10-05T10:43:00.000Z',
    });
    expect(antalya.properties.details).toMatchObject({ frp: '42,8 MW', satellite: 'Suomi NPP · VIIRS', dayNight: 'Gündüz' });
  });

  it('reads MODIS percentages as confidence levels', () => {
    const modis = parseFirms(text('firms-modis.csv'), { id: 'firms-modis', name: 'MODIS (Aqua, Terra)', satellites: { A: 'Aqua', T: 'Terra' } });
    expect(modis.map((f) => f.properties.kind)).toEqual(['nominal', 'nominal', 'nominal']);
    expect([10, 'l', 'h', 85, 'n'].map((v) => confidenceLevel(String(v)))).toEqual(['low', 'low', 'high', 'high', 'nominal']);
  });

  it('finds provinces, with a margin for the coast', () => {
    expect(provinceAt(32.85, 39.93)?.name).toBe('Ankara');
    expect(provinceAt(37.15, 36.2)).toBeUndefined();
    expect(provinceAt(26.04475, 41.34918, 15)).toBeUndefined(); // Greece, 26 km from Edirne
    expect(provinceAt(29.1, 41.27, 15)?.name).toBe('İstanbul'); // just off the Black Sea coast
  });
});
