import { circlePolygon, type Feature } from '@durbun/core';
import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n.ts';
import { shownFeatures } from '../lib/filters.ts';
import { clockTime, timeAgo } from '../lib/format.ts';
import { lineBounds } from '../lib/mapLayers.ts';
import { afadEventUrl, quakeFocus, type ProvinceFeature } from '../lib/quake.ts';
import { useNow } from '../lib/useNow.ts';
import { loadProvinces, useData, useFilters, useFocus, useUi } from '../state.ts';

/** Asks the map (2D or 3D) to show a whole area. */
export function fitTo(bounds: [number, number, number, number]): void {
  window.dispatchEvent(new CustomEvent('durbun:fit', { detail: bounds }));
}

/** Bounds of a circle around a point, for framing an earthquake's outer ring. */
export function circleBounds(centre: [number, number], km: number): [number, number, number, number] {
  const ring = circlePolygon(centre, km, 32).coordinates[0]!;
  return lineBounds(ring.map((c) => [c[0], c[1]]));
}

// Layers whose items are worth listing near an earthquake: things that happen, not fixed places or weather.
const NEARBY_GROUPS = new Set(['hazards', 'roads', 'transport', 'air-sea', 'news']);

/** The earthquake view: aftershocks, provinces within reach and nearby events, with rings on the map. */
export function QuakeDetails({ feature }: { feature: Feature }) {
  const lang = useUi((s) => s.lang);
  const select = useUi((s) => s.select);
  const layers = useData((s) => s.layers);
  const collections = useData((s) => s.collections);
  const [provinces, setProvinces] = useState<ProvinceFeature[]>([]);
  const [allProvinces, setAllProvinces] = useState(false);
  const filters = useFilters();
  const now = useNow(30_000);

  useEffect(() => {
    let live = true;
    loadProvinces()
      .then((p) => live && setProvinces(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const focus = useMemo(() => {
    const others = layers
      .filter((l) => l.id !== 'earthquakes' && NEARBY_GROUPS.has(l.group) && !l.raster)
      .flatMap((l) => collections[l.id]?.features ?? []);
    return quakeFocus(feature, collections.earthquakes?.features ?? [], provinces, others);
  }, [feature, collections, layers, provinces]);

  // Draw the rings on whichever map is showing; clear them when this panel closes. Only
  // aftershocks the earthquake layer currently shows get a highlight ring on the map.
  const quakeLayer = layers.find((l) => l.id === 'earthquakes');
  const drawn = useMemo(
    () =>
      focus && quakeLayer
        ? { ...focus, aftershocks: shownFeatures(quakeLayer, { type: 'FeatureCollection', features: focus.aftershocks }, filters) }
        : focus,
    [focus, quakeLayer, filters],
  );
  useEffect(() => {
    useFocus.setState({ focus: drawn });
    return () => useFocus.setState({ focus: undefined });
  }, [drawn]);

  if (!focus) return null;
  const eventId = feature.properties.details?.eventId;
  const largest = focus.aftershocks.reduce<Feature | undefined>(
    (best, f) => (!best || (f.properties.value ?? 0) > (best.properties.value ?? 0) ? f : best),
    undefined,
  );
  const outer = focus.rings[focus.rings.length - 1]!.km;
  const shownProvinces = allProvinces ? focus.provinces : focus.provinces.slice(0, 6);

  return (
    <section className="quake-view">
      <h3>{t(lang, 'quakeView')}</h3>

      {focus.mainshock && (
        <p className="small-text mainshock">
          {t(lang, 'maybeAftershockOf')}{' '}
          <button type="button" className="link-button" onClick={() => select(focus.mainshock!.properties.id)}>
            {focus.mainshock.properties.title}
          </button>{' '}
          <span className="muted">({timeAgo(focus.mainshock.properties.observedAt, lang, now)})</span>
        </p>
      )}

      <h4>
        {t(lang, 'aftershocks')}{' '}
        <span className="muted">
          ({focus.aftershockKm} {t(lang, 'aftershocksWithin')})
        </span>
      </h4>
      {focus.aftershocks.length === 0 ? (
        <p className="muted small-text">{t(lang, 'aftershocksNone')}</p>
      ) : (
        <>
          <p className="small-text">
            <strong>{focus.aftershocks.length}</strong>
            {largest && (
              <>
                {' '}
                · {t(lang, 'largest')} M{(largest.properties.value ?? 0).toFixed(1)}
              </>
            )}
          </p>
          <ul className="mini-list">
            {[...focus.aftershocks]
              .reverse()
              .slice(0, 6)
              .map((a) => (
                <li key={a.properties.id}>
                  <button type="button" className="link-button" onClick={() => select(a.properties.id)}>
                    M{(a.properties.value ?? 0).toFixed(1)}
                  </button>{' '}
                  <span className="muted">
                    {clockTime(a.properties.observedAt, lang)} · {timeAgo(a.properties.observedAt, lang, now)}
                  </span>
                </li>
              ))}
          </ul>
        </>
      )}

      {focus.provinces.length > 0 && (
        <>
          <h4>
            {t(lang, 'provincesNear')} <span className="muted">(≤ {outer} km)</span>
          </h4>
          <p className="chips">
            {shownProvinces.map((p) => (
              <span key={p.plate} className={`chip ${p.km === 0 ? 'chip-strong' : ''}`}>
                {p.name}
                <span className="muted"> {p.km === 0 ? t(lang, 'epicentreProvince') : `${p.km} km`}</span>
              </span>
            ))}
            {!allProvinces && focus.provinces.length > shownProvinces.length && (
              <button type="button" className="link-button" onClick={() => setAllProvinces(true)}>
                +{focus.provinces.length - shownProvinces.length}
              </button>
            )}
          </p>
        </>
      )}

      {focus.nearby.length > 0 && (
        <>
          <h4>
            {t(lang, 'nearbyItems')} <span className="muted">(≤ {outer} km)</span>
          </h4>
          <ul className="mini-list">
            {focus.nearby.slice(0, 6).map(({ feature: f, km }) => (
              <li key={f.properties.id}>
                <button type="button" className="link-button" onClick={() => select(f.properties.id)}>
                  {f.properties.title}
                </button>{' '}
                <span className="muted">{km} km</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="muted small-text">{t(lang, 'ringsNote')}</p>
      <div className="info-actions">
        <button type="button" className="button" onClick={() => fitTo(circleBounds(focus.centre, outer))}>
          {t(lang, 'showArea')}
        </button>
        {eventId && (
          <a className="button secondary" href={afadEventUrl(String(eventId))} target="_blank" rel="noreferrer">
            {t(lang, 'afadPage')}
          </a>
        )}
      </div>
    </section>
  );
}
