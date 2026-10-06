import type {
  BusAnswer,
  StopAnswer,
  StopArrival,
  TransitDirection,
  TransitLine,
  TransitRoute,
  TransitStop,
  TransitVehicle,
} from '@durbun/core';
import type { HttpClient } from './kit/http.ts';
import { Memo } from './kit/memo.ts';
import {
  IETT_URLS,
  lineVehicles,
  linesByBus,
  parseLineStops,
  soap,
  soapJson,
  trDate,
  type ArchiveTrip,
  type IettLine,
  type IettNotice,
  type LineVehicle,
} from './sources/iett.ts';
import type { RouteShapes, StopLines } from './transit-cache.ts';

const MIN = 60_000;
/** At most this many lines are checked when looking for buses on their way to a stop. */
const MAX_ARRIVAL_LINES = 10;

/**
 * İstanbul bus lookups for the info panel, all on demand and cached:
 * - a bus → the line it is running now: yesterday's trips list the lines that
 *   bus usually serves, and the live list of each line's buses confirms which;
 * - a line → its route both ways, stops, buses and notices;
 * - a stop → the lines calling there and the buses on their way.
 */
export class IstanbulTransit {
  private readonly lineList: Memo<Map<string, IettLine>>;
  private readonly stopsOf: Memo<TransitStop[]>;
  private readonly busesOn: Memo<TransitVehicle[]>;
  private readonly rawBusesOn = new Map<string, LineVehicle[]>();
  private readonly notices: Memo<IettNotice[]>;
  private readonly archive: Memo<Map<string, string[]>>;

  constructor(
    private readonly http: HttpClient,
    private readonly shapes?: RouteShapes,
    private readonly stopLines?: StopLines,
    private readonly now: () => number = Date.now,
  ) {
    this.lineList = new Memo(24 * 60 * MIN, now);
    this.stopsOf = new Memo(6 * 60 * MIN, now);
    this.busesOn = new Memo(20_000, now, 20_000);
    this.notices = new Memo(5 * MIN, now);
    this.archive = new Memo(6 * 60 * MIN, now, 10 * MIN);
  }

  private signal(): AbortSignal {
    return AbortSignal.timeout(30_000);
  }

  private lines(): Promise<Map<string, IettLine>> {
    return this.lineList.get('all', async () => {
      const list = await soapJson<IettLine>(this.http, IETT_URLS.network, 'GetHat_json', { HatKodu: '' }, this.signal());
      return new Map(list.map((l) => [l.SHATKODU, l]));
    });
  }

  stopsOfLine(code: string): Promise<TransitStop[]> {
    return this.stopsOf.get(code, async () =>
      parseLineStops(await soap(this.http, IETT_URLS.lineStops, 'DurakDetay_GYY', { hat_kodu: code }, this.signal())),
    );
  }

  busesOfLine(code: string): Promise<TransitVehicle[]> {
    return this.busesOn.get(code, async () => {
      const raw = await soapJson<LineVehicle>(this.http, IETT_URLS.fleet, 'GetHatOtoKonum_json', { HatKodu: code }, this.signal());
      this.rawBusesOn.set(code, raw);
      return lineVehicles(raw);
    });
  }

  private lineNotices(): Promise<IettNotice[]> {
    return this.notices.get('all', () => soapJson<IettNotice>(this.http, IETT_URLS.notices, 'GetDuyurular_json', {}, this.signal()));
  }

  /** Lines each bus ran yesterday (today's list is only published tomorrow). */
  private yesterday(): Promise<Map<string, string[]>> {
    const date = trDate(new Date(this.now()), 1);
    return this.archive.get(date, async () =>
      linesByBus(
        await soapJson<ArchiveTrip>(this.http, IETT_URLS.archive, 'GetIettArsivGorev_json', { Tarih: date }, AbortSignal.timeout(90_000)),
      ),
    );
  }

  /** The route of one direction: the street-level shape when known, else stop to stop. */
  private route(code: string, direction: TransitDirection, stops: TransitStop[], variant?: string): TransitRoute | undefined {
    const own = stops.filter((s) => s.direction === direction);
    const towards = own[own.length - 1]?.name;
    const shape = (variant && this.shapes?.get(variant)) || this.shapes?.get(`${code}_${direction}_D0`);
    if (shape && shape.length > 1) return { direction, ...(towards ? { towards } : {}), coordinates: shape, approximate: false };
    if (own.length < 2) return undefined;
    return { direction, ...(towards ? { towards } : {}), coordinates: own.map((s) => [s.lng, s.lat]), approximate: true };
  }

