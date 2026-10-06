import type { LayerDefinition, SourceDefinition } from '../kit/source.ts';
import { afadEarthquakes } from './afad-earthquakes.ts';
import { adsbFi, adsbLol, mergeAircraft, openSky } from './aircraft.ts';
import { firmsSources } from './firms.ts';
import { kegmStraits } from './kegm-straits.ts';
import { newsSources } from './news.ts';
import { aisStream } from './ships.ts';
import { ibbIncidents } from './ibb-incidents.ts';
import { ibbPharmacies } from './ibb-pharmacies.ts';
import { mgmObservations } from './mgm-observations.ts';
import { mgmWarnings } from './mgm-warnings.ts';
import { rainViewerRadar } from './rainviewer.ts';

/** Every layer the map can show. Later stages add to this list. */
export const layers: LayerDefinition[] = [
  {
    id: 'earthquakes',
    name: { tr: 'Depremler', en: 'Earthquakes' },
    group: 'hazards',
    color: '#d7301f',
    defaultOn: true,
    attribution: 'AFAD',
    timeWindows: { options: [1, 6, 24, 72, 168], default: 24 },
    minValue: { label: 'M', options: [0, 2, 3, 4, 5], default: 2 },
  },
  {
    id: 'fires',
    name: { tr: 'Yangınlar (uydu ısı tespitleri)', en: 'Fires (satellite heat detections)' },
    group: 'hazards',
    color: '#ff6a00',
    defaultOn: true,
    attribution: 'NASA FIRMS',
    timeWindows: { options: [6, 12, 24], default: 24 },
  },
  {
    id: 'weather-warnings',
    name: { tr: 'Meteorolojik uyarılar', en: 'Weather warnings' },
    group: 'weather',
    color: '#f5a623',
    defaultOn: true,
    attribution: 'MGM',
    shape: 'areas',
  },
  {
    id: 'weather-now',
    name: { tr: 'Anlık hava (il merkezleri)', en: 'Current weather (province centres)' },
    group: 'weather',
    color: '#2b7bb9',
    defaultOn: false,
    attribution: 'MGM',
  },
  {
    id: 'radar',
    name: { tr: 'Yağış radarı', en: 'Rain radar' },
    group: 'weather',
    color: '#2ca25f',
    defaultOn: false,
    attribution: 'RainViewer',
  },
  {
    id: 'clouds',
    name: { tr: 'Bulutlar (uydu)', en: 'Clouds (satellite)' },
    group: 'weather',
    color: '#9aa3b5',
    defaultOn: false,
    attribution: 'EUMETSAT (Meteosat)',
    raster: { frames: [{ url: '/api/tiles/clouds/{z}/{x}/{y}' }], tileSize: 256, maxzoom: 6, opacity: 0.9 },
  },
  {
    id: 'incidents',
    name: { tr: 'Trafik duyuruları (İstanbul)', en: 'Traffic notices (İstanbul)' },
    group: 'roads',
    color: '#f28e2b',
    defaultOn: true,
    attribution: 'İBB Ulaşım Yönetim Merkezi',
  },
  {
    id: 'pharmacies',
    name: { tr: 'Nöbetçi eczaneler (İstanbul)', en: 'On-duty pharmacies (İstanbul)' },
    group: 'places',
    color: '#e0115f',
    glyph: 'E',
    defaultOn: false,
    attribution: 'İBB',
  },
  {
    id: 'aircraft',
    name: { tr: 'Uçaklar', en: 'Aircraft' },
    group: 'air-sea',
    color: '#1f78b4',
    defaultOn: false,
    attribution: 'adsb.fi, adsb.lol, OpenSky',
    merge: mergeAircraft,
  },
  {
    id: 'ships',
    name: { tr: 'Gemiler', en: 'Ships' },
    group: 'air-sea',
    color: '#0f766e',
    defaultOn: false,
    attribution: 'AISStream',
  },
  {
    id: 'straits',
    name: { tr: 'Boğazlar: gemi trafiği', en: 'Straits: ship traffic' },
    group: 'air-sea',
    color: '#0b7285',
    defaultOn: true,
    attribution: 'Kıyı Emniyeti Genel Müdürlüğü',
  },
  {
    id: 'news',
    name: { tr: 'Haberler (ili belli olanlar)', en: 'News (with a province)' },
    group: 'news',
    color: '#5b6474',
    defaultOn: false,
    attribution: '15 Türk haber kaynağı',
    listed: true,
  },
];

/** Every source the collectors poll. */
export const sources: SourceDefinition[] = [
  afadEarthquakes,
  ibbIncidents,
  ibbPharmacies,
  mgmWarnings,
  mgmObservations,
  rainViewerRadar,
  ...firmsSources,
  adsbFi,
  adsbLol,
  openSky,
  aisStream,
  kegmStraits,
  ...newsSources,
];
