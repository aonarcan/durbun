import type { Feature } from '@durbun/core';
import { t, type StringKey } from '../i18n.ts';
import { distance, travelTime } from '../lib/format.ts';
import { clearRoute, requestRoute, useRoute, useUi } from '../state.ts';

/** Location failures have their own explanations; anything else came from the router. */
const LOCATE_ERRORS = ['insecure', 'denied', 'unavailable', 'timeout'];

const sameSpot = (a?: [number, number], b?: [number, number]) =>
  Boolean(a && b && Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7);

/** "How do I get there?" for a place: a route on the map, plus a Google Maps hand-off for turn-by-turn. */
export function Directions({ feature }: { feature: Feature }) {
  const lang = useUi((s) => s.lang);
  const route = useRoute();
  if (feature.geometry.type !== 'Point') return null;
  const [lng, lat] = feature.geometry.coordinates;
  const to: [number, number] = [lng, lat];
  const active = sameSpot(route.to, to) && route.status !== 'idle';
  const mode = active ? route.mode : undefined;
  const googleMode = (mode ?? 'car') === 'foot' ? 'walking' : 'driving';
  const google = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${googleMode}`;

  const go = (m: 'car' | 'foot') => void requestRoute(to, feature.properties.title, m);

  return (
    <section className="directions">
      <div className="directions-head">
        <h3>{t(lang, 'directions')}</h3>
        <div className="segmented small" role="radiogroup" aria-label={t(lang, 'directions')}>
          <button type="button" role="radio" aria-checked={mode === 'car'} className={mode === 'car' ? 'active' : ''} onClick={() => go('car')}>
            {t(lang, 'byCar')}
          </button>
          <button type="button" role="radio" aria-checked={mode === 'foot'} className={mode === 'foot' ? 'active' : ''} onClick={() => go('foot')}>
            {t(lang, 'onFoot')}
          </button>
        </div>
      </div>

      {active && route.status === 'locating' && <p className="muted">{t(lang, 'locating')}</p>}
      {active && route.status === 'loading' && <p className="muted">{t(lang, 'routing')}</p>}
      {active && route.status === 'ready' && route.result && (
        <p className="route-summary">
          <strong>{travelTime(route.result.duration, lang)}</strong> · {distance(route.result.distance, lang)}
          {route.result.mode === 'car' && <span className="muted"> · {t(lang, 'noTraffic')}</span>}
          <span className="route-credit">{route.result.provider}</span>
        </p>
      )}
      {active && route.status === 'error' && (
        <p className="route-error">
          {route.error && LOCATE_ERRORS.includes(route.error)
            ? t(lang, `routeErr_${route.error}` as StringKey)
            : `${t(lang, 'routeErr_server')}: ${route.error ?? ''}`}
        </p>
      )}

      <div className="info-actions">
        <a className="button secondary" href={google} target="_blank" rel="noreferrer">
          {t(lang, 'openInGoogle')}
        </a>
        {active && (
          <button type="button" className="button secondary" onClick={clearRoute}>
            {t(lang, 'clearRoute')}
          </button>
        )}
      </div>
    </section>
  );
}
