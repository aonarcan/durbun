import type { Feature, FeatureCollection, LayerSummary } from '@durbun/core';
import type {
  ExpressionSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap,
  RasterLayerSpecification,
} from 'maplibre-gl';
import type { QuakeFocus } from './quake.ts';
import { FONT_BOLD } from './basemaps.ts';
import { imageData, mapImages, PLANE_COLORS, planeBand, SHIP_COLORS } from './icons.ts';

/** Colours for İBB notice kinds; shared by the 2D and 3D views. */
export const KIND_COLORS: Record<string, string> = {
  accident: '#d62728',
  breakdown: '#ff7f0e',
  roadworks: '#e6b400',
  closure: '#7b3294',
  weather: '#1f77b4',
  congestion: '#b2182b',
  ferry: '#17becf',
  fire: '#8c2d04',
  event: '#2ca02c',
  info: '#4c78a8',
};

/** Earthquake colour by age: [from hours, colour]; newest darkest. */
export const QUAKE_AGE_COLORS: [number, string][] = [
  [0, '#a50f15'],
  [1, '#e34a33'],
  [24, '#fc8d59'],
  [72, '#fdbb84'],
];

export function quakeColor(ageHours: number): string {
  let color = QUAKE_AGE_COLORS[0]![1];
  for (const [from, c] of QUAKE_AGE_COLORS) if (ageHours >= from) color = c;
  return color;
}

/** MGM warning levels. */
export const WARNING_COLORS: Record<string, string> = {
  yellow: '#ffd60a',
  orange: '#ff8c00',
  red: '#e5001b',
};

/** Temperature (°C) → colour, cold blue to hot red; dark enough for white text. */
export const TEMP_STOPS: [number, string][] = [
  [-15, '#3f2a8c'],
  [-5, '#2c5fb8'],
  [5, '#2a8bb0'],
  [15, '#3f9a5a'],
  [22, '#c98a12'],
  [30, '#d1501f'],
  [40, '#8e1a1a'],
];

export function tempColor(t: number | undefined): string {
  if (t === undefined || !Number.isFinite(t)) return '#7a8394';
  const stops = TEMP_STOPS;
  if (t <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!;
    const [t0, c0] = stops[i - 1]!;
    if (t <= t1) return mix(c0, c1, (t - t0) / (t1 - t0));
  }
  return stops[stops.length - 1]![1];
}

