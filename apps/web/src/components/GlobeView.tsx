import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { pointOf, type Feature, type LayerSummary } from '@durbun/core';
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
import { shownFeatures } from '../lib/filters.ts';
import { groundAtCentre } from '../lib/globePick.ts';
import { aircraftNow, extrapolate, planeBand, planeCanvas, PLANE_COLORS, SHIP_COLORS, shipCanvas } from '../lib/icons.ts';
import {
  absoluteTileUrl,
  AFTERSHOCK_COLOR,
  FIRE_COLORS,
  FOCUS_COLOR,
  KIND_COLORS,
  STRAIT_COLORS,
  TRAIL_COLORS,
  lineBounds,
  PROVINCE_LINE_COLOR,
  quakeColor,
  ROUTE_COLORS,
  tempColor,
  WARNING_COLORS,
} from '../lib/mapLayers.ts';
import { frameIndex, isVisible, useData, useFilters, useFocus, useRaster, useRoute, useTracks, useUi } from '../state.ts';
import { GlobeControls, setUpMouse } from './GlobeControls.tsx';
import type { FlyDetail } from './MapView.tsx';

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
  const { camera } = viewer;
  const hit = groundAtCentre(viewer);
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
  if (layer.id === 'fires') return Cesium.Color.fromCssColorString(FIRE_COLORS[f.properties.kind ?? ''] ?? layer.color);
  if (layer.id === 'straits') return Cesium.Color.fromCssColorString(STRAIT_COLORS[f.properties.kind ?? ''] ?? layer.color);
  if (layer.id === 'earthquakes') {
    const t = f.properties.observedAt ? Date.parse(f.properties.observedAt) : NaN;
    return Cesium.Color.fromCssColorString(quakeColor(Number.isFinite(t) ? (Date.now() - t) / 3_600_000 : 9999));
  }
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

/** A numbered circle for a group of news pins. */
function clusterIcon(color: string, n: number): HTMLCanvasElement {
  return cachedCanvas(`cluster-${color}-${n}`, () => {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n > 99 ? '99+' : String(n), size / 2, size / 2 + 1);
    return c;
  });
}

/** A temperature badge: a round dot in the temperature's colour with the value in it. */
function temperatureIcon(value: number | undefined): HTMLCanvasElement {
  const label = value === undefined ? '–' : `${Math.round(value)}°`;
  const key = `temp|${label}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const size = 56;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = tempColor(value);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2 + 1);
  iconCache.set(key, canvas);
  return canvas;
}

/** A wind arrow pointing up, drawn outside a badge-sized gap so it can turn around the badge. */
function windArrowIcon(): HTMLCanvasElement {
  const cached = iconCache.get('wind');
  if (cached) return cached;
  const size = 128; // shown at half size: 64 px, the arrow 15–32 px from the centre
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  ctx.beginPath();
  ctx.moveTo(c, 2);
  ctx.lineTo(c + 12, 20);
  ctx.lineTo(c + 4, 17);
  ctx.lineTo(c + 4, 34);
  ctx.lineTo(c - 4, 34);
  ctx.lineTo(c - 4, 17);
  ctx.lineTo(c - 12, 20);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#14213d';
  ctx.fill();
  iconCache.set('wind', canvas);
  return canvas;
}

/** The local north direction at a point, so a billboard can turn with the map. */
function northAt(position: Cesium.Cartesian3): Cesium.Cartesian3 {
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);
  return Cesium.Cartesian3.normalize(
    Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian4()) as unknown as Cesium.Cartesian3,
    new Cesium.Cartesian3(),
  );
}

const GROUND = {
  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
  disableDepthTestDistance: Number.POSITIVE_INFINITY,
};

/** A warning area: a tinted province with a coloured edge. Entity ids get "#n" so picking can find the feature. */
function addArea(ds: Cesium.CustomDataSource, layer: LayerSummary, f: Feature): void {
  const g = f.geometry;
  const polygons = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  const color = Cesium.Color.fromCssColorString(WARNING_COLORS[f.properties.kind ?? ''] ?? layer.color);
  const begins = f.properties.observedAt ? Date.parse(f.properties.observedAt) : NaN;
  const active = !(begins > Date.now());
  polygons.forEach((rings, i) => {
    const [outer, ...holes] = rings.map((r) => Cesium.Cartesian3.fromDegreesArray(r.flatMap((c) => [c[0], c[1]])));
    if (!outer) return;
    ds.entities.add({
      id: `${f.properties.id}#${i}`,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(
          outer,
          holes.map((h) => new Cesium.PolygonHierarchy(h)),
        ),
        material: color.withAlpha(active ? 0.38 : 0.16),
      },
    });
    ds.entities.add({
      id: `${f.properties.id}#${i}-edge`,
      polyline: { positions: outer, clampToGround: true, width: active ? 2.5 : 1.2, material: color },
    });
  });
}

