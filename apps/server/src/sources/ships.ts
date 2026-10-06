import { isValidLngLat, point, type Feature } from '@durbun/core';
import type { SourceDefinition } from '../kit/source.ts';

/**
 * Live ships from AISStream (free key). Unlike the other sources this is a
 * stream: a WebSocket stays open and every message updates a table of ships;
 * the scheduler asks for a snapshot of that table once a minute.
 */

/** Turkish waters: the Aegean, Marmara and the Straits, the southern Black Sea and the eastern Mediterranean. */
export const SEA_AREA = { south: 34, north: 43.5, west: 25, east: 42 } as const;

/** Ships not heard from for this long leave the map; moored ships report every few minutes. */
const SHOW_FOR_MS = 30 * 60_000;
const FORGET_AFTER_MS = 6 * 3600_000;

export interface AisMessage {
  MessageType: string;
  MetaData?: Record<string, unknown>;
  Message?: Record<string, Record<string, unknown>>;
  error?: string;
}

interface Ship {
  mmsi: number;
  name?: string;
  lng?: number;
  lat?: number;
  sog?: number;
  cog?: number;
  heading?: number;
  navStatus?: number;
  type?: number;
  imo?: number;
  callSign?: string;
  destination?: string;
  length?: number;
  width?: number;
  draught?: number;
  classB?: boolean;
  positionAt?: number;
  heardAt: number;
}

/** AIS navigational status codes. */
export const NAV_STATUS: Record<number, string> = {
  0: 'Seyirde (makine)',
  1: 'Demirde',
  2: 'Kumanda edilemiyor',
  3: 'Manevra kısıtlı',
  4: 'Su çekimi nedeniyle kısıtlı',
  5: 'Bağlı (rıhtımda)',
  6: 'Karaya oturmuş',
  7: 'Balık avında',
  8: 'Seyirde (yelken)',
  14: 'AIS-SART (acil)',
};

/** AIS ship type code → a few map categories. */
export function shipCategory(type: number | undefined): string {
  if (type === undefined || type === 0) return 'unknown';
  if (type >= 70 && type <= 79) return 'cargo';
  if (type >= 80 && type <= 89) return 'tanker';
  if (type >= 60 && type <= 69) return 'passenger';
  if (type >= 40 && type <= 49) return 'highspeed';
  if (type === 30) return 'fishing';
  if (type === 36 || type === 37) return 'pleasure';
  if ([31, 32, 33, 34, 50, 51, 52, 53, 54, 56, 57, 58, 59].includes(type)) return 'service';
  return 'other';
}

export const SHIP_CATEGORY_NAMES: Record<string, string> = {
  cargo: 'Yük gemisi',
  tanker: 'Tanker',
  passenger: 'Yolcu gemisi / feribot',
  highspeed: 'Hızlı tekne',
  fishing: 'Balıkçı teknesi',
  pleasure: 'Yat / gezi teknesi',
  service: 'Römorkör, pilot, hizmet',
  other: 'Diğer',
  unknown: 'Türü bilinmiyor',
};

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/@+/g, ' ').trim(); // AIS pads text with @
  return t || undefined;
};

/** "2026-10-06 07:12:30.123456 +0000 UTC" → ms; undefined if unreadable. */
export function aisTime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(value);
  if (!m) return undefined;
  const t = Date.parse(`${m[1]}T${m[2]}${(m[3] ?? '').slice(0, 4)}Z`);
  return Number.isFinite(t) ? t : undefined;
}

/** Keeps the latest known state of every ship in the area. */
export class ShipTable {
  readonly ships = new Map<number, Ship>();