function mix(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((i) => Number.parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => Number.parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i]! - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

export const sourceId = (layerId: string) => `durbun-${layerId}`;

/** Style layer ids for a data layer, in drawing order (none for image layers). */
export function styleLayerIds(layer: Pick<LayerSummary, 'id' | 'shape' | 'raster' | 'listed'>): string[] {
  const s = sourceId(layer.id);
  if (layer.raster) return [];
  if (layer.shape === 'areas') return [`${s}-fill`, `${s}-line`];
  if (layer.id === 'weather-now') return [`${s}-circle`, `${s}-label`, `${s}-arrow`];
  if (layer.id === 'aircraft' || layer.id === 'ships') return [`${s}-icon`, `${s}-label`];
  if (layer.listed) return [`${s}-cluster`, `${s}-count`, `${s}-circle`];
  return [`${s}-circle`, `${s}-label`];
}

const POINT_SUFFIX = /-(circle|label|arrow|icon|cluster|count)$/;

/** Colours for strait states and fire confidence; shared with 3D. */
export const STRAIT_COLORS: Record<string, string> = {
  open: '#2f9e44',
  suspended: '#e03131',
  partial: '#f08c00',
  unplanned: '#868e96',
};
export const FIRE_COLORS: Record<string, string> = { low: '#fcc419', nominal: '#ff6a00', high: '#c92a2a' };

/**
 * Adds derived properties the map styles use. MapLibre expressions can't read
 * dates or nested objects, so age and "in force now" are computed here and
 * style values are flattened to s_<name>.
 */
export function prepare(features: Feature[], now = Date.now()): FeatureCollection {
  return {
    type: 'FeatureCollection',
    // Items without a place (most news) are listed in the panel, not drawn.
    features: features.filter((f) => f.geometry).map((f) => {
      const observed = f.properties.observedAt ? new Date(f.properties.observedAt).getTime() : NaN;
      const ageHours = Number.isFinite(observed) ? (now - observed) / 3_600_000 : 9999;
      const active = !(observed > now) ? 1 : 0;
      // Nested objects become strings inside MapLibre, so details stay out; the info panel reads the original.
      const { details: _details, style, ...props } = f.properties;
      const flat = Object.fromEntries(Object.entries(style ?? {}).map(([k, v]) => [`s_${k}`, v]));
      return { ...f, id: undefined, properties: { ...props, ...flat, ageHours, active } as typeof f.properties };
    }),
  };
}

function kindColor(colors: Record<string, string>, fallback: string): ExpressionSpecification {
  const pairs = Object.entries(colors).flat();
  return ['match', ['get', 'kind'], ...pairs, fallback] as unknown as ExpressionSpecification;
}

/** Earthquake marker radius in pixels by magnitude. */
const QUAKE_RADIUS = ['interpolate', ['linear'], ['get', 'value'], 0, 2.5, 2, 4, 3, 7, 4, 11, 5, 16, 6, 22, 7, 30] as unknown as ExpressionSpecification;

const tempExpression = [
  'case',
  ['has', 'value'],
  ['interpolate', ['linear'], ['get', 'value'], ...TEMP_STOPS.flat()],
  '#7a8394',
] as unknown as ExpressionSpecification;

function specsFor(layer: LayerSummary): LayerSpecification[] {
  const ids = styleLayerIds(layer);
  const source = sourceId(layer.id);

  if (layer.shape === 'areas') {
    const color = kindColor(WARNING_COLORS, layer.color);
    return [
      {
        id: ids[0]!,
        type: 'fill',
        source,
        // Warnings already in force are stronger than those still to come.
        paint: { 'fill-color': color, 'fill-opacity': ['case', ['==', ['get', 'active'], 1], 0.38, 0.16] },
      },
      {
        id: ids[1]!,
        type: 'line',
        source,
        paint: { 'line-color': color, 'line-width': ['case', ['==', ['get', 'active'], 1], 2, 1], 'line-opacity': 0.9 },
      },
    ];
  }

  if (layer.id === 'earthquakes') {
    return [
      {
        id: ids[0]!,
        type: 'circle',
        source,
        // Newest on top.
        layout: { 'circle-sort-key': ['-', 0, ['get', 'ageHours']] },
        paint: {
          'circle-radius': QUAKE_RADIUS,
          'circle-color': ['step', ['get', 'ageHours'], ...QUAKE_AGE_COLORS.flat().slice(1)] as unknown as ExpressionSpecification,
          'circle-opacity': ['step', ['get', 'ageHours'], 0.95, 24, 0.8, 72, 0.6],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['step', ['get', 'value'], 0.5, 3, 1.5],
        },
      },
      {
        id: ids[1]!,
        type: 'symbol',
        source,
        filter: ['>=', ['get', 'value'], 3],
        layout: {
          'text-field': ['concat', 'M', ['to-string', ['get', 'value']]],
          'text-font': FONT_BOLD,
          'text-size': 11,
          'text-offset': [0, 1.6],
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#7f0000', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      },
    ];
  }

  if (layer.id === 'weather-now') {
    return [
      {
        id: ids[2]!,
        type: 'symbol',
        source,
        filter: ['has', 's_windDir'],
        layout: {
          'icon-image': ARROW_IMAGE,
          // The arrow points where the wind blows to, so it sits on the downwind side of the dot.
          'icon-rotate': ['+', ['get', 's_windDir'], 180],
          'icon-rotation-alignment': 'map',
          'icon-offset': [0, -25],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      },
      {
        id: ids[0]!,
        type: 'circle',
        source,
        paint: {
          'circle-radius': 13,
          'circle-color': tempExpression,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      },
      {
        id: ids[1]!,
        type: 'symbol',
        source,
        layout: {
          'text-field': ['case', ['has', 'value'], ['concat', ['to-string', ['round', ['get', 'value']]], '°'], '–'],
          'text-font': FONT_BOLD,
          'text-size': 11,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#ffffff' },
      },
    ];
  }

  if (layer.id === 'aircraft') {
    const band = [
      'case',
      ['==', ['get', 'kind'], 'emergency'],
      'durbun-plane-emergency',
      ['==', ['get', 'kind'], 'ground'],
      'durbun-plane-ground',
      ['<', ['coalesce', ['get', 'value'], 0], 10000],
      'durbun-plane-low',
      ['<', ['coalesce', ['get', 'value'], 0], 25000],
      'durbun-plane-mid',
      'durbun-plane-high',
    ] as unknown as ExpressionSpecification;
    return [
      {
        id: ids[0]!,
        type: 'symbol',
        source,
        layout: {
          'icon-image': band,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.75, 10, 1] as unknown as ExpressionSpecification,
          'icon-rotate': ['coalesce', ['get', 's_track'], 0] as unknown as ExpressionSpecification,
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-sort-key': ['coalesce', ['get', 'value'], 0] as unknown as ExpressionSpecification,
        },
      },
      {
        id: ids[1]!,
        type: 'symbol',
        source,
        minzoom: 8,
        layout: {
          'text-field': ['get', 'title'],
          'text-font': FONT_BOLD,
          'text-size': 10,
          'text-offset': [0, 1.5],
          'text-optional': true,
        },
        paint: { 'text-color': '#14213d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      },
    ];
  }

  if (layer.id === 'ships') {
    const cats = Object.keys(SHIP_COLORS);
    const icon = [
      'case',
      ['==', ['get', 's_moving'], 1],
      ['match', ['get', 'kind'], ...cats.flatMap((c) => [c, `durbun-ship-${c}`]), 'durbun-ship-unknown'],
      ['match', ['get', 'kind'], ...cats.flatMap((c) => [c, `durbun-ship-still-${c}`]), 'durbun-ship-still-unknown'],
    ] as unknown as ExpressionSpecification;
    return [
      {
        id: ids[0]!,
        type: 'symbol',
        source,
        layout: {
          'icon-image': icon,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.55, 11, 0.9] as unknown as ExpressionSpecification,
          'icon-rotate': ['coalesce', ['get', 's_course'], 0] as unknown as ExpressionSpecification,
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          // Moving ships on top of ships at rest.
          'symbol-sort-key': ['coalesce', ['get', 's_moving'], 0] as unknown as ExpressionSpecification,
        },
      },
      {
        id: ids[1]!,
        type: 'symbol',
        source,
        minzoom: 11,
        layout: {
          'text-field': ['get', 'title'],
          'text-font': FONT_BOLD,
          'text-size': 10,
          'text-offset': [0, 1.4],
          'text-optional': true,
        },
        paint: { 'text-color': '#0b3d3a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      },
    ];
  }

  if (layer.id === 'fires') {
    return [
      {
        id: ids[0]!,
        type: 'circle',
        source,
        layout: { 'circle-sort-key': ['coalesce', ['get', 'value'], 0] as unknown as ExpressionSpecification },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'value'], 0], 0, 3.5, 10, 5, 50, 8, 200, 12] as unknown as ExpressionSpecification,
          'circle-color': kindColor(FIRE_COLORS, layer.color),
          'circle-opacity': ['step', ['get', 'ageHours'], 0.95, 6, 0.75, 12, 0.55] as unknown as ExpressionSpecification,
          'circle-stroke-color': '#4a1500',
          'circle-stroke-width': 0.8,
        },
      },
    ];
  }

  if (layer.id === 'straits') {
    return [
      {
        id: ids[0]!,
        type: 'circle',
        source,
        paint: {
          'circle-radius': 11,
          'circle-color': kindColor(STRAIT_COLORS, layer.color),
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      },
      {
        id: ids[1]!,
        type: 'symbol',
        source,
        layout: {
          'text-field': ['match', ['get', 'id'], 'strait:istanbul', 'İstanbul Boğazı', 'strait:canakkale', 'Çanakkale Boğazı', ''] as unknown as ExpressionSpecification,
          'text-font': FONT_BOLD,
          'text-size': 11,
          'text-offset': [0, 1.8],
          'text-optional': true,
        },
        paint: { 'text-color': '#0b3d4d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 },
      },
    ];
  }

  if (layer.listed) {
    return [
      {
        id: ids[0]!,
        type: 'circle',
        source,
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': ['step', ['get', 'point_count'], 13, 5, 16, 20, 20] as unknown as ExpressionSpecification,
          'circle-color': layer.color,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      },
      {
        id: ids[1]!,
        type: 'symbol',
        source,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': FONT_BOLD,
          'text-size': 12,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      },
      {
        id: ids[2]!,
        type: 'circle',
        source,
        filter: ['!', ['has', 'point_count']],
        paint: { 'circle-radius': 7, 'circle-color': layer.color, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      },
    ];
  }

  const color = layer.id === 'incidents' ? kindColor(KIND_COLORS, layer.color) : layer.color;
  const specs: LayerSpecification[] = [
    {
      id: ids[0]!,
      type: 'circle',
      source,
      paint: {
        'circle-radius': layer.glyph ? 9 : 7,
        'circle-color': color,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    },
  ];
  if (layer.glyph) {
    specs.push({
      id: ids[1]!,
      type: 'symbol',
      source,
      layout: {
        'text-field': layer.glyph,
        'text-font': FONT_BOLD,
        'text-size': 12,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff' },
    });
  }
  return specs;
}

const ARROW_IMAGE = 'durbun-wind-arrow';

/** A dark arrow pointing up, with a white edge, for wind direction (40 px drawn at 2x). */
function arrowImage(): ImageData {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.moveTo(20, 3);
  ctx.lineTo(32, 22);
  ctx.lineTo(23.5, 18.5);
  ctx.lineTo(23.5, 37);
  ctx.lineTo(16.5, 37);
  ctx.lineTo(16.5, 18.5);
  ctx.lineTo(8, 22);
  ctx.closePath();
  ctx.fillStyle = '#14213d';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

/** The basemap's first label layer: areas and images go under it so place names stay readable. */
function labelAnchor(map: MapLibreMap): string | undefined {
  return map
    .getStyle()
    .layers?.find((l) => !l.id.startsWith('durbun-') && (l.type === 'symbol' || l.id === 'labels'))?.id;
}

/** First of Dürbün's point layers: the route and image layers go under these. */
function firstPointLayer(map: MapLibreMap): string | undefined {
  return map
    .getStyle()
    .layers?.find((l) => l.id.startsWith('durbun-') && !l.id.startsWith('durbun-focus') && !l.id.startsWith('durbun-route') && POINT_SUFFIX.test(l.id))?.id;
}

/** Adds (or refreshes) every feature layer on the map. Safe to call after each style change. */
export function syncDataLayers(
  map: MapLibreMap,
  layers: LayerSummary[],
  featuresFor: (layer: LayerSummary) => Feature[],
  isOn: (layer: LayerSummary) => boolean,
): void {
  if (!map.hasImage(ARROW_IMAGE)) map.addImage(ARROW_IMAGE, arrowImage(), { pixelRatio: 2 });
  if (!map.hasImage('durbun-plane-low')) {
    for (const [name, c] of Object.entries(mapImages())) map.addImage(name, imageData(c), { pixelRatio: 2 });
  }
  // Areas first so points always end up above them.
  const ordered = [...layers.filter((l) => l.shape === 'areas'), ...layers.filter((l) => l.shape !== 'areas')];
  for (const layer of ordered) {
    if (layer.raster) continue;
    const src = sourceId(layer.id);
    const data = prepare(featuresFor(layer)) as unknown as Parameters<GeoJSONSource['setData']>[0];
    const existing = map.getSource(src);
    if (existing && 'setData' in existing) {
      (existing as GeoJSONSource).setData(data);
    } else if (!existing) {
      map.addSource(src, {
        type: 'geojson',
        data: data as never,
        // News pins in the same province gather into one numbered circle.
        ...(layer.listed ? { cluster: true, clusterRadius: 36, clusterMaxZoom: 9 } : {}),
      });
      const before = layer.shape === 'areas' ? labelAnchor(map) : undefined;
      for (const spec of specsFor(layer)) map.addLayer(spec, before);
    }
    for (const id of styleLayerIds(layer)) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', isOn(layer) ? 'visible' : 'none');
    }
  }
}

// ---- image layers (radar, clouds) ----

const rasterIds = new Map<string, string>();
const rasterUrls = new Map<string, string>();

function rasterLayerId(layerId: string, url: string): string {
  let id = rasterIds.get(url);
  if (!id) {
    id = `durbun-r-${layerId}-${rasterIds.size}`;
    rasterIds.set(url, id);
    rasterUrls.set(id, url);
  }
  return id;
}

/** Tile templates from our own server are relative; tile loaders need full URLs. */
export function absoluteTileUrl(url: string): string {
  return url.startsWith('/') ? `${location.origin}${url}` : url;
}

/**
 * Shows one frame of each image layer. Each frame gets its own map layer, and
 * the next frame is loaded invisibly so an animation doesn't flash blank.
 */
export function syncRasters(
  map: MapLibreMap,
  layers: LayerSummary[],
  isOn: (layer: LayerSummary) => boolean,
  frameOf: (layer: LayerSummary) => number,
): void {
  for (const layer of layers) {
    const r = layer.raster;
    if (!r) continue;
    const on = isOn(layer) && r.frames.length > 0;
    const prefix = `durbun-r-${layer.id}-`;
    const urls = new Set(r.frames.map((f) => f.url));
    const index = frameOf(layer);
    const current = r.frames[index]?.url;
    const next = r.frames.length > 1 ? r.frames[(index + 1) % r.frames.length]?.url : undefined;

    if (on) {
      for (const url of [current, next]) {
        if (!url) continue;
        const id = rasterLayerId(layer.id, url);
        if (map.getLayer(id)) continue;
        map.addSource(id, { type: 'raster', tiles: [absoluteTileUrl(url)], tileSize: r.tileSize, maxzoom: r.maxzoom });
        const spec: RasterLayerSpecification = {
          id,
          type: 'raster',
          source: id,
          paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 },
        };
        const before =
          map.getStyle().layers?.find((l) => l.id.startsWith('durbun-') && l.id.endsWith('-fill'))?.id ?? labelAnchor(map);
        map.addLayer(spec, before);
      }
    }

    for (const l of map.getStyle().layers ?? []) {
      if (!l.id.startsWith(prefix)) continue;
      const url = rasterUrls.get(l.id);
      if (!url || !urls.has(url)) {
        // This frame dropped out of the source's list.
        map.removeLayer(l.id);
        map.removeSource(l.id);
        continue;
      }
      map.setLayoutProperty(l.id, 'visibility', on ? 'visible' : 'none');
      map.setPaintProperty(l.id, 'raster-opacity', url === current ? r.opacity : 0);
    }
  }
}

/**
 * Shows place names in Turkish where OSM has them (name:tr), else the local
 * name; English viewers get name:en first.
 */
export function localiseLabels(map: MapLibreMap, lang: 'tr' | 'en'): void {
  const order = lang === 'tr' ? ['name:tr', 'name:latin', 'name'] : ['name:en', 'name:latin', 'name'];
  const field = ['coalesce', ...order.map((k) => ['get', k])] as unknown as ExpressionSpecification;
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type !== 'symbol' || layer.id.startsWith('durbun-')) continue;
    const current = map.getLayoutProperty(layer.id, 'text-field');
    if (current === undefined) continue;
    const text = JSON.stringify(current);
    // Only replace plain name labels; keep road numbers, house numbers and the like.
    if (/name/.test(text) && !/ref|housenumber/.test(text)) {
      map.setLayoutProperty(layer.id, 'text-field', field);
    }
  }
}

// ---- earthquake view ----

const FOCUS_SOURCE = 'durbun-focus';
export const FOCUS_COLOR = '#b30000';
export const AFTERSHOCK_COLOR = '#ffcc00';
export const PROVINCE_LINE_COLOR = '#6a3d9a';

/** GeoJSON for the selected earthquake's rings, provinces and aftershocks. */
export function focusFeatures(focus: QuakeFocus | undefined): FeatureCollection {
  if (!focus) return { type: 'FeatureCollection', features: [] };
  const f = (geometry: unknown, properties: Record<string, unknown>) =>
    ({ type: 'Feature', geometry, properties }) as unknown as Feature;
  return {
    type: 'FeatureCollection',
    features: [
      ...focus.provinces.map((p) => f(p.geometry, { part: 'province', name: p.name })),
      ...focus.rings.flatMap((r) => [
        f({ type: 'LineString', coordinates: r.geometry.coordinates[0] }, { part: 'ring', km: r.km }),
        // The ring's first point is due north of the epicentre.
        f({ type: 'Point', coordinates: r.geometry.coordinates[0]![0] }, { part: 'ring-label', label: `${r.km} km` }),
      ]),
      ...focus.aftershocks.map((a) => f(a.geometry, { part: 'aftershock', value: a.properties.value ?? 0 })),
      f({ type: 'Point', coordinates: focus.centre }, { part: 'main', value: focus.magnitude }),
    ],
  };
}

/** Draws (or clears) the earthquake view on top of everything. */
export function syncFocus(map: MapLibreMap, focus: QuakeFocus | undefined): void {
  const data = focusFeatures(focus) as unknown as Parameters<GeoJSONSource['setData']>[0];
  const existing = map.getSource(FOCUS_SOURCE) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
    return;
  }
  map.addSource(FOCUS_SOURCE, { type: 'geojson', data: data as never });
  const part = (p: string) => ['==', ['get', 'part'], p] as unknown as ExpressionSpecification;
  map.addLayer({
    id: `${FOCUS_SOURCE}-province`,
    type: 'line',
    source: FOCUS_SOURCE,
    filter: part('province'),
    paint: { 'line-color': PROVINCE_LINE_COLOR, 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
  });
  map.addLayer({
    id: `${FOCUS_SOURCE}-ring`,
    type: 'line',
    source: FOCUS_SOURCE,
    filter: part('ring'),
    paint: { 'line-color': FOCUS_COLOR, 'line-width': 1.8, 'line-dasharray': [4, 3] },
  });
  map.addLayer({
    id: `${FOCUS_SOURCE}-ring-label`,
    type: 'symbol',
    source: FOCUS_SOURCE,
    filter: part('ring-label'),
    layout: { 'text-field': ['get', 'label'], 'text-font': FONT_BOLD, 'text-size': 11, 'text-allow-overlap': true },
    paint: { 'text-color': FOCUS_COLOR, 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });
  // A yellow halo just under each aftershock's own marker, so clusters stay readable.
  const quakeCircles = `${sourceId('earthquakes')}-circle`;
  map.addLayer(
    {
      id: `${FOCUS_SOURCE}-aftershock`,
      type: 'circle',
      source: FOCUS_SOURCE,
      filter: part('aftershock'),
      paint: {
        'circle-radius': ['+', QUAKE_RADIUS, 3] as unknown as ExpressionSpecification,
        'circle-color': AFTERSHOCK_COLOR,
        'circle-opacity': 0.9,
      },
    },
    map.getLayer(quakeCircles) ? quakeCircles : undefined,
  );
  map.addLayer({
    id: `${FOCUS_SOURCE}-main`,
    type: 'circle',
    source: FOCUS_SOURCE,
    filter: part('main'),
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'value'], 0, 9, 3, 12, 5, 21, 7, 36],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': FOCUS_COLOR,
      'circle-stroke-width': 3,
    },
  });
}

// ---- directions ----

const ROUTE_SOURCE = 'durbun-route';
export const ROUTE_COLORS = { car: '#1a73e8', foot: '#0b8043' } as const;

export interface RouteDrawing {
  mode: 'car' | 'foot';
  coordinates: [number, number][];
  from?: [number, number];
}

/** Draws (or removes) the current route under the data markers, so the destination stays clickable. */
export function syncRoute(map: MapLibreMap, route: RouteDrawing | undefined): void {
  const features = route
    ? [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: route.coordinates },
          properties: { part: 'line', mode: route.mode },
        },
        ...(route.from
          ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: route.from }, properties: { part: 'start' } }]
          : []),
      ]
    : [];
  const data = { type: 'FeatureCollection', features } as unknown as Parameters<GeoJSONSource['setData']>[0];
  const existing = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
    return;
  }
  map.addSource(ROUTE_SOURCE, { type: 'geojson', data: data as never });
  // Insert below the first point layer so markers stay on top of the line.
  const before = firstPointLayer(map);
  const lineColor = ['match', ['get', 'mode'], 'foot', ROUTE_COLORS.foot, ROUTE_COLORS.car] as unknown as ExpressionSpecification;
  const isLine = ['==', ['get', 'part'], 'line'] as unknown as ExpressionSpecification;
  map.addLayer(
    {
      id: `${ROUTE_SOURCE}-casing`,
      type: 'line',
      source: ROUTE_SOURCE,
      filter: isLine,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 9 },
    },
    before,
  );
  map.addLayer(
    {
      id: `${ROUTE_SOURCE}-line`,
      type: 'line',
      source: ROUTE_SOURCE,
      filter: isLine,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': lineColor, 'line-width': 5 },
    },
    before,
  );
  map.addLayer(
    {
      id: `${ROUTE_SOURCE}-start`,
      type: 'circle',
      source: ROUTE_SOURCE,
      filter: ['==', ['get', 'part'], 'start'] as unknown as ExpressionSpecification,
      paint: { 'circle-radius': 7, 'circle-color': '#1a73e8', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
    },
    before,
  );
}

