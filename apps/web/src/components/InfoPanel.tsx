import type { ReactNode } from 'react';
import { DETAIL_LABELS, KIND_LABELS, t } from '../i18n.ts';
import { dateTime, timeAgo } from '../lib/format.ts';
import { useNow } from '../lib/useNow.ts';
import { useData, useUi } from '../state.ts';
import { Directions } from './Directions.tsx';

/** Details of the clicked feature. */
export function InfoPanel() {
  const selectedId = useUi((s) => s.selectedId);
  const select = useUi((s) => s.select);
  const lang = useUi((s) => s.lang);
  const feature = useData((s) => (selectedId ? s.byId.get(selectedId) : undefined));
  const source = useData((s) => s.sources.find((x) => x.id === feature?.properties.source));
  const group = useData((s) => s.layers.find((l) => l.id === feature?.properties.layer)?.group);
  const now = useNow(30_000);

  if (!feature) return null;
  const p = feature.properties;
  const title = lang === 'en' && p.titleEn ? p.titleEn : p.title;
  const text = lang === 'en' && p.textEn ? p.textEn : p.text;
  const coords = feature.geometry.type === 'Point' ? feature.geometry.coordinates : undefined;

  return (
    <aside className="panel info-panel" aria-live="polite">
      <div className="info-head">
        {p.kind && <span className="kind">{KIND_LABELS[p.kind]?.[lang] ?? p.kind}</span>}
        <button type="button" className="icon-button" aria-label={t(lang, 'close')} onClick={() => select(undefined)}>
          ✕
        </button>
      </div>
      <h2>{title}</h2>
      {text && text !== title && <p className="info-text">{text}</p>}
      <dl>
        {p.observedAt && (
          <Row label={t(lang, 'observedAt')}>
            {dateTime(p.observedAt, lang)} <span className="muted">({timeAgo(p.observedAt, lang, now)})</span>
          </Row>
        )}
        {p.validUntil && <Row label={t(lang, 'validUntil')}>{dateTime(p.validUntil, lang)}</Row>}
        {Object.entries(p.details ?? {})
          .filter(([, v]) => v !== null && v !== '')
          .map(([k, v]) => (
            <Row key={k} label={DETAIL_LABELS[k]?.[lang] ?? k}>
              {k === 'phone' ? <a href={`tel:${String(v).replace(/\s/g, '')}`}>{String(v)}</a> : String(v)}
            </Row>
          ))}
        {coords && (
          <Row label={t(lang, 'coordinates')}>
            {coords[1].toFixed(5)}, {coords[0].toFixed(5)}
          </Row>
        )}
      </dl>
      <div className="info-actions">
        {coords && (
          <button
            type="button"
            className="button"
            onClick={() => window.dispatchEvent(new CustomEvent('durbun:fly', { detail: [coords[0], coords[1]] }))}
          >
            {t(lang, 'zoomHere')}
          </button>
        )}
        {source && (
          <a className="button secondary" href={source.homepage} target="_blank" rel="noreferrer">
            {t(lang, 'openSource')}: {source.name[lang]}
          </a>
        )}
      </div>
      {group === 'places' && <Directions feature={feature} />}
    </aside>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dl-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
