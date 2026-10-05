import type { Lang } from '../i18n.ts';

const locale = (lang: Lang) => (lang === 'tr' ? 'tr-TR' : 'en-GB');

/** "3 dakika önce" / "3 minutes ago". */
export function timeAgo(iso: string | undefined, lang: Lang, now = Date.now()): string {
  if (!iso) return '';
  // Clocks drift and "now" refreshes on a timer, so treat slightly-future times as now.
  const seconds = Math.min(0, Math.round((new Date(iso).getTime() - now) / 1000)) || 0;
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86_400), 'day');
}

/** Date and time in Türkiye's time zone, whatever the viewer's computer uses. */
export function dateTime(iso: string | undefined, lang: Lang): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale(lang), {
    timeZone: 'Europe/Istanbul',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function duration(ms: number | undefined): string {
  if (ms === undefined) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function interval(sec: number, lang: Lang): string {
  if (sec < 60) return lang === 'tr' ? `${sec} sn` : `${sec} s`;
  if (sec < 3600) return lang === 'tr' ? `${Math.round(sec / 60)} dk` : `${Math.round(sec / 60)} min`;
  return lang === 'tr' ? `${Math.round(sec / 3600)} sa` : `${Math.round(sec / 3600)} h`;
}

/** "850 m" / "4,3 km" (Turkish decimal comma) / "4.3 km". */
export function distance(metres: number, lang: Lang): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  const km = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: metres < 10_000 ? 1 : 0 }).format(metres / 1000);
  return `${km} km`;
}

/** "12 dk" / "1 sa 5 dk" / "12 min" / "1 h 5 min". */
export function travelTime(seconds: number, lang: Lang): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const [hu, mu] = lang === 'tr' ? ['sa', 'dk'] : ['h', 'min'];
  if (h === 0) return `${m} ${mu}`;
  return m === 0 ? `${h} ${hu}` : `${h} ${hu} ${m} ${mu}`;
}
