import { point, type Feature } from '@durbun/core';
import type { SourceDefinition } from '../kit/source.ts';
import { provinces } from '../provinces.ts';

/**
 * Turkish news from the outlets' public RSS and Atom feeds. Only the
 * headline, a short snippet and the link are kept. A story that names a
 * province in its headline gets a pin there; the rest appear only in the news list.
 */

export interface FeedItem {
  title: string;
  link: string;
  publishedAt?: string;
  summary?: string;
}

/** Outlets, chosen across public, international and private media and across editorial lines. */
export const OUTLETS: { id: string; name: string; url: string; homepage: string }[] = [
  { id: 'aa', name: 'Anadolu Ajansı', url: 'https://www.aa.com.tr/tr/rss/default?cat=guncel', homepage: 'https://www.aa.com.tr/tr' },
  { id: 'trt', name: 'TRT Haber', url: 'https://www.trthaber.com/sondakika_articles.rss', homepage: 'https://www.trthaber.com' },
  { id: 'bbc', name: 'BBC Türkçe', url: 'https://feeds.bbci.co.uk/turkce/rss.xml', homepage: 'https://www.bbc.com/turkce' },
  { id: 'dw', name: 'DW Türkçe', url: 'https://rss.dw.com/rdf/rss-tur-all', homepage: 'https://www.dw.com/tr' },
  { id: 'euronews', name: 'Euronews Türkçe', url: 'https://tr.euronews.com/rss', homepage: 'https://tr.euronews.com' },
  { id: 'hurriyet', name: 'Hürriyet', url: 'https://www.hurriyet.com.tr/rss/anasayfa', homepage: 'https://www.hurriyet.com.tr' },
  { id: 'sabah', name: 'Sabah', url: 'https://www.sabah.com.tr/rss/anasayfa.xml', homepage: 'https://www.sabah.com.tr' },
  { id: 'milliyet', name: 'Milliyet', url: 'https://www.milliyet.com.tr/rss/rssnew/sondakikarss.xml', homepage: 'https://www.milliyet.com.tr' },
  { id: 'haberturk', name: 'Habertürk', url: 'https://www.haberturk.com/rss', homepage: 'https://www.haberturk.com' },
  { id: 'ntv', name: 'NTV', url: 'https://www.ntv.com.tr/son-dakika.rss', homepage: 'https://www.ntv.com.tr' },
  { id: 'cnnturk', name: 'CNN Türk', url: 'https://www.cnnturk.com/feed/rss/all/news', homepage: 'https://www.cnnturk.com' },
  { id: 'sozcu', name: 'Sözcü', url: 'https://www.sozcu.com.tr/feeds-rss-category-sozcu', homepage: 'https://www.sozcu.com.tr' },
  { id: 'cumhuriyet', name: 'Cumhuriyet', url: 'https://www.cumhuriyet.com.tr/rss/son_dakika.xml', homepage: 'https://www.cumhuriyet.com.tr' },
  { id: 'halktv', name: 'Halk TV', url: 'https://halktv.com.tr/service/rss.php', homepage: 'https://halktv.com.tr' },
  { id: 'medyascope', name: 'Medyascope', url: 'https://medyascope.tv/feed/', homepage: 'https://medyascope.tv' },
];

/** Keep stories this recent, and at most this many per outlet. */
const MAX_AGE_MS = 48 * 3600_000;
const MAX_PER_OUTLET = 60;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** XML/HTML entities, CDATA and tags out; whitespace collapsed. */
export function cleanText(raw: string): string {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Entities can be escaped twice (&amp;#8217;), so decode before and after removing tags.
  const decode = (t: string) =>
    t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  s = decode(s);
  s = s.replace(/<[^>]*>/g, ' ');
  s = decode(s);
  return s.replace(/\s+/g, ' ').trim();
}

/** Lenient date reading: RFC 822 (with oddities like "07:14:35  Z") and ISO 8601. */
export function feedDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = cleanText(raw).replace(/\s+/g, ' ');
  s = s.replace(/ Z$/, ' GMT').replace(/ UT$/, ' GMT');
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function tag(block: string, names: string[]): string | undefined {
  for (const name of names) {
    const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
    if (m) return m[1];
  }
  return undefined;
}

/** RSS 2.0, RSS 1.0 (RDF) and Atom → items. */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]!);
  const out: FeedItem[] = [];
  for (const b of blocks) {
    const title = cleanText(tag(b, ['title']) ?? '');
    let link = cleanText(tag(b, ['link']) ?? '');
    // Atom and some RSS feeds (Milliyet) give the link as an attribute: <link href> or <atom:link href>.
    if (!link) link = /<(?:atom:)?link[^>]*\bhref="([^"]+)"/i.exec(b.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ''))?.[1] ?? '';
    if (!link) link = cleanText(tag(b, ['guid']) ?? '');
    if (!title || !/^https?:\/\//.test(link)) continue;
    const publishedAt = feedDate(tag(b, ['pubDate', 'dc:date', 'published', 'updated']));
    const summaryRaw = tag(b, ['description', 'summary', 'content']);
    const summary = summaryRaw ? cleanText(summaryRaw) : '';
    out.push({
      title,
      link,
      ...(publishedAt ? { publishedAt } : {}),
      ...(summary && summary !== title ? { summary: summary.length > 220 ? `${summary.slice(0, 217).trimEnd()}…` : summary } : {}),
    });
  }
  return out;
}