/** [west, south, east, north] around a line. */
export function lineBounds(coords: [number, number][]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lng, lat] of coords) {
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return [w, s, e, n];
}

/** A point to fly to for any feature: the point itself, or the middle of an area's bounds. */
export function featureCentre(f: Feature): { lng: number; lat: number; area: boolean } | undefined {
  const g = f.geometry;
  if (!g) return undefined;
  if (g.type === 'Point') return { lng: g.coordinates[0], lat: g.coordinates[1], area: false };
  const coords =
    g.type === 'LineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates.flat() : g.coordinates.flat(2);
  if (coords.length === 0) return undefined;
  const [w, s, e, n] = lineBounds(coords.map((c) => [c[0], c[1]]));
  return { lng: (w + e) / 2, lat: (s + n) / 2, area: true };
}

// ---- paths of aircraft and ships ----

/** [lng, lat, time (ms), altitude (m) or null]. */
export type TrackPoint = [number, number, number, number | null];

export const TRAIL_COLORS: Record<string, string> = { aircraft: '#1f78b4', ships: '#0f766e' };

const tailsSource = (layerId: string) => `durbun-tails-${layerId}`;

/** "#1f78b4" → "rgba(31, 120, 180, 0.8)". */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
const TRACK_SOURCE = 'durbun-track';

