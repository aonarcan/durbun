import { readFileSync } from 'node:fs';
import { distanceKm } from '@durbun/core';
import { describe, expect, it } from 'vitest';
import { cleanText, feedDate, newsFeatures, parseFeed, placeOf } from '../src/sources/news.ts';

const text = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('feeds', () => {
  it('reads RSS 2.0 with CDATA', () => {
    const items = parseFeed(text('rss-bbc.xml'));
    expect(items).toHaveLength(4);
    expect(items[0]!.title).toBe("Bayraklı Belediyesi'ne operasyon: 45 gözaltı");
    expect(items[0]!.link).toMatch(/^https:\/\/www\.bbc\.com\/turkce\//);
    expect(items[0]!.publishedAt).toBe('2026-10-06T05:19:34.000Z');
  });

  it('reads RSS 1.0 (RDF) with dc:date', () => {
    const items = parseFeed(text('rss-dw.xml'));
    expect(items).toHaveLength(3);
    expect(items[0]!.title).toBe("AYM'den Tayfun Kahraman uyarısı: Uygulanmazsa kaosa sürükler");
    expect(items[0]!.publishedAt).toBe('2026-10-06T06:28:00.000Z');
  });

  it('reads Atom', () => {
    const items = parseFeed(text('rss-ntv.xml'));
    expect(items).toHaveLength(3);
    expect(items[0]!.link).toMatch(/^https:\/\/www\.ntv\.com\.tr\//);
    expect(items[0]!.publishedAt).toBe('2026-10-06T07:00:00.000Z');
  });

  it('copes with odd dates and double-escaped text', () => {
    expect(feedDate('Tue, 06 Oct 2026 07:14:35  Z')).toBe('2026-10-06T07:14:35.000Z');
    expect(feedDate('Tue, 06 Oct 2026 10:14:45 &#x2B;0300')).toBe('2026-10-06T07:14:45.000Z');
    expect(feedDate('yesterday')).toBeUndefined();
    expect(cleanText('CHP&amp;#8217;li <b>başkan</b> &apos;tutuklandı&apos;')).toBe("CHP’li başkan 'tutuklandı'");
    expect(parseFeed(text('rss-milliyet.xml'))[0]!.publishedAt).toBe('2026-10-06T07:14:35.000Z');
    expect(parseFeed(text('rss-sozcu.xml')).length).toBeGreaterThan(0);
  });
});

describe('placing a story', () => {
  const place = (t: string) => placeOf(t)?.name;

  it('finds the first province named in a headline, with suffixes', () => {
    expect(place("Diyarbakır'da sağlıksız 820 kilo iç yağı ele geçirildi")).toBe('Diyarbakır');
    expect(place("İstanbul'da DEAŞ ve El Kaide'ye operasyon")).toBe('İstanbul');
    expect(place('DİYARBAKIR, TÜRKİYE KÜLTÜR YOLU FESTİVALİ’NİN 22. DURAĞI OLACAK')).toBe('Diyarbakır');
    expect(place("Mersin'de başkan ve iki ilçe belediye başkanı tutuklandı; Adana'da da operasyon")).toBe('Mersin');
    expect(place("Elazığ'da deprem")).toBe('Elâzığ');
    expect(place("Urfa'da sel")).toBe('Şanlıurfa');
    expect(place("Kahramanmaraş'ta anma töreni")).toBe('Kahramanmaraş');
  });

  it('leaves ordinary words and names alone', () => {
    expect(place('Ordu ve donanma ortak tatbikat yaptı')).toBeUndefined();
    expect(place('Baş ağrısı için uzmanlar uyardı')).toBeUndefined();
    expect(place("Tokat attı, gözaltına alındı")).toBeUndefined();
    expect(place('Aydın Yılmaz yeni kitabını tanıttı')).toBeUndefined();
    expect(place("Ordu'da fındık hasadı bitti")).toBe('Ordu');
    expect(place('Tokat Valiliği açıklama yaptı')).toBe('Tokat');
    expect(place('Altın güne düşüşle başladı')).toBeUndefined();
    expect(place('konya ovası')).toBeUndefined(); // lower case: not a proper noun here
  });
});

describe('news features', () => {
  const now = new Date('2026-10-06T08:00:00Z');
  const outlet = { id: 'trt', name: 'TRT Haber' };

  it('pins stories that name a province and lists the rest without a place', () => {
    const features = newsFeatures(parseFeed(text('rss-trt.xml')), outlet, now);
    expect(features.length).toBeGreaterThan(3);
    const diyarbakir = features.find((f) => f.properties.title.startsWith('Diyarbakır'))!;
    expect(diyarbakir.geometry?.type).toBe('Point');
    expect(diyarbakir.properties).toMatchObject({ layer: 'news', source: 'news-trt', kind: 'news' });
    expect(diyarbakir.properties.details).toMatchObject({ outlet: 'TRT Haber', province: 'Diyarbakır' });
    expect(diyarbakir.properties.url).toMatch(/^https:\/\/www\.trthaber\.com\//);
    // A few kilometres from Diyarbakır's label point, so pins for one province can separate.
    const [lng, lat] = diyarbakir.geometry!.type === 'Point' ? diyarbakir.geometry!.coordinates : [0, 0];
    const km = distanceKm([lng!, lat!], placeOf('Diyarbakır')!.label);
    expect(km).toBeGreaterThanOrEqual(1.9);
    expect(km).toBeLessThanOrEqual(8.1);
    const gold = features.find((f) => f.properties.title.startsWith('Altın'))!;
    expect(gold.geometry).toBeNull();
  });

  it('drops stories older than two days and repeated links', () => {
    const items = [
      { title: 'Eski haber', link: 'https://example.org/a', publishedAt: '2026-10-03T08:00:00.000Z' },
      { title: 'Yeni haber', link: 'https://example.org/b', publishedAt: '2026-10-06T07:00:00.000Z' },
      { title: 'Yeni haber (tekrar)', link: 'https://example.org/b', publishedAt: '2026-10-06T07:00:00.000Z' },
      { title: 'Gelecekten', link: 'https://example.org/c', publishedAt: '2026-10-06T09:00:00.000Z' },
    ];
    const features = newsFeatures(items, outlet, now);
    expect(features.map((f) => f.properties.title)).toEqual(['Yeni haber', 'Gelecekten']);
    expect(features[1]!.properties.observedAt).toBe(now.toISOString());
  });
});
