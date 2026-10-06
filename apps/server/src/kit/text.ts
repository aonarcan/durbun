/** Helpers for the formats Turkish sources use. */

const NAIVE_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * A timestamp without a zone, written in Türkiye's local time (UTC+3 all year
 * since 2016), to ISO 8601 UTC. Returns undefined when it can't be read.
 */
export function istanbulTimeToIso(value: string | null | undefined): string | undefined {
  return naiveToIso(value, '+03:00');
}

/** A timestamp without a zone that the source writes in UTC. */
export function utcTimeToIso(value: string | null | undefined): string | undefined {
  return naiveToIso(value, 'Z');
}

function naiveToIso(value: string | null | undefined, zone: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const withZone = NAIVE_DATE_TIME.test(trimmed) ? trimmed + zone : trimmed;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** "DENİZ ECZANESİ" → "Deniz Eczanesi", with Turkish İ/ı rules. */
export function turkishTitleCase(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/(^|[\s\-/(.])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('tr-TR'))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Number from a string like "41.0366" or "41,0366"; undefined for blanks. */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const n = Number(value.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

const UNITS = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli'];

/** The last word of a clock time read aloud in Turkish ("12:40" → "kırk", "09:00" → "dokuz"). */
function lastSpokenWord(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const n = m === 0 ? h : m;
  if (n % 10 !== 0) return UNITS[n % 10]!;
  return n === 0 ? 'sıfır' : TENS[n / 10]!;
}

/**
 * A clock time with the Turkish locative ("12:40'ta", "10:50'de") or dative
 * ("23:59'a", "10:50'ye") suffix, which follows how the number is read aloud.
 */
export function timeWithSuffix(hhmm: string, kind: 'locative' | 'dative'): string {
  const word = lastSpokenWord(hhmm);
  const vowels = word.match(/[aeıioöuü]/g) ?? ['e'];
  const back = 'aıou'.includes(vowels[vowels.length - 1]!);
  const last = word[word.length - 1]!;
  const endsInVowel = 'aeıioöuü'.includes(last);
  if (kind === 'locative') {
    const hard = 'fstkçşhp'.includes(last);
    return `${hhmm}'${hard ? 't' : 'd'}${back ? 'a' : 'e'}`;
  }
  return `${hhmm}'${endsInVowel ? 'y' : ''}${back ? 'a' : 'e'}`;
}