/** Trails that end where each aircraft is now (it has moved on since its last report). */
export function tailsReachingNow(tails: FeatureCollection | undefined, current: Feature[]): FeatureCollection {
  const now = new Map(current.flatMap((f) => (f.geometry?.type === 'Point' ? [[f.properties.id, f.geometry.coordinates]] : [])));
  return {
    type: 'FeatureCollection',
    features: (tails?.features ?? []).flatMap((t) => {
      if (t.geometry?.type !== 'LineString') return [];
      const at = now.get(t.properties.id);
      // Items no longer on the map (filtered out, or gone) lose their trail too.
      if (!at) return [];
      return [{ ...t, geometry: { type: 'LineString', coordinates: [...t.geometry.coordinates, [at[0], at[1]]] } } as Feature];
    }),
  };
}

/** The selected item's path. Aircraft paths are split into pieces coloured by altitude. */
export function trackFeatures(points: TrackPoint[], layerId: string, current?: [number, number]): FeatureCollection {
  const pts: TrackPoint[] = current ? [...points, [current[0], current[1], Date.now(), points[points.length - 1]?.[3] ?? null]] : points;
  if (pts.length < 2) return { type: 'FeatureCollection', features: [] };
  const line = (coords: TrackPoint[], color: string): Feature =>
    ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords.map((p) => [p[0], p[1]]) },
      properties: { color },
    }) as unknown as Feature;
  if (layerId !== 'aircraft') return { type: 'FeatureCollection', features: [line(pts, SHIP_COLORS.cargo!)] };
  const features: Feature[] = [];
  for (let i = 1; i < pts.length; i++) {
    const alt = pts[i]![3];
    const band = planeBand(alt === 0 ? 'ground' : undefined, alt === null ? undefined : alt / 0.3048);
    features.push(line([pts[i - 1]!, pts[i]!], PLANE_COLORS[band]));
  }
  return { type: 'FeatureCollection', features };
}

