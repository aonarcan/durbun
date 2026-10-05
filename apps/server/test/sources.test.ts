import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { afadUrl, parseAfadEvents, type AfadEvent } from '../src/sources/afad-earthquakes.ts';
import { parseIbbAnnouncements, type IbbAnnouncement } from '../src/sources/ibb-incidents.ts';
import { parseIbbPharmacies, type IbbPharmacy, type IbbPharmacyResponse } from '../src/sources/ibb-pharmacies.ts';

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;

describe('AFAD earthquakes', () => {
  const events = fixture<AfadEvent[]>('afad-events.json');
  const features = parseAfadEvents(events);

  it('keeps events with coordinates and drops the blank one', () => {
    expect(events).toHaveLength(7);
    expect(features).toHaveLength(6);
  });

  it('reads AFAD times as UTC', () => {
    const first = features[0]!;
    expect(first.properties.observedAt).toBe('2026-10-05T17:46:06.000Z');
  });

  it('puts magnitude in the title and value, lng before lat', () => {
    const first = features[0]!;
    expect(first.properties.title).toBe('M1.9 Sındırgı (Balıkesir)');
    expect(first.properties.value).toBe(1.9);
    expect(first.geometry.coordinates).toEqual([28.145, 39.20517]);
  });

  it('asks for the last 7 days, newest first', () => {
    const url = afadUrl(new Date('2026-10-05T18:00:00Z'));
    expect(url).toContain('start=2026-09-28T18:00:00');
    expect(url).toContain('end=2026-10-05T18:00:00');
    expect(url).toContain('orderby=timedesc');
  });
});

describe('İBB traffic notices', () => {
  const items = fixture<IbbAnnouncement[]>('ibb-announcements.json');
  const features = parseIbbAnnouncements(items);

  it('drops notices without coordinates', () => {
    expect(items).toHaveLength(6);
    expect(features).toHaveLength(5);
  });

  it('reads "lat,lng" coordinates and İstanbul local times', () => {
    const first = features[0]!;
    expect(first.geometry.coordinates).toEqual([29.151041, 41.036617]);
    expect(first.properties.observedAt).toBe('2026-10-05T17:36:28.000Z');
    expect(first.properties.validUntil).toBe('2026-10-05T18:05:00.000Z');
  });

  it('maps İBB notice types to kinds', () => {
    const kinds = features.map((f) => f.properties.kind);
    expect(kinds).toContain('accident');
    expect(kinds).toContain('breakdown');
    expect(kinds).toContain('roadworks');
    expect(features[0]!.properties.details?.cameraId).toBe(481);
  });
});

describe('İBB on-duty pharmacies', () => {
  const body = fixture<IbbPharmacyResponse>('ibb-pharmacies.json');

  it('title-cases names with Turkish letters', () => {
    const features = parseIbbPharmacies(body);
    expect(features).toHaveLength(4);
    expect(features[0]!.properties.title).toBe('Deniz Eczanesi');
    expect(features[0]!.properties.details?.district).toBe('Adalar');
  });

  it('accepts a single pharmacy sent as an object', () => {
    const list = body.ArrayOfAramaList!.AramaList as IbbPharmacy[];
    const single: IbbPharmacyResponse = { ArrayOfAramaList: { AramaList: list[0]! } };
    expect(parseIbbPharmacies(single)).toHaveLength(1);
  });

  it('returns nothing for an empty response', () => {
    expect(parseIbbPharmacies({})).toEqual([]);
  });
});
