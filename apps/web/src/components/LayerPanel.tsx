import { LAYER_GROUP_NAMES, type LayerGroup, type LayerSummary } from '@durbun/core';
import { t } from '../i18n.ts';
import { shownFeatures, windowFor, windowLabel } from '../lib/filters.ts';
import { timeAgo } from '../lib/format.ts';
import { useNow } from '../lib/useNow.ts';
import { isVisible, useData, useUi } from '../state.ts';

export function LayerPanel() {
  const layers = useData((s) => s.layers);
  const sources = useData((s) => s.sources);
  const collections = useData((s) => s.collections);
  const { lang, visible, setVisible, windows, setWindow, panelOpen, setPage } = useUi();
  const now = useNow(15_000);

  const groups = new Map<LayerGroup, LayerSummary[]>();
  for (const l of layers) groups.set(l.group, [...(groups.get(l.group) ?? []), l]);

  const failing = (l: LayerSummary) =>
    sources.some((s) => s.layer === l.id && (s.status === 'failing' || s.status === 'degraded'));

  return (
    <aside className={`panel layer-panel ${panelOpen ? 'open' : ''}`} aria-label={t(lang, 'layers')}>
      <h2>{t(lang, 'layers')}</h2>
      {[...groups.entries()].map(([group, items]) => (
        <section key={group} className="layer-group">
          <h3>{LAYER_GROUP_NAMES[group][lang]}</h3>
          <ul>
            {items.map((l) => (
              <li key={l.id}>
                <label className="layer-row">
                  <input type="checkbox" checked={isVisible(l, visible)} onChange={(e) => setVisible(l.id, e.target.checked)} />
                  <span className="swatch" style={{ background: l.color }}>
                    {l.glyph}
                  </span>
                  <span className="layer-text">
                    <span className="layer-name">{l.name[lang]}</span>
                    <span className="layer-meta">
                      {l.updatedAt
                        ? `${shownFeatures(l, collections[l.id], windows, now).length} ${t(lang, 'items')} · ${timeAgo(l.updatedAt, lang, now)}`
                        : t(lang, 'noDataYet')}
                      {failing(l) && (
                        <span className="warn" title={t(lang, 'sources')}>
                          {' '}
                          ⚠
                        </span>
                      )}
                    </span>
                    <span className="layer-attr">
                      {t(lang, 'source')}: {l.attribution}
                    </span>
                  </span>
                </label>
                {l.timeWindows && (
                  <div className="window-picker">
                    <span className="muted">{t(lang, 'last')}</span>
                    <div className="segmented small" role="radiogroup" aria-label={t(lang, 'timeWindow')}>
                    {l.timeWindows.options.map((h) => (
                      <button
                        key={h}
                        type="button"
                        role="radio"
                        aria-checked={windowFor(l, windows) === h}
                        className={windowFor(l, windows) === h ? 'active' : ''}
                        onClick={() => setWindow(l.id, h)}
                      >
                        {windowLabel(h, lang)}
                      </button>
                    ))}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <button type="button" className="link-button panel-footer" onClick={() => setPage('sources')}>
        {t(lang, 'sources')} →
      </button>
    </aside>
  );
}
