import { isValidLngLat, point, type Feature } from '@durbun/core';
import type { SourceDefinition } from '../kit/source.ts';
import { toNumber, utcTimeToIso } from '../kit/text.ts';

/** One event as AFAD's event API returns it (all values are strings). */
export interface AfadEvent {
  eventID: string;
  location: string;
  latitude: string;
  longitude: string;
  depth: string;
  type: string;
  magnitude: string;
  country?: string;
  province?: string | null;
  district?: string | null;
  neighborhood?: string | null;
  date: string;
  rms?: string;
  isEventUpdate?: boolean;
  lastUpdateDate?: string | null;
}

const API = 'https://servisnet.afad.gov.tr/apigateway/deprem/apiv2/event/filter';
const DAYS = 7;

export function afadUrl(now: Date): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  const start = new Date(now.getTime() - DAYS * 24 * 3600 * 1000);
  return `${API}?start=${fmt(start)}&end=${fmt(now)}&orderby=timedesc`;
}

/** AFAD's event list to features. AFAD's "date" is UTC without a zone. */
export function parseAfadEvents(events: AfadEvent[]): Feature[] {
  const out: Feature[] = [];
  for (const e of events) {
    const lat = toNumber(e.latitude);
    const lng = toNumber(e.longitude);
    const mag = toNumber(e.magnitude);
    if (lat === undefined || lng === undefined || !isValidLngLat(lng, lat) || mag === undefined) continue;
    const depth = toNumber(e.depth);
    const observedAt = utcTimeToIso(e.date);
    out.push({
      type: 'Feature',
      id: `afad:${e.eventID}`,
      geometry: point(lng, lat),
      properties: {
        id: `afad:${e.eventID}`,
        layer: 'earthquakes',
        source: 'afad-earthquakes',
        title: `M${mag.toFixed(1)} ${e.location}`,
        kind: 'earthquake',
        value: mag,
        ...(observedAt ? { observedAt } : {}),
        details: {
          magnitude: `${mag.toFixed(1)} ${e.type}`,
          depthKm: depth ?? null,
          location: e.location,
          neighbourhood: e.neighborhood || null,
          eventId: e.eventID,
        },
      },
    });
  }
  return out;
}

export const afadEarthquakes: SourceDefinition = {
  id: 'afad-earthquakes',
  name: { tr: 'AFAD deprem listesi', en: 'AFAD earthquake list' },
  layer: 'earthquakes',
  homepage: 'https://deprem.afad.gov.tr/last-earthquakes',
  intervalSec: 60,
  async fetch({ http, signal, now }) {
    const events = await http.getJson<AfadEvent[]>(afadUrl(now), { signal });
    if (!Array.isArray(events)) throw new Error('AFAD returned something other than a list');
    return parseAfadEvents(events);
  },
};