  /** Applies one AISStream message. Returns false for messages it ignores. */
  apply(msg: AisMessage, now: number): boolean {
    const meta = msg.MetaData ?? {};
    const body = msg.Message?.[msg.MessageType];
    const mmsi = num(meta.MMSI) ?? num(body?.UserID);
    if (!body || !mmsi) return false;
    const heard = aisTime(meta.time_utc) ?? now;
    const ship = this.ships.get(mmsi) ?? { mmsi, heardAt: heard };
    ship.heardAt = Math.max(ship.heardAt, heard);
    const metaName = text(meta.ShipName);
    if (metaName) ship.name = metaName;

    if (msg.MessageType === 'PositionReport' || msg.MessageType === 'StandardClassBPositionReport') {
      const lat = num(body.Latitude) ?? num(meta.latitude) ?? num(meta.Latitude);
      const lng = num(body.Longitude) ?? num(meta.longitude) ?? num(meta.Longitude);
      if (lat === undefined || lng === undefined || !isValidLngLat(lng, lat)) return false;
      ship.lat = lat;
      ship.lng = lng;
      ship.positionAt = heard;
      const sog = num(body.Sog);
      ship.sog = sog !== undefined && sog < 102.3 ? sog : undefined; // 102.3 = not available
      const cog = num(body.Cog);
      ship.cog = cog !== undefined && cog < 360 ? cog : undefined;
      const hdg = num(body.TrueHeading);
      ship.heading = hdg !== undefined && hdg < 360 ? hdg : undefined;
      if (msg.MessageType === 'PositionReport') ship.navStatus = num(body.NavigationalStatus);
      else ship.classB = true;
    } else if (msg.MessageType === 'ShipStaticData') {
      const name = text(body.Name);
      if (name) ship.name = name;
      ship.type = num(body.Type) ?? ship.type;
      const imo = num(body.ImoNumber);
      if (imo) ship.imo = imo;
      ship.callSign = text(body.CallSign) ?? ship.callSign;
      ship.destination = text(body.Destination) ?? ship.destination;
      const dim = body.Dimension as Record<string, unknown> | undefined;
      if (dim) {
        const length = (num(dim.A) ?? 0) + (num(dim.B) ?? 0);
        const width = (num(dim.C) ?? 0) + (num(dim.D) ?? 0);
        if (length > 0) ship.length = length;
        if (width > 0) ship.width = width;
      }
      const draught = num(body.MaximumStaticDraught);
      if (draught) ship.draught = draught;
    } else if (msg.MessageType === 'StaticDataReport') {
      // Class B static data comes in two parts: A carries the name, B the type and size.
      const a = body.ReportA as Record<string, unknown> | undefined;
      const b = body.ReportB as Record<string, unknown> | undefined;
      if (a?.Valid && text(a.Name)) ship.name = text(a.Name);
      if (b?.Valid) {
        ship.type = num(b.ShipType) ?? ship.type;
        ship.callSign = text(b.CallSign) ?? ship.callSign;
        const dim = b.Dimension as Record<string, unknown> | undefined;
        const length = (num(dim?.A) ?? 0) + (num(dim?.B) ?? 0);
        const width = (num(dim?.C) ?? 0) + (num(dim?.D) ?? 0);
        if (length > 0) ship.length = length;
        if (width > 0) ship.width = width;
      }
    } else {
      return false;
    }
    this.ships.set(mmsi, ship);
    return true;
  }

  /** Ships with a recent position, as map features; forgets ships silent for hours. */
  features(now: number): Feature[] {
    const out: Feature[] = [];
    for (const [mmsi, s] of this.ships) {
      if (now - s.heardAt > FORGET_AFTER_MS) {
        this.ships.delete(mmsi);
        continue;
      }
      if (s.lng === undefined || s.lat === undefined || s.positionAt === undefined || now - s.positionAt > SHOW_FOR_MS) continue;
      out.push(shipFeature(s));
    }
    return out;
  }
}

const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

function shipFeature(s: Ship): Feature {
  const id = `ship:${s.mmsi}`;
  const category = shipCategory(s.type);
  const moving = (s.sog ?? 0) >= 0.5 && s.navStatus !== 1 && s.navStatus !== 5;
  // Draw the bow the way it points: heading when the ship reports it; when it
  // doesn't, the course over ground, which only means something while moving.
  const course = s.heading ?? (moving ? s.cog : undefined);
  return {
    type: 'Feature',
    id,
    geometry: point(Number(s.lng!.toFixed(5)), Number(s.lat!.toFixed(5))),
    properties: {
      id,
      layer: 'ships',
      source: 'aisstream',
      title: s.name ?? `MMSI ${s.mmsi}`,
      kind: category,
      ...(s.sog !== undefined ? { value: Math.round(s.sog * 10) / 10 } : {}),
      observedAt: new Date(s.positionAt!).toISOString(),
      style: { moving: moving ? 1 : 0, ...(course !== undefined ? { course: Math.round(course) } : {}) },
      details: {
        shipType: SHIP_CATEGORY_NAMES[category] ?? null,
        navStatus: s.navStatus !== undefined ? (NAV_STATUS[s.navStatus] ?? null) : null,
        speed: s.sog !== undefined ? `${nf1.format(s.sog)} kn` : null,
        course: s.cog !== undefined ? `${Math.round(s.cog)}°` : null,
        destination: s.destination ?? null,
        size: s.length ? `${s.length} × ${s.width ?? '?'} m` : null,
        draught: s.draught ? `${nf1.format(s.draught)} m` : null,
        mmsi: String(s.mmsi),
        imo: s.imo ? String(s.imo) : null,
        callSign: s.callSign ?? null,
        aisClass: s.classB ? 'B' : 'A',
      },
    },
  };
}

