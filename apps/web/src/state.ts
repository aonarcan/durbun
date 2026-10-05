import type { Feature, FeatureCollection, LayerSummary, ServerEvent, SourceHealth } from '@durbun/core';
import { create } from 'zustand';
import type { Lang } from './i18n.ts';
import { DEFAULT_CAMERA, type CameraState } from './lib/camera.ts';

export type ViewMode = 'map' | 'satellite' | 'dark' | '3d';
export type Page = 'map' | 'sources';

// ---- what the viewer chose (kept in this browser between visits) ----

interface UiState {
  view: ViewMode;
  lang: Lang;
  camera: CameraState;
  /** Layer id → shown. Layers missing here use their defaultOn. */
  visible: Record<string, boolean>;
  selectedId: string | undefined;
  panelOpen: boolean;
  page: Page;
  setView(view: ViewMode): void;
  setLang(lang: Lang): void;
  setCamera(camera: CameraState): void;
  setVisible(layerId: string, on: boolean): void;
  select(id: string | undefined): void;
  setPanelOpen(open: boolean): void;
  setPage(page: Page): void;
}

const SAVED_KEY = 'durbun.ui.v1';

function loadSaved(): Partial<UiState> {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as Partial<UiState>) : {};
  } catch {
    return {};
  }
}

const saved = loadSaved();
const pageFromHash = (): Page => (location.hash === '#/kaynaklar' ? 'sources' : 'map');

export const useUi = create<UiState>((set) => ({
  view: saved.view ?? 'map',
  lang: saved.lang ?? 'tr',
  camera: saved.camera ?? DEFAULT_CAMERA,
  visible: saved.visible ?? {},
  selectedId: undefined,
  panelOpen: typeof window !== 'undefined' ? window.innerWidth > 720 : true,
  page: pageFromHash(),
  setView: (view) => set({ view }),
  setLang: (lang) => set({ lang }),
  setCamera: (camera) => set({ camera }),
  setVisible: (layerId, on) => set((s) => ({ visible: { ...s.visible, [layerId]: on } })),
  select: (selectedId) => set({ selectedId }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setPage: (page) => {
    const hash = page === 'sources' ? '#/kaynaklar' : '#/';
    if (location.hash !== hash) history.pushState(null, '', hash);
    set({ page });
  },
}));

useUi.subscribe((s) => {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify({ view: s.view, lang: s.lang, camera: s.camera, visible: s.visible }));
  } catch {
    // Private mode or storage blocked: the app works without saving.
  }
});

window.addEventListener('popstate', () => useUi.setState({ page: pageFromHash() }));
window.addEventListener('hashchange', () => useUi.setState({ page: pageFromHash() }));

export function isVisible(layer: LayerSummary, visible: Record<string, boolean>): boolean {
  return visible[layer.id] ?? layer.defaultOn;
}

// ---- live data from the server ----

interface DataState {
  layers: LayerSummary[];
  collections: Record<string, FeatureCollection>;
  sources: SourceHealth[];
  connected: boolean;
  /** Feature id → feature, across all layers. */
  byId: Map<string, Feature>;
}

export const useData = create<DataState>(() => ({
  layers: [],
  collections: {},
  sources: [],
  connected: false,
  byId: new Map(),
}));

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function indexFeatures(collections: Record<string, FeatureCollection>): Map<string, Feature> {
  const map = new Map<string, Feature>();
  for (const fc of Object.values(collections)) for (const f of fc.features) map.set(f.properties.id, f);
  return map;
}

async function loadLayer(id: string): Promise<void> {
  const fc = await getJson<FeatureCollection>(`/api/layers/${encodeURIComponent(id)}`);
  const collections = { ...useData.getState().collections, [id]: fc };
  useData.setState({ collections, byId: indexFeatures(collections) });
}

async function loadAll(): Promise<void> {
  const [layers, sources] = await Promise.all([
    getJson<LayerSummary[]>('/api/layers'),
    getJson<SourceHealth[]>('/api/sources'),
  ]);
  useData.setState({ layers, sources });
  await Promise.all(layers.map((l) => loadLayer(l.id)));
}

function applyEvent(e: ServerEvent): void {
  if (e.type === 'layer') {
    useData.setState((s) => ({
      layers: s.layers.map((l) =>
        l.id === e.layer ? { ...l, version: e.version, count: e.count, updatedAt: e.updatedAt } : l,
      ),
    }));
    void loadLayer(e.layer).catch(() => {});
  } else {
    useData.setState((s) => {
      const exists = s.sources.some((x) => x.id === e.source.id);
      return {
        sources: exists ? s.sources.map((x) => (x.id === e.source.id ? e.source : x)) : [...s.sources, e.source],
        // A health event follows every fetch, so refresh the layer's "updated" time too.
        layers: s.layers.map((l) =>
          l.id === e.source.layer && e.source.lastSuccessAt ? { ...l, updatedAt: e.source.lastSuccessAt } : l,
        ),
      };
    });
  }
}

/** Loads everything, then follows server events. Reloads in full after a reconnect. */
export function startLive(): () => void {
  const events = new EventSource('/api/events');
  events.onopen = () => {
    useData.setState({ connected: true });
    void loadAll().catch(() => {});
  };
  events.onerror = () => useData.setState({ connected: false });
  events.onmessage = (msg) => {
    try {
      applyEvent(JSON.parse(msg.data as string) as ServerEvent);
    } catch {
      // Ignore a malformed message rather than break the stream.
    }
  };
  return () => events.close();
}
