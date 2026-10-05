import type { FeatureCollection, LayerSummary } from '@durbun/core';
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
export function prepare(fc: FeatureCollection | undefined, now = Date.now()): FeatureCollection {
  if (!fc) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
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
  collections: Record<string, FeatureCollection>,
  isOn: (layer: LayerSummary) => boolean,
): void {
  for (const layer of layers) {
    const src = sourceId(layer.id);
    const data = prepare(collections[layer.id]) as unknown as Parameters<GeoJSONSource['setData']>[0];
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
