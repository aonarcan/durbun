import { point, type Feature, type ScheduleRow } from '@durbun/core';
import type { SourceDefinition } from '../kit/source.ts';
import { istanbulTimeToIso, timeWithSuffix } from '../kit/text.ts';

/**
 * When ship traffic through the İstanbul and Çanakkale straits is open or
 * suspended, per direction, as published by the Directorate General of Coastal
 * Safety (KEGM). The page answers Turkish connections only.
 */

export type StraitState = 'open' | 'suspended' | 'unplanned';

export interface StraitDirection {
  strait: string;
  /** "KUZEY-GÜNEY" or "GÜNEY-KUZEY". */
  direction: string;
  periods: { from: string; to: string; state: StraitState }[];
}

const STRAITS: Record<string, { id: string; at: [number, number] }> = {
  'İstanbul Boğazı': { id: 'istanbul', at: [29.0563, 41.0849] },
  'Çanakkale Boğazı': { id: 'canakkale', at: [26.3986, 40.1528] },
};

const DIRECTION_LABELS: Record<string, string> = {
  'KUZEY-GÜNEY': 'Kuzey → Güney',
  'GÜNEY-KUZEY': 'Güney → Kuzey',
};

const STATE_WORDS: Record<StraitState, string> = { open: 'açık', suspended: 'askıda', unplanned: 'planlanmamış' };

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** "06-10-2026" for the KEGM page's Date parameter, in İstanbul's calendar. */
export function kegmDate(d: Date): string {
  const [y, m, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d).split('-');
  return `${day}-${m}-${y}`;
}

/** One day's page → each strait direction with its periods (as ISO times). */
export function parseKegmStraits(html: string, date: string): StraitDirection[] {
  const [day, month, year] = date.split('-');
  const iso = (hhmm: string) => istanbulTimeToIso(`${year}-${month}-${day}T${hhmm}`)!;
  const out: StraitDirection[] = [];
  let strait = '';
  for (const item of html.split(/<div class="item">/).slice(1)) {
    const h3 = /<h3>([\s\S]*?)<\/h3>/.exec(item);
    if (h3) strait = strip(h3[1]!);
    const dir = /<div class="text_mini_title">([\s\S]*?)<\/div>/.exec(item);
    if (!strait || !dir) continue;
    const periods = [...item.matchAll(/<div class="traffic_info">([\s\S]*?)<\/div>/g)].flatMap((m) => {
      const line = strip(m[1]!);
      const t = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s+(.*)$/.exec(line);
      if (!t) return [];
      const state: StraitState = /ask[ıi]/i.test(t[3]!) ? 'suspended' : /açık|open/i.test(t[3]!) ? 'open' : 'unplanned';
      return [{ from: iso(t[1]!), to: iso(t[2]!), state }];
    });
    out.push({ strait, direction: strip(dir[1]!), periods });
  }
  return out;
}

/** State at a moment: inside a period, or "unplanned" between and outside them. */
export function stateAt(periods: StraitDirection['periods'], t: number): { state: StraitState; until?: string } {
  for (const p of periods) {
    // Periods end at 23:59; the last minute of the day belongs to the period too.
    if (t >= Date.parse(p.from) && t < Date.parse(p.to) + 60_000) return { state: p.state, until: p.to };
  }
  return { state: 'unplanned' };
}

const clock = (iso: string) =>
  new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Today's and tomorrow's directions → one feature per strait. */
export function straitFeatures(days: StraitDirection[][], now: Date): Feature[] {
  const byStrait = new Map<string, Map<string, StraitDirection['periods']>>();
  for (const day of days)
    for (const d of day) {
      const dirs = byStrait.get(d.strait) ?? new Map<string, StraitDirection['periods']>();
      dirs.set(d.direction, [...(dirs.get(d.direction) ?? []), ...d.periods]);
      byStrait.set(d.strait, dirs);
    }
  const out: Feature[] = [];
  for (const [name, dirs] of byStrait) {
    const place = STRAITS[name];
    if (!place) continue;
    const t = now.getTime();
    const states: StraitState[] = [];
    const schedule: ScheduleRow[] = [];
    const details: Record<string, string | null> = {};
    for (const [direction, periods] of dirs) {
      const label = DIRECTION_LABELS[direction] ?? direction;
      const { state, until } = stateAt(periods, t);
      states.push(state);
      // When the current state ends, skip ahead past periods with the same state.
      let end = until;
      for (const p of periods) if (end && p.from === end && p.state === state) end = p.to;
      const next = end ? periods.find((p) => p.from === end && p.state !== state) : undefined;
      const summary = `${STATE_WORDS[state]}${
        next
          ? `, ${timeWithSuffix(clock(next.from), 'locative')} ${STATE_WORDS[next.state]}`
          : end && state !== 'unplanned'
            ? `, ${timeWithSuffix(clock(end), 'dative')} kadar`
            : ''
      }`;
      details[direction === 'KUZEY-GÜNEY' ? 'northToSouth' : 'southToNorth'] = summary;
      schedule.push({ label, periods: periods.map((p) => ({ from: p.from, to: p.to, state: p.state })) });
    }
    const kind = states.every((s) => s === 'open')
      ? 'open'
      : states.every((s) => s === 'suspended')
        ? 'suspended'
        : states.some((s) => s === 'open')
          ? 'partial'
          : 'unplanned';
    const headline = { open: 'trafiğe açık', suspended: 'trafik askıda', partial: 'tek yön açık', unplanned: 'plan yok' }[kind];
    const id = `strait:${place.id}`;
    out.push({
      type: 'Feature',
      id,
      geometry: point(place.at[0], place.at[1]),
      properties: {
        id,
        layer: 'straits',
        source: 'kegm-straits',
        title: `${name}: ${headline}`,
        kind,
        schedule,
        details,
      },
    });
  }
  return out;
}

export const kegmStraits: SourceDefinition = {
  id: 'kegm-straits',
  name: { tr: 'KEGM Türk Boğazları trafik saatleri', en: 'KEGM Turkish Straits traffic hours' },
  layer: 'straits',
  homepage: 'https://www.kiyiemniyeti.gov.tr/bogaz_trafigi',
  intervalSec: 5 * 60,
  requiresTurkishIp: true,
  async fetch({ http, signal, now }) {
    const today = kegmDate(now);
    const tomorrow = kegmDate(new Date(now.getTime() + 24 * 3600_000));
    const [a, b] = await Promise.all(
      [today, tomorrow].map((d) => http.getText(`https://www.kiyiemniyeti.gov.tr/bogaz_trafigi?Date=${d}`, { signal })),
    );
    const days = [parseKegmStraits(a!, today), parseKegmStraits(b!, tomorrow)];
    if (days[0]!.length === 0 && !/Trafik Bilgisi Bulunamad/i.test(a!)) {
      throw new Error('KEGM page changed: no strait schedule found');
    }
    return straitFeatures(days, now);
  },
};