function addWeather(ds: Cesium.CustomDataSource, f: Feature, position: Cesium.Cartesian3): void {
  const windDir = f.properties.style?.windDir;
  if (typeof windDir === 'number') {
    ds.entities.add({
      id: `${f.properties.id}#wind`,
      position,
      billboard: {
        ...GROUND,
        image: windArrowIcon(),
        scale: 0.5,
        alignedAxis: northAt(position),
        // Cesium turns billboards anticlockwise; the arrow points where the wind blows to.
        rotation: -Cesium.Math.toRadians(windDir + 180),
      },
    });
  }
  ds.entities.add({
    id: f.properties.id,
    position,
    billboard: { ...GROUND, image: temperatureIcon(f.properties.value), scale: 0.5 },
  });
}

const canvasCache = new Map<string, HTMLCanvasElement>();
function cachedCanvas(key: string, draw: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = canvasCache.get(key);
  if (!c) {
    c = draw();
    canvasCache.set(key, c);
  }
  return c;
}

/**
 * An aircraft at its altitude, turned to its track, with a faint line down
 * to the ground. Its position moves on from the last report as time passes.
 */
function addAircraft(ds: Cesium.CustomDataSource, f: Feature): void {
  const at = pointOf(f);
  if (!at) return;
  const style = f.properties.style ?? {};
  const altM = Number(style.altM ?? 0);
  const band = planeBand(f.properties.kind, f.properties.value);
  const t = f.properties.observedAt ? Date.parse(f.properties.observedAt) : Date.now();
  const where = () => {
    const [lng, lat] =
      f.properties.kind === 'air'
        ? extrapolate(at[0], at[1], Number(style.speedKn) || undefined, typeof style.track === 'number' ? style.track : undefined, (Date.now() - t) / 1000)
        : at;
    return [lng, lat] as const;
  };
  const position = new Cesium.CallbackPositionProperty(() => {
    const [lng, lat] = where();
    return Cesium.Cartesian3.fromDegrees(lng, lat, altM);
  }, false);
  const start = Cesium.Cartesian3.fromDegrees(at[0], at[1], altM);
  ds.entities.add({
    id: f.properties.id,
    position,
    billboard: {
      image: cachedCanvas(`plane-${band}`, () => planeCanvas(PLANE_COLORS[band])),
      scale: 0.55,
      alignedAxis: northAt(start),
      rotation: -Cesium.Math.toRadians(Number(style.track ?? 0)),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: altM > 0 ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });
  if (altM > 300) {
    ds.entities.add({
      id: `${f.properties.id}#stalk`,
      polyline: {
        positions: new Cesium.CallbackProperty(() => {
          const [lng, lat] = where();
          return Cesium.Cartesian3.fromDegreesArrayHeights([lng, lat, 0, lng, lat, altM]);
        }, false),
        width: 1,
        material: Cesium.Color.WHITE.withAlpha(0.35),
      },
    });
  }
}

function addShip(ds: Cesium.CustomDataSource, f: Feature, position: Cesium.Cartesian3): void {
  const style = f.properties.style ?? {};
  const moving = style.moving === 1;
  const cat = f.properties.kind ?? 'unknown';
  ds.entities.add({
    id: f.properties.id,
    position,
    billboard: {
      ...GROUND,
      image: cachedCanvas(`ship-${cat}-${moving}`, () => shipCanvas(SHIP_COLORS[cat] ?? SHIP_COLORS.unknown!, moving)),
      scale: 0.45,
      alignedAxis: northAt(position),
      rotation: -Cesium.Math.toRadians(Number(style.course ?? 0)),
    },
  });
}

function pointSize(layer: LayerSummary, f: Feature): number {
  if (layer.id === 'fires') return Math.max(6, Math.min(16, 5 + Math.sqrt(f.properties.value ?? 0) * 1.2));
  if (layer.id === 'straits') return 20;
  if (layer.listed) return 12;
  if (layer.id === 'earthquakes') return Math.max(5, Math.min(30, 4 + (f.properties.value ?? 0) * 3.5));
  return layer.glyph ? 14 : 11;
}

type BuildingsStatus = 'off' | 'loading' | 'osm' | 'google' | 'google-failed' | 'failed';

/**
 * Lights the scene from the camera instead of the real sun. With the default
 * sunlight, buildings turn dark brown at night and on north faces; a light
 * that follows the view keeps them readable at any hour. (The planned
 * sun-and-shadow tool will switch back to the true sun position.)
 */
function lightFromCamera(viewer: Cesium.Viewer): void {
  const light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.clone(viewer.camera.directionWC), intensity: 2.2 });
  viewer.scene.light = light;
  viewer.scene.preRender.addEventListener((scene) => {
    Cesium.Cartesian3.clone(scene.camera.directionWC, light.direction);
  });
}

