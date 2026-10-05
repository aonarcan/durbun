import type { StyleSpecification } from 'maplibre-gl';
import type { ViewMode } from '../state.ts';

const OPENFREEMAP = 'https://tiles.openfreemap.org/styles';
export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const FONT_REGULAR = ['Noto Sans Regular'];
export const FONT_BOLD = ['Noto Sans Bold'];

const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
export const ESRI_IMAGERY_URL = ESRI_IMAGERY;
export const ESRI_CREDIT = 'Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const satellite: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    imagery: {
      type: 'raster',
      tiles: [ESRI_IMAGERY],
      tileSize: 256,
      maxzoom: 19,
      attribution: `Imagery © ${ESRI_CREDIT}`,
    },
    labels: { type: 'raster', tiles: [ESRI_LABELS], tileSize: 256, maxzoom: 19 },
  },
  layers: [
    { id: 'imagery', type: 'raster', source: 'imagery' },
    { id: 'labels', type: 'raster', source: 'labels' },
  ],
};

/** Basemap for each 2D view: OpenFreeMap vector styles, or Esri imagery for satellite. */
export function styleFor(view: Exclude<ViewMode, '3d'>): string | StyleSpecification {
  switch (view) {
    case 'satellite':
      return satellite;
    case 'dark':
      return `${OPENFREEMAP}/dark`;
    default:
      return `${OPENFREEMAP}/liberty`;
  }
}
