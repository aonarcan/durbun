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
