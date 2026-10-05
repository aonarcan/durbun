export type Lang = 'tr' | 'en';

const strings = {
  appTagline: { tr: 'Türkiye için canlı harita', en: 'Live map for Türkiye' },
  viewMap: { tr: 'Harita', en: 'Map' },
  viewSatellite: { tr: 'Uydu', en: 'Satellite' },
  viewDark: { tr: 'Gece', en: 'Night' },
  view3d: { tr: '3B', en: '3D' },
  layers: { tr: 'Katmanlar', en: 'Layers' },
  sources: { tr: 'Kaynak durumu', en: 'Source status' },
  backToMap: { tr: 'Haritaya dön', en: 'Back to map' },
  live: { tr: 'Canlı', en: 'Live' },
  offline: { tr: 'Bağlantı yok', en: 'Offline' },
  items: { tr: 'kayıt', en: 'items' },
  updated: { tr: 'güncellendi', en: 'updated' },
  noDataYet: { tr: 'henüz veri yok', en: 'no data yet' },
  source: { tr: 'Kaynak', en: 'Source' },
  close: { tr: 'Kapat', en: 'Close' },
  observedAt: { tr: 'Zaman', en: 'Time' },
  validUntil: { tr: 'Bitiş', en: 'Until' },
  coordinates: { tr: 'Konum', en: 'Location' },
  openSource: { tr: 'Kaynağı aç', en: 'Open source' },
  zoomHere: { tr: 'Yakınlaştır', en: 'Zoom in' },
  // source status page
  sourcesTitle: { tr: 'Kaynak durumu', en: 'Source status' },
  sourcesIntro: {
    tr: 'Her veri kaynağının son durumu. Sayfa kendiliğinden güncellenir.',
    en: 'The latest state of every data source. This page updates by itself.',
  },
  colSource: { tr: 'Kaynak', en: 'Source' },
  colLayer: { tr: 'Katman', en: 'Layer' },
  colStatus: { tr: 'Durum', en: 'Status' },
  colLastSuccess: { tr: 'Son başarılı', en: 'Last success' },
  colItems: { tr: 'Kayıt', en: 'Items' },
  colNewest: { tr: 'En yeni veri', en: 'Newest data' },
  colDuration: { tr: 'Süre', en: 'Took' },
  colInterval: { tr: 'Aralık', en: 'Every' },
  colError: { tr: 'Son hata', en: 'Last error' },
  turkishIp: { tr: 'Türk IP gerekir', en: 'Needs a Turkish IP' },
  never: { tr: 'hiç', en: 'never' },
  // 3D
  globeNoToken: {
    tr: '3B arazi ve binalar için ücretsiz Cesium ion anahtarı ekleyin (.env içinde CESIUM_ION_TOKEN).',
    en: 'Add a free Cesium ion token (CESIUM_ION_TOKEN in .env) for 3D terrain and buildings.',
  },
} as const;

export type StringKey = keyof typeof strings;

export function t(lang: Lang, key: StringKey): string {
  return strings[key][lang];
}

export const STATUS_LABELS: Record<string, { tr: string; en: string }> = {
  pending: { tr: 'Bekliyor', en: 'Pending' },
  ok: { tr: 'Çalışıyor', en: 'Working' },
  degraded: { tr: 'Aksıyor', en: 'Degraded' },
  failing: { tr: 'Çalışmıyor', en: 'Failing' },
  disabled: { tr: 'Kapalı', en: 'Disabled' },
};

export const KIND_LABELS: Record<string, { tr: string; en: string }> = {
  earthquake: { tr: 'Deprem', en: 'Earthquake' },
  accident: { tr: 'Kaza', en: 'Accident' },
  breakdown: { tr: 'Araç arızası', en: 'Breakdown' },
  roadworks: { tr: 'Yol çalışması', en: 'Roadworks' },
  closure: { tr: 'Yol kapalı', en: 'Road closed' },
  weather: { tr: 'Hava koşulu', en: 'Weather' },
  congestion: { tr: 'Yoğun trafik', en: 'Heavy traffic' },
  ferry: { tr: 'Vapur seferi', en: 'Ferry notice' },
  fire: { tr: 'Araç yangını', en: 'Vehicle fire' },
  event: { tr: 'Etkinlik', en: 'Event' },
  info: { tr: 'Duyuru', en: 'Notice' },
  pharmacy: { tr: 'Nöbetçi eczane', en: 'On-duty pharmacy' },
};

/** Labels for the per-feature "details" keys collectors produce. */
export const DETAIL_LABELS: Record<string, { tr: string; en: string }> = {
  magnitude: { tr: 'Büyüklük', en: 'Magnitude' },
  depthKm: { tr: 'Derinlik (km)', en: 'Depth (km)' },
  location: { tr: 'Yer', en: 'Place' },
  neighbourhood: { tr: 'Mahalle', en: 'Neighbourhood' },
  eventId: { tr: 'AFAD olay no', en: 'AFAD event id' },
  ibbType: { tr: 'İBB duyuru türü', en: 'İBB notice type' },
  priority: { tr: 'Öncelik', en: 'Priority' },
  cameraId: { tr: 'En yakın kamera', en: 'Nearest camera' },
  district: { tr: 'İlçe', en: 'District' },
  address: { tr: 'Adres', en: 'Address' },
  phone: { tr: 'Telefon', en: 'Phone' },
};
