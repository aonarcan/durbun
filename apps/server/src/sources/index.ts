import type { LayerDefinition, SourceDefinition } from '../kit/source.ts';
import { afadEarthquakes } from './afad-earthquakes.ts';
import { ibbIncidents } from './ibb-incidents.ts';
import { ibbPharmacies } from './ibb-pharmacies.ts';

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
];

/** Every source the collectors poll. */
export const sources: SourceDefinition[] = [afadEarthquakes, ibbIncidents, ibbPharmacies];
