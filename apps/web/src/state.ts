import type {
  BusAnswer,
  Feature,
  FeatureCollection,
  LayerSummary,
  StopAnswer,
  TransitLine,
  RouteResult,
  ServerEvent,
  SourceHealth,
  TrackAnswer,
  TravelMode,
} from '@durbun/core';
import { useMemo } from 'react';
import { create } from 'zustand';
import type { Lang } from './i18n.ts';
import { DEFAULT_CAMERA, type CameraState } from './lib/camera.ts';
import type { Filters } from './lib/filters.ts';
import { locate } from './lib/locate.ts';
import type { ProvinceFeature, QuakeFocus } from './lib/quake.ts';

export type ViewMode = 'map' | 'satellite' | 'dark' | '3d';
export type Buildings3d = 'osm' | 'google' | 'off';
export type Page = 'map' | 'sources';
export type PanelTab = 'layers' | 'news';

// ---- what the viewer chose (kept in this browser between visits) ----

interface UiState {
  view: ViewMode;
  lang: Lang;
  camera: CameraState;
  /** Layer id → shown. Layers missing here use their defaultOn. */
  visible: Record<string, boolean>;
  /** Layer id → chosen time window in hours, for layers that offer one. */
  windows: Record<string, number>;
  /** Layer id → draw trails behind moving items (on unless switched off). */
  trails: Record<string, boolean>;
  /** Layer id → chosen minimum value (e.g. magnitude), for layers that offer one. */
  minValues: Record<string, number>;
  /** Which 3D buildings the 3D view shows (needs a Cesium ion token). */
  buildings3d: Buildings3d;
  selectedId: string | undefined;
  panelOpen: boolean;
  /** Which list the left panel shows. */
  panelTab: PanelTab;
  page: Page;
  setView(view: ViewMode): void;
  setLang(lang: Lang): void;
  setCamera(camera: CameraState): void;
  setVisible(layerId: string, on: boolean): void;
  setWindow(layerId: string, hours: number): void;
  setTrails(layerId: string, on: boolean): void;
  setMinValue(layerId: string, value: number): void;
  setBuildings3d(mode: Buildings3d): void;
  select(id: string | undefined): void;
  setPanelOpen(open: boolean): void;
  setPanelTab(tab: PanelTab): void;
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
  windows: saved.windows ?? {},
  trails: saved.trails ?? {},
  minValues: saved.minValues ?? {},
  buildings3d: saved.buildings3d ?? 'osm',
  selectedId: undefined,
  panelOpen: typeof window !== 'undefined' ? window.innerWidth > 720 : true,
  panelTab: saved.panelTab ?? 'layers',
  page: pageFromHash(),
  setView: (view) => set({ view }),
  setLang: (lang) => set({ lang }),
  setCamera: (camera) => set({ camera }),
  setVisible: (layerId, on) => set((s) => ({ visible: { ...s.visible, [layerId]: on } })),
  setWindow: (layerId, hours) => set((s) => ({ windows: { ...s.windows, [layerId]: hours } })),
  setTrails: (layerId, on) => set((s) => ({ trails: { ...s.trails, [layerId]: on } })),
  setMinValue: (layerId, value) => set((s) => ({ minValues: { ...s.minValues, [layerId]: value } })),
  setBuildings3d: (buildings3d) => set({ buildings3d }),
  select: (selectedId) => set({ selectedId }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setPanelTab: (panelTab) => set({ panelTab }),
  setPage: (page) => {
    const hash = page === 'sources' ? '#/kaynaklar' : '#/';
    if (location.hash !== hash) history.pushState(null, '', hash);
    set({ page });
  },
}));

useUi.subscribe((s) => {
  try {
    const saved = {
      view: s.view,
      lang: s.lang,
      camera: s.camera,
      visible: s.visible,
      windows: s.windows,
      trails: s.trails,
      minValues: s.minValues,
      buildings3d: s.buildings3d,
      panelTab: s.panelTab,
    };
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  } catch {
    // Private mode or storage blocked: the app works without saving.
  }
});

window.addEventListener('popstate', () => useUi.setState({ page: pageFromHash() }));
window.addEventListener('hashchange', () => useUi.setState({ page: pageFromHash() }));

export function isVisible(layer: LayerSummary, visible: Record<string, boolean>): boolean {
  return visible[layer.id] ?? layer.defaultOn;
}

/** Hook: the viewer's layer filters, as one object. */
export function useFilters(): Filters {
  const windows = useUi((s) => s.windows);
  const minValues = useUi((s) => s.minValues);
  return useMemo(() => ({ windows, minValues }), [windows, minValues]);
}

export function currentFilters(): Filters {
  const { windows, minValues } = useUi.getState();
  return { windows, minValues };
}

// ---- image layers (radar animation) ----

interface RasterState {
  /** Layer id → frame index being shown; missing means the newest frame. */
  frame: Record<string, number>;
  playing: boolean;
}

