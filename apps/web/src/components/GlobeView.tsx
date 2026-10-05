import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { Feature, LayerSummary } from '@durbun/core';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n.ts';
import { ESRI_CREDIT, ESRI_IMAGERY_URL } from '../lib/basemaps.ts';
import {
  cesiumPitch,
  clampZoom,
  mapPitch,
  normaliseBearing,
  rangeFromZoom,
  zoomFromRange,
  type CameraState,
} from '../lib/camera.ts';
import { KIND_COLORS } from '../lib/mapLayers.ts';
import { isVisible, useData, useUi } from '../state.ts';

let configPromise: Promise<{ cesiumIonToken: string }> | undefined;
function loadConfig() {
  configPromise ??= fetch('/api/config')
    .then((r) => r.json() as Promise<{ cesiumIonToken: string }>)
    .catch(() => ({ cesiumIonToken: '' }));
  return configPromise;
}

function viewportHeight(viewer: Cesium.Viewer): number {
  return viewer.canvas.clientHeight || 800;
}

function fovy(viewer: Cesium.Viewer): number {
  const f = viewer.camera.frustum;
  return f instanceof Cesium.PerspectiveFrustum && f.fovy ? f.fovy : Cesium.Math.toRadians(60);
}

/** Puts the 3D camera where the 2D map was looking. */
function applyCamera(viewer: Cesium.Viewer, c: CameraState): void {
  const range = rangeFromZoom(c.lat, c.zoom, viewportHeight(viewer), fovy(viewer));
  const target = Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 0);
  viewer.camera.lookAt(
    target,
    new Cesium.HeadingPitchRange(Cesium.Math.toRadians(c.bearing), Cesium.Math.toRadians(cesiumPitch(c.pitch)), range),
  );
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}

/** Reads the 3D camera back as a 2D map view (centre = what the screen centre looks at). */
function readCamera(viewer: Cesium.Viewer): CameraState | undefined {
  const { camera, scene } = viewer;
  const centre = new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2);
  const ray = camera.getPickRay(centre);
  const hit = ray ? scene.globe.pick(ray, scene) : undefined;
  const heading = Cesium.Math.toDegrees(camera.heading);
  const pitch = mapPitch(Cesium.Math.toDegrees(camera.pitch));
  if (hit) {
    const carto = Cesium.Cartographic.fromCartesian(hit);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const range = Cesium.Cartesian3.distance(camera.positionWC, hit);
    return {
      lng: Cesium.Math.toDegrees(carto.longitude),
      lat,
      zoom: clampZoom(zoomFromRange(lat, range, viewportHeight(viewer), fovy(viewer))),
      bearing: normaliseBearing(heading),
      pitch,
    };
  }
  // Looking at the sky: fall back to the point below the camera.
  const carto = camera.positionCartographic;
  const lat = Cesium.Math.toDegrees(carto.latitude);
  return {
    lng: Cesium.Math.toDegrees(carto.longitude),
    lat,
    zoom: clampZoom(zoomFromRange(lat, carto.height, viewportHeight(viewer), fovy(viewer))),
    bearing: normaliseBearing(heading),
    pitch: 0,
  };
}

function pointColour(layer: LayerSummary, f: Feature): Cesium.Color {
  if (layer.id === 'incidents') return Cesium.Color.fromCssColorString(KIND_COLORS[f.properties.kind ?? ''] ?? layer.color);
  return Cesium.Color.fromCssColorString(layer.color);
}

const iconCache = new Map<string, HTMLCanvasElement>();

