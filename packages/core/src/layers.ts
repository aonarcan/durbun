/** What the map needs to know about a layer to list it and draw it. */
export interface LayerInfo {
  id: string;
  name: { tr: string; en: string };
  group: LayerGroup;
  /** Main colour, also used for the swatch in the layer list. */
  color: string;
  /** Short label drawn on each point (e.g. "E" for pharmacies). */
  glyph?: string;
  defaultOn: boolean;
  /** Human-readable credit shown with the layer. */
  attribution: string;
  /** Ids of the sources that feed this layer. */
  sources: string[];
  /**
   * For layers of timed events: the time windows (in hours) the viewer can
   * pick from, and the one shown at first. Features older than the window are hidden.
   */
  timeWindows?: { options: number[]; default: number };
  /**
   * A minimum for each feature's numeric value (e.g. earthquake magnitude) the
   * viewer can pick; features below it are hidden.
   */
  minValue?: { label: string; options: number[]; default: number };
  /** Drawn as image tiles instead of features (radar, clouds). */
  raster?: RasterInfo;
  /**
   * "areas" for layers of polygons (drawn as tinted outlines); "network" for
   * lines with stops on them (metro and tram); points otherwise.
   */
  shape?: 'points' | 'areas' | 'network';
  /**
   * Moving things whose path the server remembers: for how long, and how much
   * of it to draw as a trail behind every item.
   */
  tracks?: { keepMinutes: number; tailMinutes: number };
  /**
   * Items are also listed in a panel (news). Some have no place and appear
   * only there; the rest are pins on the map.
   */
  listed?: boolean;
  /** Large layers (city buses, every bus stop): the browser loads them only while they are switched on. */
  lazy?: boolean;
  /** Drawn only from this zoom level up (2D), or this close (3D), so dense layers don't bury the map. */
  minZoom?: number;
}

/** Tiles for an image layer. Several frames make an animation (e.g. the last two hours of radar). */
export interface RasterInfo {
  frames: { time?: string; url: string }[];
  tileSize: number;
  maxzoom: number;
  opacity: number;
}

export type LayerGroup = 'hazards' | 'roads' | 'transport' | 'places' | 'weather' | 'air-sea' | 'news';

export const LAYER_GROUP_NAMES: Record<LayerGroup, { tr: string; en: string }> = {
  hazards: { tr: 'Doğal afetler', en: 'Natural hazards' },
  roads: { tr: 'Yollar ve trafik', en: 'Roads and traffic' },
  transport: { tr: 'Toplu taşıma', en: 'Public transport' },
  places: { tr: 'Önemli yerler', en: 'Important places' },
  weather: { tr: 'Hava durumu', en: 'Weather' },
  'air-sea': { tr: 'Hava ve deniz trafiği', en: 'Air and sea traffic' },
  news: { tr: 'Haberler ve duyurular', en: 'News and notices' },
};

/** Layer list plus a version per layer that bumps whenever its data changes. */
export interface LayerSummary extends LayerInfo {
  version: number;
  count: number;
  /** When any of its sources last delivered data (ISO). */
  updatedAt?: string;
}