export const useRaster = create<RasterState>(() => ({ frame: {}, playing: false }));

/** Index of the frame to show for an image layer. */
export function frameIndex(layer: LayerSummary, frame: Record<string, number>): number {
  const n = layer.raster?.frames.length ?? 0;
  const pick = frame[layer.id];
  return pick !== undefined && pick >= 0 && pick < n ? pick : n - 1;
}

// ---- earthquake view ----

/**
 * The selected earthquake's rings, aftershocks and nearby provinces, as the
 * maps draw them (aftershocks limited to those the layer filters show); set by the info panel.
 */
export const useFocus = create<{ focus: QuakeFocus | undefined }>(() => ({ focus: undefined }));

let provincesPromise: Promise<ProvinceFeature[]> | undefined;

/** Province outlines (loaded once, on first use). */
export function loadProvinces(): Promise<ProvinceFeature[]> {
  provincesPromise ??= getJson<{ features: ProvinceFeature[] }>('/api/provinces')
    .then((fc) => fc.features)
    .catch((err: unknown) => {
      provincesPromise = undefined;
      throw err;
    });
  return provincesPromise;
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

/** Lazy layers (every bus, every stop) are loaded only while switched on. */
function wanted(id: string): boolean {
  const layer = useData.getState().layers.find((l) => l.id === id);
  return !layer?.lazy || isVisible(layer, useUi.getState().visible);
}

async function loadLayer(id: string): Promise<void> {
  const fc = await getJson<FeatureCollection>(`/api/layers/${encodeURIComponent(id)}`);
  const collections = { ...useData.getState().collections, [id]: fc };
  useData.setState({ collections, byId: indexFeatures(collections) });
  if (useData.getState().layers.find((l) => l.id === id)?.tracks) {
    void loadTails(id).catch(() => {});
    const selected = useUi.getState().selectedId;
    if (selected && collections[id]?.features.some((f) => f.properties.id === selected)) void loadTrack(selected);
  }
}

// ---- paths of aircraft and ships ----

interface TrackState {
  /** Layer id → short trails behind every moving item. */
  tails: Record<string, FeatureCollection>;
  /** The selected item's path: for aircraft the whole current flight, with its route when known. */
  selected?: TrackAnswer;
}

export const useTracks = create<TrackState>(() => ({ tails: {} }));

async function loadTails(layerId: string): Promise<void> {
  const fc = await getJson<FeatureCollection>(`/api/layers/${encodeURIComponent(layerId)}/tails`);
  useTracks.setState((s) => ({ tails: { ...s.tails, [layerId]: fc } }));
}

let trackRequest = 0;

/** Loads the path of the selected aircraft or ship (or clears it). */
async function loadTrack(id: string | undefined): Promise<void> {
  const req = ++trackRequest;
  if (!id || !/^(aircraft|ship):/.test(id)) {
    if (useTracks.getState().selected) useTracks.setState({ selected: undefined });
    return;
  }
  try {
    const res = await fetch(`/api/tracks/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (req !== trackRequest) return;
    if (!res.ok) {
      useTracks.setState({ selected: undefined });
      return;
    }
    const body = (await res.json()) as TrackAnswer;
    if (req === trackRequest) useTracks.setState({ selected: body });
  } catch {
    // Keep whatever path is shown; the next update tries again.
  }
}

useUi.subscribe((s, prev) => {
  if (s.selectedId !== prev.selectedId) void loadTrack(s.selectedId);
});

async function loadAll(): Promise<void> {
  const [layers, sources] = await Promise.all([
    getJson<LayerSummary[]>('/api/layers'),
    getJson<SourceHealth[]>('/api/sources'),
  ]);
  useData.setState({ layers, sources });
  await Promise.all(layers.filter((l) => wanted(l.id)).map((l) => loadLayer(l.id)));
}

// A lazy layer switched on is loaded at once; the server is reminded every minute that
// someone still shows it, so sources that run only on demand (buses) keep running.
useUi.subscribe((s, prev) => {
  if (s.visible === prev.visible) return;
  for (const l of useData.getState().layers) {
    if (l.lazy && isVisible(l, s.visible) && !isVisible(l, prev.visible)) void loadLayer(l.id).catch(() => {});
  }
});
setInterval(() => {
  const ids = useData
    .getState()
    .layers.filter((l) => l.lazy && isVisible(l, useUi.getState().visible))
    .map((l) => l.id);
  if (ids.length) void fetch(`/api/want?layers=${ids.map(encodeURIComponent).join(',')}`).catch(() => {});
}, 60_000);

function applyEvent(e: ServerEvent): void {
  if (e.type === 'layer') {
    useData.setState((s) => ({
      layers: s.layers.map((l) =>
        l.id === e.layer
          ? { ...l, version: e.version, count: e.count, updatedAt: e.updatedAt, ...(e.raster ? { raster: e.raster } : {}) }
          : l,
      ),
    }));
    if (wanted(e.layer)) void loadLayer(e.layer).catch(() => {});
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

// ---- İstanbul buses, stops and lines ----

export type TransitAnswer =
  | { kind: 'bus'; id: string; data: BusAnswer }
  | { kind: 'stop'; id: string; data: StopAnswer };

interface TransitState {
  /** What the server said about the selected bus or stop. */
  answer?: TransitAnswer;
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** The line drawn on the map: the selected bus's, or one picked at a stop. */
  line?: TransitLine;
  /** The selected bus's direction on that line, drawn stronger. */
  direction?: 'G' | 'D';
  showLine(code: string | undefined): Promise<void>;
}

export const useTransit = create<TransitState>((set) => ({
  status: 'idle',
  async showLine(code) {
    if (!code) {
      set({ line: undefined, direction: undefined });
      return;
    }
    try {
      set({ line: await getJson<TransitLine>(`/api/transit/line/${encodeURIComponent(code)}`), direction: undefined });
    } catch {
      // Leave the map as it is.
    }
  },
}));

let transitRequest = 0;

/** Looks up the selected bus (its line) or stop (its lines and coming buses). */
async function loadTransit(id: string | undefined, refresh = false): Promise<void> {
  const req = ++transitRequest;
  const m = id && /^(bus|stop):(.+)$/.exec(id);
  if (!m) {
    if (useTransit.getState().answer || useTransit.getState().line) useTransit.setState({ answer: undefined, line: undefined, status: 'idle' });
    return;
  }
  const kind = m[1] as 'bus' | 'stop';
  if (!refresh) useTransit.setState({ answer: undefined, status: 'loading', ...(kind === 'bus' ? { line: undefined } : {}) });
  try {
    const data = await getJson<BusAnswer | StopAnswer>(`/api/transit/${kind}/${encodeURIComponent(m[2]!)}`);
    if (req !== transitRequest) return;
    if (kind === 'bus') {
      const bus = data as BusAnswer;
      useTransit.setState({
        answer: { kind, id, data: bus },
        status: 'ready',
        line: bus.line,
        direction: bus.direction,
      });
    } else {
      useTransit.setState({ answer: { kind, id, data: data as StopAnswer }, status: 'ready' });
    }
  } catch {
    if (req === transitRequest && !refresh) useTransit.setState({ status: 'error' });
  }
}

useUi.subscribe((s, prev) => {
  if (s.selectedId !== prev.selectedId) void loadTransit(s.selectedId);
});
// Buses move and stops get new arrivals: refresh what's selected every 20 seconds.
setInterval(() => {
  const id = useUi.getState().selectedId;
  if (id && /^(bus|stop):/.test(id) && document.visibilityState === 'visible') void loadTransit(id, true);
  const line = useTransit.getState().line;
  if (line && !id?.startsWith('bus:') && document.visibilityState === 'visible') void useTransit.getState().showLine(line.code);
}, 20_000);

// ---- directions ----

export type RouteStatus = 'idle' | 'locating' | 'loading' | 'ready' | 'error';

interface RouteState {
  status: RouteStatus;
  mode: TravelMode;
  /** Destination [lng, lat] and its name. */
  to?: [number, number];
  toTitle?: string;
  from?: [number, number];
  result?: RouteResult;
  /** A LocateError code, or the server's message. */
  error?: string;
}

export const useRoute = create<RouteState>(() => ({ status: 'idle', mode: 'car' }));

let routeRequest = 0;

/** Directions from where the viewer is to a point on the map. */
export async function requestRoute(to: [number, number], toTitle: string, mode: TravelMode): Promise<void> {
  const id = ++routeRequest;
  useRoute.setState({ status: 'locating', mode, to, toTitle, result: undefined, error: undefined });
  let from: [number, number];
  try {
    from = await locate();
  } catch (code) {
    if (id === routeRequest) useRoute.setState({ status: 'error', error: String(code) });
    return;
  }
  if (id !== routeRequest) return;
  useRoute.setState({ status: 'loading', from });
  try {
    const q = `from=${from.join(',')}&to=${to.join(',')}&mode=${mode}`;
    const res = await fetch(`/api/route?${q}`, { cache: 'no-store' });
    const body = (await res.json()) as RouteResult | { error: string };
    if (id !== routeRequest) return;
    if (!res.ok || 'error' in body) throw new Error('error' in body ? body.error : `HTTP ${res.status}`);
    useRoute.setState({ status: 'ready', result: body });
  } catch (err) {
    if (id === routeRequest) useRoute.setState({ status: 'error', error: err instanceof Error ? err.message : 'server' });
  }
}

export function clearRoute(): void {
  routeRequest++;
  useRoute.setState({ status: 'idle', to: undefined, toTitle: undefined, from: undefined, result: undefined, error: undefined });
}