/** The open connection and the table it fills. One per server. */
class AisStream {
  readonly table = new ShipTable();
  private socket: WebSocket | undefined;
  private retryMs = 5_000;
  private lastMessageAt = 0;
  private lastError: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private firstSnapshot = true;

  constructor(private readonly apiKey: string) {}

  ensureOpen(): void {
    if (this.socket || this.timer) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Could not open the AISStream connection';
      this.retryLater();
      return;
    }
    this.socket = ws;
    // AISStream sends binary frames; ask for ArrayBuffers rather than Blobs.
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      const { south, north, west, east } = SEA_AREA;
      ws.send(
        JSON.stringify({
          APIKey: this.apiKey,
          BoundingBoxes: [
            [
              [south, west],
              [north, east],
            ],
          ],
          FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ShipStaticData', 'StaticDataReport'],
        }),
      );
    });
    ws.addEventListener('message', (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : Buffer.from(event.data as ArrayBuffer).toString('utf8');
        const msg = JSON.parse(raw) as AisMessage;
        if (msg.MessageType === 'SubscriptionConfirmation') return;
        if (msg.error) {
          this.lastError = `AISStream: ${msg.error}`;
          return;
        }
        if (this.table.apply(msg, Date.now())) {
          this.lastMessageAt = Date.now();
          this.retryMs = 5_000;
          this.lastError = undefined;
        }
      } catch {
        // A malformed message is skipped.
      }
    });
    ws.addEventListener('close', (event) => {
      if (this.socket === ws) this.socket = undefined;
      if (!this.lastError) this.lastError = `AISStream closed the connection (${event.code}${event.reason ? `: ${event.reason}` : ''})`;
      this.retryLater();
    });
    ws.addEventListener('error', () => {
      this.lastError ??= 'AISStream connection error';
    });
  }

  private retryLater(): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.ensureOpen();
    }, this.retryMs);
    this.timer.unref?.();
    this.retryMs = Math.min(this.retryMs * 2, 5 * 60_000);
  }

  /**
   * The current table, or an error if nothing has arrived for a while. Right
   * after start it waits up to 20 s for the first messages.
   */
  async snapshot(signal: AbortSignal): Promise<Feature[]> {
    this.ensureOpen();
    // The first time, collect for 15 s so the map doesn't start with a handful of ships.
    const waitMs = this.firstSnapshot ? 15_000 : 0;
    this.firstSnapshot = false;
    for (let waited = 0; waited < waitMs && !signal.aborted; waited += 500) {
      await new Promise((r) => setTimeout(r, 500));
    }
    const now = Date.now();
    if (now - this.lastMessageAt > 3 * 60_000) {
      throw new Error(this.lastError ?? 'No ship messages from AISStream yet');
    }
    return this.table.features(now);
  }
}

let stream: AisStream | undefined;

export const aisStream: SourceDefinition = {
  id: 'aisstream',
  name: { tr: 'AISStream gemi konumları', en: 'AISStream ship positions' },
  layer: 'ships',
  homepage: 'https://aisstream.io',
  intervalSec: 60,
  setup: {
    env: ['AISSTREAM_API_KEY'],
    hint: {
      tr: 'Ücretsiz AISStream anahtarı gerekir: AISSTREAM_API_KEY (.env)',
      en: 'Needs a free AISStream key: AISSTREAM_API_KEY in .env',
    },
  },
  async fetch({ signal }) {
    stream ??= new AisStream(process.env.AISSTREAM_API_KEY ?? '');
    return stream.snapshot(signal);
  },
};