/** Length (km) and duration (ms) of a path. */
export function trackStats(points: TrackPoint[]): { km: number; ms: number } {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const kx = 111.32 * Math.cos((a[1] * Math.PI) / 180);
    km += Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * 110.57);
  }
  return { km, ms: points.length > 1 ? points[points.length - 1]![2] - points[0]![2] : 0 };
}

/** Fading trails under the aircraft and ship icons. */
export function syncTrails(
  map: MapLibreMap,
  layers: LayerSummary[],
  tailsFor: (layer: LayerSummary) => FeatureCollection,
  isOn: (layer: LayerSummary) => boolean,
): void {
  for (const layer of layers) {
    if (!layer.tracks) continue;
    const id = tailsSource(layer.id);
    const data = tailsFor(layer) as unknown as Parameters<GeoJSONSource['setData']>[0];
    const existing = map.getSource(id) as GeoJSONSource | undefined;
    if (existing) existing.setData(data);
    else {
      map.addSource(id, { type: 'geojson', data: data as never, lineMetrics: true });
      const color = TRAIL_COLORS[layer.id] ?? layer.color;
      const icon = `${sourceId(layer.id)}-icon`;
      map.addLayer(
        {
          id,
          type: 'line',
          source: id,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-width': 2,
            // Faint at the tail, strong at the aircraft or ship.
            'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, rgba(color, 0), 1, rgba(color, 0.8)] as unknown as ExpressionSpecification,
          },
        },
        map.getLayer(icon) ? icon : undefined,
      );
    }
    map.setLayoutProperty(id, 'visibility', isOn(layer) ? 'visible' : 'none');
  }
}

/** The selected aircraft's or ship's full path, with a white edge, under the markers. */
export function syncTrack(map: MapLibreMap, fc: FeatureCollection): void {
  const data = fc as unknown as Parameters<GeoJSONSource['setData']>[0];
  const existing = map.getSource(TRACK_SOURCE) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
    return;
  }
  map.addSource(TRACK_SOURCE, { type: 'geojson', data: data as never });
  const before = firstPointLayer(map);
  map.addLayer(
    {
      id: `${TRACK_SOURCE}-casing`,
      type: 'line',
      source: TRACK_SOURCE,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.9 },
    },
    before,
  );
  map.addLayer(
    {
      id: `${TRACK_SOURCE}-line`,
      type: 'line',
      source: TRACK_SOURCE,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'] as unknown as ExpressionSpecification, 'line-width': 3.5 },
    },
    before,
  );
}
