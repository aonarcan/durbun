import type { Feature } from '@durbun/core';
import { useMemo, useState } from 'react';
import { t } from '../i18n.ts';
import { clockTime, timeAgo } from '../lib/format.ts';
import { featureCentre } from '../lib/mapLayers.ts';
import { useNow } from '../lib/useNow.ts';
import { useData, useUi } from '../state.ts';
import type { FlyDetail } from './MapView.tsx';

const PAGE = 60;
const lower = (s: string) => s.toLocaleLowerCase('tr-TR');

/** Latest Turkish headlines from every outlet, newest first, with filters. */
export function NewsList() {
  const lang = useUi((s) => s.lang);
  const select = useUi((s) => s.select);
  const setVisible = useUi((s) => s.setVisible);
  const news = useData((s) => s.collections.news?.features);
  const now = useNow(30_000);
  const [query, setQuery] = useState('');
  const [outlet, setOutlet] = useState('');
  const [placedOnly, setPlacedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const all = useMemo(
    () => [...(news ?? [])].sort((a, b) => (b.properties.observedAt ?? '').localeCompare(a.properties.observedAt ?? '')),
    [news],
  );
  const outlets = useMemo(
    () => [...new Set(all.map((f) => String(f.properties.details?.outlet ?? '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')),
    [all],
  );
  const q = lower(query.trim());
  const shown = all.filter(
    (f) =>
      (!outlet || f.properties.details?.outlet === outlet) &&
      (!placedOnly || f.geometry) &&
      (!q || lower(`${f.properties.title} ${f.properties.text ?? ''}`).includes(q)),
  );

  const showOnMap = (f: Feature) => {
    const c = featureCentre(f);
    if (!c) return;
    setVisible('news', true);
    select(f.properties.id);
    const detail: FlyDetail = [c.lng, c.lat, 9];
    window.dispatchEvent(new CustomEvent('durbun:fly', { detail }));
  };

  return (
    <div className="news-list">
      <div className="news-filters">
        <input
          type="search"
          value={query}
          placeholder={t(lang, 'newsSearch')}
          aria-label={t(lang, 'newsSearch')}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
        />
        <select value={outlet} aria-label={t(lang, 'allOutlets')} onChange={(e) => setOutlet(e.target.value)}>
          <option value="">{t(lang, 'allOutlets')}</option>
          {outlets.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={placedOnly} onChange={(e) => setPlacedOnly(e.target.checked)} /> {t(lang, 'onlyPlaced')}
        </label>
      </div>
      <p className="muted small-text">
        {shown.length} {t(lang, 'stories')}
      </p>
      {shown.length === 0 && <p className="muted">{t(lang, 'noNews')}</p>}
      <ul>
        {shown.slice(0, limit).map((f) => (
          <li key={f.properties.id} className="news-item">
            <div className="news-meta">
              <span className="news-outlet">{String(f.properties.details?.outlet ?? '')}</span>
              {f.properties.observedAt && (
                <span className="muted" title={clockTime(f.properties.observedAt, lang)}>
                  {' '}
                  · {timeAgo(f.properties.observedAt, lang, now)}
                </span>
              )}
            </div>
            <a className="news-title" href={f.properties.url} target="_blank" rel="noreferrer">
              {f.properties.title}
            </a>
            {f.geometry && (
              <button type="button" className="chip chip-button" onClick={() => showOnMap(f)}>
                📍 {String(f.properties.details?.province ?? '')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {shown.length > limit && (
        <button type="button" className="button secondary" onClick={() => setLimit(limit + PAGE)}>
          {t(lang, 'showMore')}
        </button>
      )}
      <p className="muted small-text news-note">{t(lang, 'newsNote')}</p>
    </div>
  );
}