const lower = (s: string) => s.toLocaleLowerCase('tr-TR').normalize('NFC');
const plain = (s: string) => lower(s).replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u');

/** Other names people use for provinces. */
const ALIASES: Record<string, string> = {
  afyon: 'afyonkarahisar',
  antep: 'gaziantep',
  urfa: 'şanlıurfa',
  maraş: 'kahramanmaraş',
  izmit: 'kocaeli',
  içel: 'mersin',
};

/** Province names that are also everyday words or common first names. */
const AMBIGUOUS = new Set(['ordu', 'tokat', 'ağrı', 'aydın', 'batman', 'van']);

let gazetteer: { re: RegExp; plate: number; ambiguous: boolean }[] | undefined;

function buildGazetteer() {
  const byName = new Map<string, number>();
  for (const p of provinces().values()) byName.set(plain(p.name), p.plate);
  for (const [alias, name] of Object.entries(ALIASES)) byName.set(alias, byName.get(name)!);
  // Longer names first, so "Kahramanmaraş" wins over "Maraş".
  return [...byName.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([name, plate]) => ({
      // A whole word, optionally followed by a suffix after an apostrophe ("İzmir'de").
      re: new RegExp(`(^|[^\\p{L}])(${name})(?=$|[^\\p{L}]|['’])(['’]\\p{L}+)?`, 'u'),
      plate,
      ambiguous: AMBIGUOUS.has(name),
    }));
}

/**
 * The province a headline is about: the first province name in it, written
 * with a capital letter. Names that are also ordinary words (Ordu "army",
 * Tokat "slap", Ağrı "pain", Aydın as a first name) count only with a
 * case suffix ("Tokat'ta") or "ili/valiliği/belediyesi" after them.
 */
export function placeOf(text: string): { plate: number; name: string; label: [number, number] } | undefined {
  gazetteer ??= buildGazetteer();
  const hay = plain(text);
  let best: { index: number; plate: number } | undefined;
  for (const g of gazetteer) {
    const m = g.re.exec(hay);
    if (!m) continue;
    const index = m.index + m[1]!.length;
    // Proper nouns start with a capital letter in the original text.
    const first = text.normalize('NFC')[index] ?? '';
    if (first === first.toLocaleLowerCase('tr-TR')) continue;
    if (g.ambiguous) {
      const after = hay.slice(index + m[2]!.length);
      if (!m[3] && !/^\s+(ili|il|valiliği|valisi|belediyesi|merkezli|merkez|gölü)\b/u.test(after)) continue;
    }
    if (!best || index < best.index) best = { index, plate: g.plate };
  }
  if (!best) return undefined;
  const p = provinces().get(best.plate)!;
  return { plate: p.plate, name: p.name, label: p.label };
}

/**
 * Pins for one province would all sit on the same spot and never separate
 * when zooming in, so each story is placed a few kilometres from the
 * province's label point, in a direction fixed by its link.
 */
export function spread(at: [number, number], key: string): [number, number] {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  const angle = ((h % 360) * Math.PI) / 180;
  const km = 2 + ((h >>> 9) % 60) / 10; // 2–8 km
  const lat = at[1] + (km * Math.cos(angle)) / 110.57;
  const lng = at[0] + (km * Math.sin(angle)) / (111.32 * Math.cos((at[1] * Math.PI) / 180));
  return [Number(lng.toFixed(5)), Number(lat.toFixed(5))];
}

/** A feed's items → news features; stories naming a province become pins there. */
export function newsFeatures(items: FeedItem[], outlet: { id: string; name: string }, now: Date): Feature[] {
  const seen = new Set<string>();
  const out: Feature[] = [];
  for (const item of items) {
    const t = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
    if (Number.isFinite(t) && now.getTime() - t > MAX_AGE_MS) continue;
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    const place = placeOf(item.title);
    const at = place ? spread(place.label, item.link) : undefined;
    const id = `news:${outlet.id}:${item.link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 160)}`;
    out.push({
      type: 'Feature',
      id,
      geometry: at ? point(at[0], at[1]) : null,
      properties: {
        id,
        layer: 'news',
        source: `news-${outlet.id}`,
        title: item.title,
        ...(item.summary ? { text: item.summary } : {}),
        kind: 'news',
        // Clocks drift: a story "from the future" is shown as published now.
        ...(Number.isFinite(t) ? { observedAt: new Date(Math.min(t, now.getTime())).toISOString() } : {}),
        url: item.link,
        details: { outlet: outlet.name, province: place?.name ?? null },
      },
    });
    if (out.length >= MAX_PER_OUTLET) break;
  }
  return out;
}

export const newsSources: SourceDefinition[] = OUTLETS.map((o) => ({
  id: `news-${o.id}`,
  name: { tr: `${o.name} haber akışı`, en: `${o.name} news feed` },
  layer: 'news',
  homepage: o.homepage,
  intervalSec: 5 * 60,
  async fetch({ http, signal, now }) {
    const xml = await http.getText(o.url, {
      signal,
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
    });
    const items = parseFeed(xml);
    if (items.length === 0) throw new Error('The feed has no stories (format changed?)');
    return newsFeatures(items, o, now);
  },
}));