  async line(code: string, variants: Partial<Record<TransitDirection, string>> = {}): Promise<TransitLine> {
    const [, info, stops, vehicles, notices] = await Promise.all([
      // Street-level shapes saved on disk load in a moment; give them that moment.
      this.shapes?.within(3000),
      this.lines().catch(() => new Map<string, IettLine>()),
      this.stopsOfLine(code).catch(() => [] as TransitStop[]),
      this.busesOfLine(code).catch(() => [] as TransitVehicle[]),
      this.lineNotices().catch(() => [] as IettNotice[]),
    ]);
    const l = info.get(code);
    const routes = (['G', 'D'] as const).flatMap((d) => {
      const r = this.route(code, d, stops, variants[d]);
      return r ? [r] : [];
    });
    return {
      code,
      name: l?.SHATADI?.trim() || code,
      routes,
      stops,
      vehicles,
      notices: notices.filter((n) => n.HATKODU === code && n.MESAJ).map((n) => n.MESAJ!.replace(/\s+/g, ' ').trim()),
      ...(l?.TARIFE ? { fare: l.TARIFE } : {}),
      ...(l?.HAT_UZUNLUGU ? { lengthKm: Math.round(l.HAT_UZUNLUGU * 10) / 10 } : {}),
      ...(l?.SEFER_SURESI ? { tripMinutes: Math.round(l.SEFER_SURESI) } : {}),
    };
  }

  async bus(doorNo: string): Promise<BusAnswer> {
    const recent = (await this.yesterday().catch(() => new Map<string, string[]>())).get(doorNo) ?? [];
    for (const code of recent.slice(0, 4)) {
      const buses = await this.busesOfLine(code).catch(() => [] as TransitVehicle[]);
      const me = buses.find((b) => b.doorNo === doorNo);
      if (!me) continue;
      const variant = this.rawBusesOn.get(code)?.find((v) => v.kapino === doorNo)?.guzergahkodu;
      const line = await this.line(code, me.direction && variant ? { [me.direction]: variant } : {});
      const nearest = me.nearestStopCode ? line.stops.find((s) => s.code === me.nearestStopCode) : undefined;
      return {
        doorNo,
        line,
        ...(me.direction ? { direction: me.direction } : {}),
        ...(me.towards ? { towards: me.towards } : {}),
        ...(nearest ? { nearestStop: nearest } : {}),
        recentLines: recent,
      };
    }
    return { doorNo, recentLines: recent };
  }

  async stop(code: string): Promise<StopAnswer> {
    // The saved line list loads in a moment after a restart; give it that moment.
    const known = this.stopLines ? (await this.stopLines.within(3000))?.[code] : undefined;
    const info = await this.lines().catch(() => new Map<string, IettLine>());
    const lines = (known ?? []).map((l) => ({ code: l, ...(info.get(l)?.SHATADI ? { name: info.get(l)!.SHATADI!.trim() } : {}) }));
    const arrivals: StopArrival[] = [];
    await Promise.all(
      lines.slice(0, MAX_ARRIVAL_LINES).map(async ({ code: line }) => {
        const [stops, buses] = await Promise.all([
          this.stopsOfLine(line).catch(() => [] as TransitStop[]),
          this.busesOfLine(line).catch(() => [] as TransitVehicle[]),
        ]);
        arrivals.push(...arrivalsAt(code, line, stops, buses));
      }),
    );
    arrivals.sort((a, b) => a.stopsAway - b.stopsAway || a.line.localeCompare(b.line, 'tr', { numeric: true }));
    return { code, lines, arrivals: arrivals.slice(0, 12), ...(known ? {} : { linesPending: true }) };
  }
}

/**
 * Buses heading for a stop: those on the same direction whose nearest stop
 * comes before it along the line. A bus whose nearest stop is this one is
 * counted as arriving (0 stops away) only if it hasn't passed it.
 */
export function arrivalsAt(stopCode: string, line: string, stops: TransitStop[], buses: TransitVehicle[]): StopArrival[] {
  const here = stops.filter((s) => s.code === stopCode);
  const out: StopArrival[] = [];
  for (const bus of buses) {
    if (!bus.direction || !bus.nearestStopCode) continue;
    const target = here.find((s) => s.direction === bus.direction);
    const at = stops.find((s) => s.direction === bus.direction && s.code === bus.nearestStopCode);
    if (!target?.order || !at?.order) continue;
    const away = target.order - at.order;
    if (away < 0 || away > 30) continue;
    out.push({ line, doorNo: bus.doorNo, vehicleId: bus.id, stopsAway: away });
  }
  return out;
}
