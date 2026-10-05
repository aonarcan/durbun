import type { Feature, FeatureCollection, LayerSummary } from '@durbun/core';
import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { FONT_BOLD } from './basemaps.ts';

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

export const sourceId = (layerId: string) => `durbun-${layerId}`;

/** Style layer ids for a data layer, in drawing order. */
export function styleLayerIds(layerId: string): string[] {
  return [`${sourceId(layerId)}-circle`, `${sourceId(layerId)}-label`];
}

/**
 * Adds derived properties the map styles use. MapLibre expressions can't read
 * dates, so earthquake age is computed here in hours.
 */
export function prepare(features: Feature[], now = Date.now()): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => {
      const observed = f.properties.observedAt ? new Date(f.properties.observedAt).getTime() : NaN;
      const ageHours = Number.isFinite(observed) ? (now - observed) / 3_600_000 : 9999;
      // Nested objects become strings inside MapLibre, so details stay out; the info panel reads the original.
      const { details: _details, ...props } = f.properties;
      return { ...f, id: undefined, properties: { ...props, ageHours } as typeof f.properties };
    }),
  };
}

function kindColor(fallback: string): ExpressionSpecification {
  const pairs = Object.entries(KIND_COLORS).flat();
  return ['match', ['get', 'kind'], ...pairs, fallback] as unknown as ExpressionSpecification;
}

function specsFor(layer: LayerSummary): LayerSpecification[] {
  const [circleId, labelId] = styleLayerIds(layer.id) as [string, string];
  const source = sourceId(layer.id);

  if (layer.id === 'earthquakes') {
    return [
      {
        id: circleId,
        type: 'circle',
        source,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'value'], 0, 2.5, 2, 4, 3, 7, 4, 11, 5, 16, 6, 22, 7, 30],
          'circle-color': ['step', ['get', 'ageHours'], '#a50f15', 1, '#e34a33', 24, '#fc8d59', 72, '#fdbb84'],
          'circle-opacity': ['step', ['get', 'ageHours'], 0.95, 24, 0.8, 72, 0.6],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['step', ['get', 'value'], 0.5, 3, 1.5],
        },
        // Newest and largest on top.
      },
      {
        id: labelId,
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

  const color = layer.id === 'incidents' ? kindColor(layer.color) : layer.color;
  const specs: LayerSpecification[] = [
    {
      id: circleId,
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
      id: labelId,
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

/** Adds (or refreshes) every data layer on the map. Safe to call after each style change. */
export function syncDataLayers(
  map: MapLibreMap,
  layers: LayerSummary[],
  featuresFor: (layer: LayerSummary) => Feature[],
  isOn: (layer: LayerSummary) => boolean,
): void {
  for (const layer of layers) {
    const src = sourceId(layer.id);
    const data = prepare(featuresFor(layer)) as unknown as Parameters<GeoJSONSource['setData']>[0];
    const existing = map.getSource(src);
    if (existing && 'setData' in existing) {
      (existing as GeoJSONSource).setData(data);
    } else if (!existing) {
      map.addSource(src, { type: 'geojson', data: data as never });
      for (const spec of specsFor(layer)) map.addLayer(spec);
    }
    for (const id of styleLayerIds(layer.id)) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', isOn(layer) ? 'visible' : 'none');
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
  // Insert below the first data layer so markers stay on top of the line.
  const before = map.getStyle().layers?.find((l) => l.id.startsWith('durbun-') && !l.id.startsWith(ROUTE_SOURCE))?.id;
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
