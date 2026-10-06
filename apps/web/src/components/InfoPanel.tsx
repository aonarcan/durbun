import { distanceKm, pointOf, type Airport, type TrackAnswer } from '@durbun/core';
import type { ReactNode } from 'react';
import { DETAIL_LABELS, KIND_LABELS, t } from '../i18n.ts';
import { clockTime, dateTime, distance, timeAgo } from '../lib/format.ts';
import { featureCentre, trackBounds, trackStats } from '../lib/mapLayers.ts';
import { useNow } from '../lib/useNow.ts';
import { useData, useTracks, useUi } from '../state.ts';
import { Directions } from './Directions.tsx';
import type { FlyDetail } from './MapView.tsx';
import { QuakeDetails } from './QuakeDetails.tsx';
import { StraitsCard } from './StraitsCard.tsx';

/** Details of the clicked feature. */
export function InfoPanel() {
  const selectedId = useUi((s) => s.selectedId);
  const select = useUi((s) => s.select);
  const lang = useUi((s) => s.lang);
  const feature = useData((s) => (selectedId ? s.byId.get(selectedId) : undefined));
  const source = useData((s) => s.sources.find((x) => x.id === feature?.properties.source));
  const group = useData((s) => s.layers.find((l) => l.id === feature?.properties.layer)?.group);
  const path = useTracks((s) => (s.selected && s.selected.id === selectedId ? s.selected : undefined));
  const track = path?.points;
  const now = useNow(30_000);

  if (!feature) return null;
  const p = feature.properties;
  const title = lang === 'en' && p.titleEn ? p.titleEn : p.title;
  const text = lang === 'en' && p.textEn ? p.textEn : p.text;
  const coords = pointOf(feature);
  const centre = featureCentre(feature);

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
          <Row label={t(lang, p.validUntil ? 'starts' : 'observedAt')}>
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
        {path?.route ? (
          <>
            <Row label={t(lang, 'departure')}>
              <span title={path.route.from.name}>{airportName(path.route.from)}</span>
              {path.takeoffAt && <span className="muted"> · {clockTime(new Date(path.takeoffAt).toISOString(), lang)}</span>}
            </Row>
            <Row label={t(lang, 'destination')}>
              <span title={path.route.to.name}>{airportName(path.route.to)}</span>
              {coords && (
                <span className="muted">
                  {' '}
                  · {distance(distanceKm(coords, [path.route.to.lng, path.route.to.lat]) * 1000, lang)} {t(lang, 'toGo')}
                </span>
              )}
            </Row>
          </>
        ) : (
          path?.takeoffAt && <Row label={t(lang, 'departure')}>{clockTime(new Date(path.takeoffAt).toISOString(), lang)}</Row>
        )}
        {track && track.length > 1 && (
          <Row label={t(lang, path?.fromGround ? 'flightSoFar' : 'knownPath')}>
            {pathSummary(track, lang)}
          </Row>
        )}
        {coords && (
          <Row label={t(lang, 'coordinates')}>
            {coords[1].toFixed(5)}, {coords[0].toFixed(5)}
          </Row>
        )}
      </dl>
      {path && p.layer === 'aircraft' && track && track.length > 1 && <p className="muted small-text path-note">{pathNote(path, lang)}</p>}
      <div className="info-actions">
        {p.url && (
          <a className="button" href={p.url} target="_blank" rel="noreferrer">
            {t(lang, 'openStory')}
          </a>
        )}
        {centre && (
          <button
            type="button"
            className="button"
            onClick={() => {
              const detail: FlyDetail = centre.area ? [centre.lng, centre.lat, 7.5] : [centre.lng, centre.lat];
              window.dispatchEvent(new CustomEvent('durbun:fly', { detail }));
            }}
          >
            {t(lang, 'zoomHere')}
          </button>
        )}
        {track && track.length > 1 && (
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              const bounds = trackBounds(track, path?.route);
              if (bounds) window.dispatchEvent(new CustomEvent('durbun:fit', { detail: bounds }));
            }}
          >
            {t(lang, 'showWholePath')}
          </button>
        )}
        {source && !p.url && (
          <a className="button secondary" href={source.homepage} target="_blank" rel="noreferrer">
            {t(lang, 'openSource')}: {source.name[lang]}
          </a>
        )}
      </div>
      {p.layer === 'earthquakes' && <QuakeDetails feature={feature} />}
      {p.layer === 'straits' && <StraitsCard feature={feature} />}
      {group === 'places' && <Directions feature={feature} />}
    </aside>
  );
}

/** "1 sa 12 dk · 312 km" for a path. */
function pathSummary(points: Parameters<typeof trackStats>[0], lang: 'tr' | 'en'): string {
  const { km, ms } = trackStats(points);
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const [hu, mu] = lang === 'tr' ? ['sa', 'dk'] : ['h', 'min'];
  const time = h ? `${h} ${hu}${m ? ` ${m} ${mu}` : ''}` : `${m} ${mu}`;
  return `${time} · ${distance(km * 1000, lang)}`;
}

/** "Antalya (AYT)". */
function airportName(a: Airport): string {
  return `${a.city ?? a.name} (${a.iata ?? a.icao})`;
}

/** Where the path came from, and what the dashed lines mean. */
function pathNote(path: TrackAnswer, lang: 'tr' | 'en'): string {
  const sources = [...(path.sources ?? []), 'Dürbün'].join(', ');
  const route = path.route ? `; ${t(lang, 'routeData')}: adsb.im` : '';
  return `${t(lang, 'pathData')}: ${sources}${route}. ${t(lang, 'dashedUnseen')}${path.route ? t(lang, 'dashedRest') : ''}.`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dl-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