/** A round marker with a letter in it (e.g. "E" for pharmacies), drawn once per colour. */
function glyphIcon(color: string, glyph: string): HTMLCanvasElement {
  const key = `${color}|${glyph}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const size = 40; // drawn at 2x and shown at half size, so it stays sharp
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, size / 2, size / 2 + 1);
  iconCache.set(key, canvas);
  return canvas;
}

function pointSize(layer: LayerSummary, f: Feature): number {
  if (layer.id === 'earthquakes') return Math.max(5, Math.min(30, 4 + (f.properties.value ?? 0) * 3.5));
  return layer.glyph ? 14 : 11;
}

/** The 3D globe: Esri imagery, plus terrain and photorealistic cities when a Cesium ion token is set. */
export default function GlobeView() {
  const container = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const sourcesRef = useRef(new Map<string, Cesium.CustomDataSource>());
  const [hasToken, setHasToken] = useState<boolean | undefined>(undefined);
  const [ready, setReady] = useState(false);

  const layers = useData((s) => s.layers);
  const collections = useData((s) => s.collections);
  const visible = useUi((s) => s.visible);
  const lang = useUi((s) => s.lang);

  useEffect(() => {
    let cancelled = false;
    let viewer: Cesium.Viewer | undefined;

    void (async () => {
      const { cesiumIonToken } = await loadConfig();
      if (cancelled || !container.current) return;
      setHasToken(Boolean(cesiumIonToken));
      if (cesiumIonToken) Cesium.Ion.defaultAccessToken = cesiumIonToken;

      viewer = new Cesium.Viewer(container.current, {
        baseLayer: new Cesium.ImageryLayer(
          new Cesium.UrlTemplateImageryProvider({ url: ESRI_IMAGERY_URL, maximumLevel: 19, credit: ESRI_CREDIT }),
        ),
        ...(cesiumIonToken ? { terrain: Cesium.Terrain.fromWorldTerrain() } : {}),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        requestRenderMode: true,
      });
      viewerRef.current = viewer;
      viewer.scene.globe.depthTestAgainstTerrain = Boolean(cesiumIonToken);
      applyCamera(viewer, useUi.getState().camera);

      if (cesiumIonToken) {
        try {
          // Dürbün has no search box, so no other geocoder is used alongside Google's tiles.
          const tiles = await Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true });
          if (!cancelled) viewer.scene.primitives.add(tiles);
        } catch {
          try {
            const osm = await Cesium.createOsmBuildingsAsync();
            if (!cancelled) viewer.scene.primitives.add(osm);
          } catch {
            // Terrain and imagery still work without buildings.
          }
        }
      }

      viewer.camera.moveEnd.addEventListener(() => {
        const c = viewer && readCamera(viewer);
        if (c) useUi.getState().setCamera(c);
      });

      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
        const picked = viewer?.scene.pick(click.position) as { id?: Cesium.Entity } | undefined;
        const id = picked?.id instanceof Cesium.Entity ? picked.id.id : undefined;
        useUi.getState().select(id);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // Draw whatever data is already loaded.
      setReady(true);
    })();

    return () => {
      cancelled = true;
      sourcesRef.current.clear();
      viewerRef.current = null;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  // Data layers as entities.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const layer of layers) {
      let ds = sourcesRef.current.get(layer.id);
      if (!ds) {
        ds = new Cesium.CustomDataSource(layer.id);
        sourcesRef.current.set(layer.id, ds);
        void viewer.dataSources.add(ds);
      }
      ds.show = isVisible(layer, visible);
      ds.entities.suspendEvents();
      ds.entities.removeAll();
      for (const f of collections[layer.id]?.features ?? []) {
        if (f.geometry.type !== 'Point') continue;
        const [lng, lat] = f.geometry.coordinates;
        const position = Cesium.Cartesian3.fromDegrees(lng, lat);
        const common = {
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        };
        ds.entities.add(
          layer.glyph
            ? {
                id: f.properties.id,
                position,
                billboard: { ...common, image: glyphIcon(layer.color, layer.glyph), scale: 0.5 },
              }
            : {
                id: f.properties.id,
                position,
                point: {
                  ...common,
                  pixelSize: pointSize(layer, f),
                  color: pointColour(layer, f),
                  outlineColor: Cesium.Color.WHITE,
                  outlineWidth: 2,
                },
              },
        );
      }
      ds.entities.resumeEvents();
    }
    viewer.scene.requestRender();
  }, [layers, collections, visible, ready]);

  // Fly to a feature when the info panel asks for it.
  useEffect(() => {
    const onFly = (e: Event) => {
      const [lng, lat] = (e as CustomEvent<[number, number]>).detail;
      viewerRef.current?.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lng, lat, 4000) });
    };
    window.addEventListener('durbun:fly', onFly);
    return () => window.removeEventListener('durbun:fly', onFly);
  }, []);

  return (
    <div className="globe-wrap">
      <div ref={container} className="map" aria-label="3B harita" />
      {hasToken === false && <div className="globe-hint">{t(lang, 'globeNoToken')}</div>}
    </div>
  );
}
