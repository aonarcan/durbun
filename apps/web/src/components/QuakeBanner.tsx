import { useState } from 'react';
import { t } from '../i18n.ts';
import { timeAgo } from '../lib/format.ts';
import { notableQuake, ringsFor } from '../lib/quake.ts';
import { useNow } from '../lib/useNow.ts';
import { useData, useUi } from '../state.ts';
import { circleBounds, fitTo } from './QuakeDetails.tsx';

/** A strip at the top of the map when an M4.5+ earthquake happened in the last six hours. */
export function QuakeBanner() {
  const quakes = useData((s) => s.collections.earthquakes?.features);
  const lang = useUi((s) => s.lang);
  const selectedId = useUi((s) => s.selectedId);
  const now = useNow(30_000);
  const [dismissed, setDismissed] = useState<string | undefined>();

  const q = notableQuake(quakes ?? [], now);
  if (!q || q.geometry.type !== 'Point' || q.properties.id === dismissed || q.properties.id === selectedId) return null;
  const [lng, lat] = q.geometry.coordinates;
  const m = q.properties.value ?? 0;

  const show = () => {
    const ui = useUi.getState();
    ui.setVisible('earthquakes', true);
    ui.select(q.properties.id);
    const radii = ringsFor(m);
    fitTo(circleBounds([lng, lat], radii[radii.length - 1]!));
  };

  return (
    <div className="quake-banner" role="status">
      <span className="quake-banner-mag">M{m.toFixed(1)}</span>
      <span className="quake-banner-text">
        <strong>{q.properties.details?.location ?? q.properties.title}</strong>
        <span className="muted"> · {timeAgo(q.properties.observedAt, lang, now)}</span>
      </span>
      <button type="button" className="button" onClick={show}>
        {t(lang, 'show')}
      </button>
      <button type="button" className="icon-button" aria-label={t(lang, 'dismiss')} onClick={() => setDismissed(q.properties.id)}>
        ✕
      </button>
    </div>
  );
}
