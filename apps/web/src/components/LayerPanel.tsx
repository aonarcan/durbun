import { LAYER_GROUP_NAMES, type LayerGroup, type LayerSummary } from '@durbun/core';
import { t } from '../i18n.ts';
import { minValueFor, minValueLabel, shownFeatures, windowFor, windowLabel } from '../lib/filters.ts';
import { clockTime, timeAgo } from '../lib/format.ts';
import { useNow } from '../lib/useNow.ts';
import { isVisible, useData, useFilters, useUi } from '../state.ts';
import { NewsList } from './NewsList.tsx';

export function LayerPanel() {
  const layers = useData((s) => s.layers);
  const sources = useData((s) => s.sources);
  const collections = useData((s) => s.collections);
  const {
    lang,
    visible,
    setVisible,
    windows,
    setWindow,
    minValues,
    setMinValue,
    panelOpen,
    setPage,
    panelTab,
    setPanelTab,
    trails,
    setTrails,
    camera,
  } = useUi();
  const newsCount = useData((s) => s.collections.news?.features.length ?? 0);
  const filters = useFilters();
  const now = useNow(15_000);

  const groups = new Map<LayerGroup, LayerSummary[]>();
  for (const l of layers) groups.set(l.group, [...(groups.get(l.group) ?? []), l]);

  const failing = (l: LayerSummary) =>
    sources.some((s) => s.layer === l.id && (s.status === 'failing' || s.status === 'degraded'));

  /** A layer whose every source waits for a key: say what it needs instead of "no data". */
  const setupHint = (l: LayerSummary) => {
    const own = sources.filter((s) => s.layer === l.id);
    return own.length > 0 && own.every((s) => s.setupHint) ? own[0]!.setupHint![lang] : undefined;
  };

  const meta = (l: LayerSummary): string => {
    const hint = setupHint(l);
    if (hint) return hint;
    if (l.raster) {
      const frames = l.raster.frames;
      const newest = frames[frames.length - 1]?.time;
      if (frames.length > 1 && newest)
        return `${t(lang, 'latestImage')} ${clockTime(newest, lang)} · ${timeAgo(newest, lang, now)}`;
      return t(lang, 'liveImagery');
    }
    if (!l.updatedAt) return t(lang, 'noDataYet');
    if (l.listed) {
      const items = shownFeatures(l, collections[l.id], filters, now);
      return `${items.length} ${t(lang, 'stories')} · ${items.filter((f) => f.geometry).length} ${t(lang, 'onMap')} · ${timeAgo(l.updatedAt, lang, now)}`;
    }
    // Lazy layers (every bus, every stop) aren't loaded while off: show the server's count.
    const count = collections[l.id] ? shownFeatures(l, collections[l.id], filters, now).length : l.count;
    const zoomHint = l.minZoom && isVisible(l, visible) && camera.zoom < l.minZoom ? ` · ${t(lang, 'zoomToSee')}` : '';
    return `${count.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-GB')} ${t(lang, 'items')} · ${timeAgo(l.updatedAt, lang, now)}${zoomHint}`;
  };

  return (
    <aside className={`panel layer-panel ${panelOpen ? 'open' : ''}`} aria-label={t(lang, 'layers')}>
      <div className="panel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'layers'}
          className={panelTab === 'layers' ? 'active' : ''}
          onClick={() => setPanelTab('layers')}
        >
          {t(lang, 'tabLayers')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panelTab === 'news'}
          className={panelTab === 'news' ? 'active' : ''}
          onClick={() => setPanelTab('news')}
        >
          {t(lang, 'tabNews')} {newsCount > 0 && <span className="tab-count">{newsCount}</span>}
        </button>
      </div>
      {panelTab === 'news' ? (
        <NewsList />
      ) : (
        <>
          {[...groups.entries()].map(([group, items]) => (
            <section key={group} className="layer-group">
              <h3>{LAYER_GROUP_NAMES[group][lang]}</h3>
              <ul>
                {items.map((l) => (
                  <li key={l.id}>
                    <label className="layer-row">
                      <input
                        type="checkbox"
                        checked={isVisible(l, visible)}
                        onChange={(e) => setVisible(l.id, e.target.checked)}
                      />
                      <span
                        className={`swatch ${l.shape === 'areas' ? 'area' : ''} ${l.raster ? 'image' : ''}`}
                        style={{ background: l.color }}
                      >
                        {l.glyph}
                      </span>
                      <span className="layer-text">
                        <span className="layer-name">{l.name[lang]}</span>
                        <span className="layer-meta">
                          {meta(l)}
                          {failing(l) && !setupHint(l) && (
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
                    {l.timeWindows && isVisible(l, visible) && (
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
                    {l.minValue && isVisible(l, visible) && (
                      <div className="window-picker">
                        <span className="muted">{l.minValue.label}</span>
                        <div className="segmented small" role="radiogroup" aria-label={t(lang, 'minMagnitude')}>
                          {l.minValue.options.map((v) => (
                            <button
                              key={v}
                              type="button"
                              role="radio"
                              aria-checked={minValueFor(l, minValues) === v}
                              className={minValueFor(l, minValues) === v ? 'active' : ''}
                              onClick={() => setMinValue(l.id, v)}
                            >
                              {minValueLabel(v, lang)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {l.shape === 'areas' && isVisible(l, visible) && <WarningLegend lang={lang} />}
                    {l.tracks && isVisible(l, visible) && (
                      <label className="check sub-option">
                        <input
                          type="checkbox"
                          checked={trails[l.id] !== false}
                          onChange={(e) => setTrails(l.id, e.target.checked)}
                        />{' '}
                        {t(lang, 'showTrails')}
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <button type="button" className="link-button panel-footer" onClick={() => setPage('sources')}>
            {t(lang, 'sources')} →
          </button>
        </>
      )}
    </aside>
  );
}

function WarningLegend({ lang }: { lang: 'tr' | 'en' }) {
  return (
    <div className="legend">
      <span>
        <i className="legend-yellow" /> {t(lang, 'levelYellow')}
      </span>
      <span>
        <i className="legend-orange" /> {t(lang, 'levelOrange')}
      </span>
      <span>
        <i className="legend-red" /> {t(lang, 'levelRed')}
      </span>
      <span className="muted">{t(lang, 'fadedIsLater')}</span>
    </div>
  );
}
