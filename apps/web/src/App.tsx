import { lazy, Suspense, useEffect } from 'react';
import { InfoPanel } from './components/InfoPanel.tsx';
import { LayerPanel } from './components/LayerPanel.tsx';
import { MapView } from './components/MapView.tsx';
import { SourcesPage } from './components/SourcesPage.tsx';
import { TopBar } from './components/TopBar.tsx';
import { startLive, useUi } from './state.ts';

// CesiumJS is large, so the 3D view loads only when someone opens it.
const GlobeView = lazy(() => import('./components/GlobeView.tsx'));

export function App() {
  const view = useUi((s) => s.view);
  const page = useUi((s) => s.page);
  const lang = useUi((s) => s.lang);

  useEffect(() => startLive(), []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <div className="app">
      <TopBar />
      {page === 'sources' ? (
        <SourcesPage />
      ) : (
        <div className="stage">
          {view === '3d' ? (
            <Suspense fallback={<div className="map loading">…</div>}>
              <GlobeView />
            </Suspense>
          ) : (
            <MapView view={view} />
          )}
          <LayerPanel />
          <InfoPanel />
        </div>
      )}
    </div>
  );
}
