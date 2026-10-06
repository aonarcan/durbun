import { AttributionControl, Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef } from 'react';
import { MAX_MAP_PITCH } from '../lib/camera.ts';
import { styleFor } from '../lib/basemaps.ts';
import {
  lineBounds,
  localiseLabels,
  styleLayerIds,
  syncDataLayers,
  syncFocus,
  syncRasters,
  syncRoute,
  type RouteDrawing,
} from '../lib/mapLayers.ts';
import { shownFeatures } from '../lib/filters.ts';
import {
  currentFilters,
  frameIndex,
  isVisible,
  useData,
  useFilters,
  useFocus,
  useRaster,
  useRoute,
  useUi,
  type ViewMode,
} from '../state.ts';

// MapLibre's worker is a separate module; let Vite bundle it and tell MapLibre where it is.
setWorkerUrl(workerUrl);

type View2D = Exclude<ViewMode, '3d'>;

/** [lng, lat] or [lng, lat, zoom] for the durbun:fly event. */
export type FlyDetail = [number, number, number?];

function currentRoute(): RouteDrawing | undefined {
  const r = useRoute.getState();
  if (r.status !== 'ready' || !r.result) return undefined;
  return {
    mode: r.result.mode,
    coordinates: r.result.geometry.coordinates as [number, number][],
    ...(r.from ? { from: r.from } : {}),
  };
}

/** The 2D map: OpenFreeMap or Esri basemaps with Dürbün's data layers on top. */
export function MapView({ view }: { view: View2D }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const currentView = useRef<View2D>(view);
  // Whether the current basemap style has finished loading. MapLibre's own
  // isStyleLoaded() is also false while any tiles are loading, which would
  // make toggles during panning or radar loading get lost.
  const styleReady = useRef(false);

  const layers = useData((s) => s.layers);
  const collections = useData((s) => s.collections);
  const visible = useUi((s) => s.visible);
  const filters = useFilters();
  const lang = useUi((s) => s.lang);
  const frame = useRaster((s) => s.frame);
  const focus = useFocus((s) => s.focus);

  // Create the map once; later changes go through the effects below.
  useEffect(() => {
    if (!container.current) return;
    const { camera } = useUi.getState();
    const map = new MapLibreMap({
      container: container.current,
      style: styleFor(view),
      center: [camera.lng, camera.lat],
      zoom: camera.zoom,
      bearing: camera.bearing,
      pitch: camera.pitch,
      maxPitch: MAX_MAP_PITCH,
      attributionControl: false,
      hash: false,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

    const refresh = () => {
      const data = useData.getState();
      const ui = useUi.getState();
      const filters = currentFilters();
      syncDataLayers(
        map,
        data.layers,
        (l) => shownFeatures(l, data.collections[l.id], filters),
        (l) => isVisible(l, ui.visible),
      );
      syncRasters(
        map,
        data.layers,
        (l) => isVisible(l, ui.visible),
        (l) => frameIndex(l, useRaster.getState().frame),
      );
      syncRoute(map, currentRoute());
      syncFocus(map, useFocus.getState().focus);
      localiseLabels(map, ui.lang);
    };
    map.on('style.load', () => {
      styleReady.current = true;
      refresh();
    });

    map.on('moveend', () => {
      const c = map.getCenter();
      useUi.getState().setCamera({
        lng: c.lng,
        lat: c.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
    });

    const clickable = () =>
      useData
        .getState()
        .layers.flatMap((l) => styleLayerIds(l))
        .filter((id) => map.getLayer(id));
    map.on('click', (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: clickable() });
      // Markers beat areas; among overlapping markers (an earthquake and its aftershocks) the one
      // whose centre is nearest the click wins, then the larger one.
      let best: (typeof hits)[number] | undefined;
      let bestScore = Infinity;
      for (const h of hits) {
        if (h.geometry.type !== 'Point') continue;
        const p = map.project(h.geometry.coordinates as [number, number]);
        const score = Math.round(Math.hypot(p.x - e.point.x, p.y - e.point.y) / 3) * 100 - Number(h.properties?.value ?? 0);
        if (score < bestScore) {
          best = h;
          bestScore = score;
        }
      }
      const hit = best ?? hits[0];
      useUi.getState().select(hit ? String(hit.properties?.id) : undefined);
    });
    map.on('mousemove', (e) => {
      const ids = clickable();
      const over = ids.length > 0 && map.queryRenderedFeatures(e.point, { layers: ids }).length > 0;
      map.getCanvas().style.cursor = over ? 'pointer' : '';
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Basemap switch between map, satellite and night.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || currentView.current === view) return;
    currentView.current = view;
    styleReady.current = false;
    map.setStyle(styleFor(view)); // "style.load" re-adds the data layers
  }, [view]);

  // New data or different visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    syncDataLayers(
      map,
      layers,
      (l) => shownFeatures(l, collections[l.id], filters),
      (l) => isVisible(l, visible),
    );
  }, [layers, collections, visible, filters]);

  // Radar and cloud images, and the radar frame being shown.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    syncRasters(
      map,
      layers,
      (l) => isVisible(l, visible),
      (l) => frameIndex(l, frame),
    );
  }, [layers, visible, frame]);

  // The selected earthquake's rings and aftershocks.
  useEffect(() => {
    const map = mapRef.current;
    if (map && styleReady.current) syncFocus(map, focus);
  }, [focus]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && styleReady.current) localiseLabels(map, lang);
  }, [lang]);

  // Draw the route and frame it when a new one arrives.
  useEffect(
    () =>
      useRoute.subscribe((r, prev) => {
        const map = mapRef.current;
        if (!map || !styleReady.current) return;
        const drawing = currentRoute();
        syncRoute(map, drawing);
        if (drawing && r.result !== prev.result) {
          const [w, s, e, n] = lineBounds(drawing.coordinates);
          const wide = window.innerWidth > 1100;
          map.fitBounds(
            [
              [w, s],
              [e, n],
            ],
            { padding: wide ? { top: 60, bottom: 60, left: 340, right: 420 } : 40, maxZoom: 17, duration: 800 },
          );
        }
      }),
    [],
  );

  // Fly to a feature, or frame an area, when a panel asks for it.
  useEffect(() => {
    const onFly = (e: Event) => {
      const [lng, lat, zoom] = (e as CustomEvent<FlyDetail>).detail;
      const map = mapRef.current;
      map?.flyTo({ center: [lng, lat], zoom: zoom ?? Math.max(map.getZoom(), 13) });
    };
    const onFit = (e: Event) => {
      const [w, s, e2, n] = (e as CustomEvent<[number, number, number, number]>).detail;
      const wide = window.innerWidth > 1100;
      mapRef.current?.fitBounds(
        [
          [w, s],
          [e2, n],
        ],
        { padding: wide ? { top: 40, bottom: 40, left: 330, right: 410 } : 30, duration: 900 },
      );
    };
    window.addEventListener('durbun:fly', onFly);
    window.addEventListener('durbun:fit', onFit);
    return () => {
      window.removeEventListener('durbun:fly', onFly);
      window.removeEventListener('durbun:fit', onFit);
    };
  }, []);

  return <div ref={container} className="map" aria-label="Harita" />;
}