/** OSM buildings in a warm light grey, so they read against the satellite imagery. */
const OSM_STYLE = new Cesium.Cesium3DTileStyle({ color: "color('#e4dfd6')" });

/**
 * The 3D globe: Esri imagery, plus terrain and 3D buildings when a Cesium ion
 * token is set. OSM buildings are the default because Google's photorealistic
 * models don't cover Türkiye (its cities there are flat imagery on terrain).
 */
export default function GlobeView() {
  const container = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const sourcesRef = useRef(new Map<string, Cesium.CustomDataSource>());
  const imageryRef = useRef(new Map<string, { layerId: string; imagery: Cesium.ImageryLayer }>());
  const [hasToken, setHasToken] = useState<boolean | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [buildings, setBuildings] = useState<BuildingsStatus>('off');
  const tilesetRef = useRef<Cesium.Cesium3DTileset | undefined>(undefined);
  const buildingsMode = useUi((s) => s.buildings3d);

  const layers = useData((s) => s.layers);
  const collections = useData((s) => s.collections);
  const visible = useUi((s) => s.visible);
  const filters = useFilters();
  const lang = useUi((s) => s.lang);
  const frame = useRaster((s) => s.frame);
  const focus = useFocus((s) => s.focus);

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
      setUpMouse(viewer);
      lightFromCamera(viewer);
      viewer.scene.globe.depthTestAgainstTerrain = Boolean(cesiumIonToken);
      applyCamera(viewer, useUi.getState().camera);

      viewer.camera.moveEnd.addEventListener(() => {
        const c = viewer && readCamera(viewer);
        if (c) useUi.getState().setCamera(c);
      });

      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
        const picked = viewer?.scene.pick(click.position) as { id?: Cesium.Entity | Cesium.Entity[] } | undefined;
        // A numbered circle of news pins: move closer until it splits.
        if (Array.isArray(picked?.id) && viewer) {
          const ground = viewer.scene.pickPosition(click.position);
          if (ground) {
            const range = Cesium.Cartesian3.distance(viewer.camera.positionWC, ground) / 3;
            viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(ground, 0), {
              offset: new Cesium.HeadingPitchRange(viewer.camera.heading, viewer.camera.pitch, Math.max(range, 2000)),
              duration: 0.8,
            });
          }
          return;
        }
        const id = picked?.id instanceof Cesium.Entity ? picked.id.id : undefined;
        if (id?.startsWith('route:') || id?.startsWith('focus:') || id?.startsWith('trail:')) return; // drawings, not places
        // Areas and wind arrows are drawn as several entities: "<feature id>#<part>".
        useUi.getState().select(id?.split('#')[0]);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      // Draw whatever data is already loaded.
      setReady(true);
    })();

    return () => {
      cancelled = true;
      sourcesRef.current.clear();
      imageryRef.current.clear();
      viewerRef.current = null;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  // Data layers as entities.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    for (const layer of layers) {
      if (layer.raster) continue;
      let ds = sourcesRef.current.get(layer.id);
      if (!ds) {
        ds = new Cesium.CustomDataSource(layer.id);
        if (layer.listed) {
          // News pins in the same province gather into one numbered circle.
          ds.clustering.enabled = true;
          ds.clustering.pixelRange = 30;
          ds.clustering.minimumClusterSize = 2;
          ds.clustering.clusterEvent.addEventListener((entities, cluster) => {
            cluster.label.show = false;
            cluster.point.show = false;
            cluster.billboard.show = true;
            const n = entities.length;
            cluster.billboard.setImage(`cluster-${layer.color}-${n}`, clusterIcon(layer.color, n));
            cluster.billboard.scale = 0.5;
            cluster.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;
            cluster.billboard.verticalOrigin = Cesium.VerticalOrigin.CENTER;
          });
        }
        sourcesRef.current.set(layer.id, ds);
        void viewer.dataSources.add(ds);
      }
      ds.show = isVisible(layer, visible);
      ds.entities.suspendEvents();
      ds.entities.removeAll();
      for (const f of shownFeatures(layer, collections[layer.id], filters)) {
        if (layer.shape === 'areas') {
          addArea(ds, layer, f);
          continue;
        }
        const at = pointOf(f);
        if (!at) continue;
        const [lng, lat] = at;
        const position = Cesium.Cartesian3.fromDegrees(lng, lat);
        if (layer.id === 'weather-now') {
          addWeather(ds, f, position);
          continue;
        }
        if (layer.id === 'aircraft') {
          addAircraft(ds, f);
          continue;
        }
        if (layer.id === 'ships') {
          addShip(ds, f, position);
          continue;
        }
        ds.entities.add(
          layer.glyph
            ? {
                id: f.properties.id,
                position,
                billboard: { ...GROUND, image: glyphIcon(layer.color, layer.glyph), scale: 0.5 },
              }
            : {
                id: f.properties.id,
                position,
                point: {
                  ...GROUND,
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
  }, [layers, collections, visible, filters, ready]);

  // Trails behind aircraft (at altitude) and ships, and the selected one's full path.
  const tails = useTracks((s) => s.tails);
  const selectedTrack = useTracks((s) => s.selected);
  const trails = useUi((s) => s.trails);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    const ds = new Cesium.CustomDataSource('paths');
    void viewer.dataSources.add(ds);
    const nowAt = (f: Feature): [number, number] | undefined => pointOf(aircraftNow([f], Date.now())[0]!);
    for (const layer of layers) {
      if (!layer.tracks || !isVisible(layer, visible)) continue;
      const air = layer.id === 'aircraft';
      const items = new Map(shownFeatures(layer, collections[layer.id], filters).map((f) => [f.properties.id, f]));
      const color = Cesium.Color.fromCssColorString(TRAIL_COLORS[layer.id] ?? layer.color).withAlpha(0.65);
      if (trails[layer.id] !== false) {
        for (const t of tails[layer.id]?.features ?? []) {
          const f = items.get(t.properties.id);
          if (t.geometry?.type !== 'LineString' || !f) continue;
          const coords = t.geometry.coordinates;
          if (air) {
            const fixed = coords.flatMap((c) => [c[0], c[1], c[2] ?? 0]);
            const alt = Number(f.properties.style?.altM ?? coords[coords.length - 1]?.[2] ?? 0);
            ds.entities.add({
              id: `trail:${t.properties.id}`,
              polyline: {
                // Ends where the aircraft is drawn now, which moves on between reports.
                positions: new Cesium.CallbackProperty(() => {
                  const at = nowAt(f);
                  return Cesium.Cartesian3.fromDegreesArrayHeights(at ? [...fixed, at[0], at[1], alt] : fixed);
                }, false),
                width: 2,
                material: color,
              },
            });
          } else {
            ds.entities.add({
              id: `trail:${t.properties.id}`,
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(coords.flatMap((c) => [c[0], c[1]])),
                clampToGround: true,
                width: 2,
                material: color,
              },
            });
          }
        }
      }
      // The selected item's whole known path, coloured by altitude for aircraft.
      const sel = selectedTrack && items.get(selectedTrack.id);
      if (sel && selectedTrack.points.length > 1) {
        const pts = selectedTrack.points;
        if (air) {
          for (let i = 1; i < pts.length; i++) {
            const [a, b] = [pts[i - 1]!, pts[i]!];
            const band = planeBand(b[3] === 0 ? 'ground' : undefined, b[3] === null ? undefined : b[3] / 0.3048);
            ds.entities.add({
              id: `trail:path:${i}`,
              polyline: {
                positions: Cesium.Cartesian3.fromDegreesArrayHeights([a[0], a[1], a[3] ?? 0, b[0], b[1], b[3] ?? 0]),
                width: 4,
                material: new Cesium.PolylineOutlineMaterialProperty({
                  color: Cesium.Color.fromCssColorString(PLANE_COLORS[band]),
                  outlineColor: Cesium.Color.WHITE,
                  outlineWidth: 1,
                }),
              },
            });
          }
        } else {
          ds.entities.add({
            id: 'trail:path',
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(pts.flatMap((p) => [p[0], p[1]])),
              clampToGround: true,
              width: 4,
              material: Cesium.Color.fromCssColorString(TRAIL_COLORS.ships!),
            },
          });
        }
      }
    }
    viewer.scene.requestRender();
    return () => {
      if (!viewer.isDestroyed()) void viewer.dataSources.remove(ds, true);
    };
  }, [ready, layers, collections, visible, filters, trails, tails, selectedTrack]);

  // Aircraft move on between reports, so redraw once a second while they are shown.
  const aircraftOn = layers.some((l) => l.id === 'aircraft' && isVisible(l, visible));
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready || !aircraftOn) return;
    const timer = setInterval(() => viewer.scene.requestRender(), 1000);
    return () => clearInterval(timer);
  }, [ready, aircraftOn]);

  // Radar and cloud images: one imagery layer per frame, the next frame loaded invisibly.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    const known = imageryRef.current;
    for (const layer of layers) {
      const r = layer.raster;
      if (!r) continue;
      const on = isVisible(layer, visible) && r.frames.length > 0;
      const index = frameIndex(layer, frame);
      const current = r.frames[index]?.url;
      const next = r.frames.length > 1 ? r.frames[(index + 1) % r.frames.length]?.url : undefined;
      if (on) {
        for (const url of [current, next]) {
          if (!url || known.has(url)) continue;
          const imagery = viewer.imageryLayers.addImageryProvider(
            new Cesium.UrlTemplateImageryProvider({
              url: absoluteTileUrl(url),
              maximumLevel: r.maxzoom,
              tileWidth: r.tileSize,
              tileHeight: r.tileSize,
              credit: layer.attribution,
            }),
          );
          known.set(url, { layerId: layer.id, imagery });
        }
      }
      const urls = new Set(r.frames.map((f) => f.url));
      for (const [url, entry] of known) {
        if (entry.layerId !== layer.id) continue;
        if (!urls.has(url)) {
          viewer.imageryLayers.remove(entry.imagery, true);
          known.delete(url);
          continue;
        }
        entry.imagery.show = on;
        entry.imagery.alpha = url === current ? r.opacity : 0;
      }
    }
    viewer.scene.requestRender();
  }, [layers, visible, frame, ready]);

  // The selected earthquake: distance rings, nearby provinces and aftershocks.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    const ds = new Cesium.CustomDataSource('focus');
    void viewer.dataSources.add(ds);
    if (focus) {
      const red = Cesium.Color.fromCssColorString(FOCUS_COLOR);
      focus.provinces.forEach((p, i) => {
        const polys = p.geometry.type === 'Polygon' ? [p.geometry.coordinates] : p.geometry.coordinates;
        polys.forEach((rings, j) => {
          ds.entities.add({
            id: `focus:province:${i}:${j}`,
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(rings[0]!.flatMap((c) => [c[0], c[1]])),
              clampToGround: true,
              width: 2,
              material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.fromCssColorString(PROVINCE_LINE_COLOR).withAlpha(0.85),
                dashLength: 10,
              }),
            },
          });
        });
      });
      for (const ring of focus.rings) {
        const coords = ring.geometry.coordinates[0]!;
        ds.entities.add({
          id: `focus:ring:${ring.km}`,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(coords.flatMap((c) => [c[0], c[1]])),
            clampToGround: true,
            width: 2.5,
            material: new Cesium.PolylineDashMaterialProperty({ color: red, dashLength: 14 }),
          },
        });
        ds.entities.add({
          id: `focus:ring-label:${ring.km}`,
          position: Cesium.Cartesian3.fromDegrees(coords[0]![0], coords[0]![1]),
          label: {
            ...GROUND,
            text: `${ring.km} km`,
            font: 'bold 13px system-ui, sans-serif',
            fillColor: red,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          },
        });
      }
      for (const a of focus.aftershocks) {
        const at = pointOf(a);
        if (!at) continue;
        ds.entities.add({
          id: `focus:after:${a.properties.id}`,
          position: Cesium.Cartesian3.fromDegrees(at[0], at[1]),
          point: {
            ...GROUND,
            // A thin ring just outside the aftershock's own marker.
            pixelSize: Math.max(5, Math.min(30, 4 + (a.properties.value ?? 0) * 3.5)) + 6,
            color: Cesium.Color.TRANSPARENT,
            outlineColor: Cesium.Color.fromCssColorString(AFTERSHOCK_COLOR),
            outlineWidth: 2,
          },
        });
      }
      ds.entities.add({
        id: 'focus:main',
        position: Cesium.Cartesian3.fromDegrees(focus.centre[0], focus.centre[1]),
        point: {
          ...GROUND,
          pixelSize: Math.max(18, Math.min(60, 10 + focus.magnitude * 5)),
          color: Cesium.Color.TRANSPARENT,
          outlineColor: red,
          outlineWidth: 3,
        },
      });
    }
    viewer.scene.requestRender();
    return () => {
      if (!viewer.isDestroyed()) void viewer.dataSources.remove(ds, true);
    };
  }, [focus, ready]);

  // 3D buildings: OSM (default), Google's photorealistic tiles, or none.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready || !hasToken) return;
    let cancelled = false;
    if (tilesetRef.current) viewer.scene.primitives.remove(tilesetRef.current);
    tilesetRef.current = undefined;
    viewer.scene.globe.show = true;

    const show = (tileset: Cesium.Cesium3DTileset, status: BuildingsStatus) => {
      if (cancelled || viewer.isDestroyed()) {
        tileset.destroy();
        return;
      }
      viewer.scene.primitives.add(tileset);
      tilesetRef.current = tileset;
      // Google's tiles carry their own terrain and imagery; the globe would cover them.
      viewer.scene.globe.show = status !== 'google';
      setBuildings(status);
      viewer.scene.requestRender();
    };
    const osm = async (status: BuildingsStatus) => {
      try {
        show(await Cesium.createOsmBuildingsAsync({ style: OSM_STYLE }), status);
      } catch {
        if (!cancelled) setBuildings('failed');
      }
    };

    if (buildingsMode === 'off') {
      setBuildings('off');
      viewer.scene.requestRender();
    } else if (buildingsMode === 'google') {
      setBuildings('loading');
      // Dürbün has no search box, so no other geocoder is used alongside Google's tiles.
      Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true })
        .then((t) => show(t, 'google'))
        .catch(() => osm('google-failed'));
    } else {
      setBuildings('loading');
      void osm('osm');
    }
    return () => {
      cancelled = true;
    };
  }, [ready, hasToken, buildingsMode]);

  // The route: a line on the ground from where you are to the chosen place.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    const ds = new Cesium.CustomDataSource('route');
    void viewer.dataSources.add(ds);
    const draw = (framing: boolean) => {
      const r = useRoute.getState();
      ds.entities.removeAll();
      if (r.status === 'ready' && r.result) {
        const coords = r.result.geometry.coordinates as [number, number][];
        ds.entities.add({
          id: 'route:line',
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(coords.flat()),
            width: 6,
            clampToGround: true,
            material: Cesium.Color.fromCssColorString(ROUTE_COLORS[r.result.mode]),
          },
        });
        if (r.from) {
          ds.entities.add({
            id: 'route:start',
            position: Cesium.Cartesian3.fromDegrees(r.from[0], r.from[1]),
            point: {
              pixelSize: 14,
              color: Cesium.Color.fromCssColorString('#1a73e8'),
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 3,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
        }
        if (framing) {
          const [w, s, e, n] = lineBounds(coords);
          const padLng = (e - w) * 0.3 + 0.002;
          const padLat = (n - s) * 0.3 + 0.002;
          viewer.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(w - padLng, s - padLat, e + padLng, n + padLat) });
        }
      }
      viewer.scene.requestRender();
    };
    draw(false);
    const unsubscribe = useRoute.subscribe((r, prev) => draw(r.result !== prev.result));
    return () => {
      unsubscribe();
      if (!viewer.isDestroyed()) void viewer.dataSources.remove(ds, true);
    };
  }, [ready]);

  // Fly to a feature, or frame an area, when a panel asks for it.
  useEffect(() => {
    const onFly = (e: Event) => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const [lng, lat, zoom] = (e as CustomEvent<FlyDetail>).detail;
      const height = zoom === undefined ? 4000 : rangeFromZoom(lat, zoom, viewportHeight(viewer), fovy(viewer));
      viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lng, lat, height) });
    };
    const onFit = (e: Event) => {
      const [w, s, e2, n] = (e as CustomEvent<[number, number, number, number]>).detail;
      viewerRef.current?.camera.flyTo({ destination: Cesium.Rectangle.fromDegrees(w, s, e2, n) });
    };
    window.addEventListener('durbun:fly', onFly);
    window.addEventListener('durbun:fit', onFit);
    return () => {
      window.removeEventListener('durbun:fly', onFly);
      window.removeEventListener('durbun:fit', onFit);
    };
  }, []);

  return (
    <div className="globe-wrap">
      <div ref={container} className="map" aria-label="3B harita" />
      {ready && viewerRef.current && <GlobeControls viewer={viewerRef.current} buildingsAvailable={Boolean(hasToken)} />}
      {hasToken === false && <div className="globe-hint">{t(lang, 'globeNoToken')}</div>}
      {hasToken && buildings === 'google' && <div className="globe-hint">{t(lang, 'googleFlatInTurkey')}</div>}
      {hasToken && buildings === 'google-failed' && <div className="globe-hint">{t(lang, 'globeOsmFallback')}</div>}
    </div>
  );
}
