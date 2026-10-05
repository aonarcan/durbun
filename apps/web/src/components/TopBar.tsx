import { t, type StringKey } from '../i18n.ts';
import { useData, useUi, type ViewMode } from '../state.ts';

const VIEWS: { id: ViewMode; label: StringKey }[] = [
  { id: 'map', label: 'viewMap' },
  { id: 'satellite', label: 'viewSatellite' },
  { id: 'dark', label: 'viewDark' },
  { id: '3d', label: 'view3d' },
];

export function TopBar() {
  const { view, setView, lang, setLang, page, setPage, panelOpen, setPanelOpen } = useUi();
  const connected = useData((s) => s.connected);

  return (
    <header className="topbar">
      {page === 'map' && (
        <button
          type="button"
          className="icon-button only-narrow"
          aria-label={t(lang, 'layers')}
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          ☰
        </button>
      )}
      <a
        className="brand"
        href="#/"
        onClick={(e) => {
          e.preventDefault();
          setPage('map');
        }}
      >
        <img src="/favicon.svg" alt="" width={28} height={28} />
        <span className="brand-name">Dürbün</span>
        <span className="brand-tagline">{t(lang, 'appTagline')}</span>
      </a>

      {page === 'map' && (
        <div className="segmented" role="radiogroup" aria-label="Görünüm / View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={view === v.id}
              className={view === v.id ? 'active' : ''}
              onClick={() => setView(v.id)}
            >
              {t(lang, v.label)}
            </button>
          ))}
        </div>
      )}

      <div className="topbar-end">
        <span className={`live-dot ${connected ? 'on' : 'off'}`} title={t(lang, connected ? 'live' : 'offline')}>
          <span className="dot" />
          <span className="live-text">{t(lang, connected ? 'live' : 'offline')}</span>
        </span>
        <button
          type="button"
          className="link-button"
          onClick={() => setPage(page === 'sources' ? 'map' : 'sources')}
        >
          {t(lang, page === 'sources' ? 'backToMap' : 'sources')}
        </button>
        <button
          type="button"
          className="lang-button"
          aria-label="Dil / Language"
          onClick={() => setLang(lang === 'tr' ? 'en' : 'tr')}
        >
          {lang === 'tr' ? 'EN' : 'TR'}
        </button>
      </div>
    </header>
  );
}
