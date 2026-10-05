import { AttributionControl, Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef } from 'react';
import { MAX_MAP_PITCH } from '../lib/camera.ts';
import { styleFor } from '../lib/basemaps.ts';
import { localiseLabels, styleLayerIds, syncDataLayers } from '../lib/mapLayers.ts';
import { isVisible, useData, useUi, type ViewMode } from '../state.ts';

// MapLibre's worker is a separate module; let Vite bundle it and tell MapLibre where it is.
setWorkerUrl(workerUrl);

type View2D = Exclude<ViewMode, '3d'>;

/** The 2D map: OpenFreeMap or Esri basemaps with Dürbün's data layers on top. */
export function MapView({ view }: { view: View2D }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const currentView = useRef<View2D>(view);

  const layers = useData((s) => s.layers);
  const collections = useData((s) => s.collections);
  const visible = useUi((s) => s.visible);
  const lang = useUi((s) => s.lang);

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
      syncDataLayers(map, data.layers, data.collections, (l) => isVisible(l, ui.visible));
      localiseLabels(map, ui.lang);
    };
    map.on('style.load', refresh);

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

    map.on('click', (e) => {
      const ids = useData.getState().layers.flatMap((l) => styleLayerIds(l.id)).filter((id) => map.getLayer(id));
      const hit = map.queryRenderedFeatures(e.point, { layers: ids })[0];
      useUi.getState().select(hit ? String(hit.properties?.id) : undefined);
    });
    map.on('mousemove', (e) => {
      const ids = useData.getState().layers.flatMap((l) => styleLayerIds(l.id)).filter((id) => map.getLayer(id));
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
    map.setStyle(styleFor(view)); // "style.load" re-adds the data layers
  }, [view]);

  // New data or different visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    syncDataLayers(map, layers, collections, (l) => isVisible(l, visible));
  }, [layers, collections, visible]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) localiseLabels(map, lang);
  }, [lang]);

  // Fly to a feature when the info panel asks for it.
  useEffect(() => {
    const onFly = (e: Event) => {
      const [lng, lat] = (e as CustomEvent<[number, number]>).detail;
      mapRef.current?.flyTo({ center: [lng, lat], zoom: Math.max(mapRef.current.getZoom(), 13) });
    };
    window.addEventListener('durbun:fly', onFly);
    return () => window.removeEventListener('durbun:fly', onFly);
  }, []);

  return <div ref={container} className="map" aria-label="Harita" />;
}
