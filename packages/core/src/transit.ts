import type { Feature } from './geo.ts';

/** Public transport answers the server gives when a bus, a stop or a line is selected. */

/** "G" (gidiş, outbound) or "D" (dönüş, return), as İETT names directions. */
export type TransitDirection = 'G' | 'D';

export interface TransitStop {
  code: string;
  name: string;
  lng: number;
  lat: number;
  direction?: TransitDirection;
  /** Position along the line in its direction, from 1. */
  order?: number;
}

export interface TransitVehicle {
  /** The bus's feature id on the map ("bus:C-472"). */
  id: string;
  /** Door number painted on the bus, e.g. "C-472". */
  doorNo: string;
  lng: number;
  lat: number;
  direction?: TransitDirection;
  /** Where it is heading, as the line names it. */
  towards?: string;
  nearestStopCode?: string;
  /** Time of its position (ISO). */
  at?: string;
}

export interface TransitRoute {
  direction: TransitDirection;
  /** The stop it runs to. */
  towards?: string;
  coordinates: [number, number][];
  /** Drawn from stop to stop because the street-level route isn't available yet. */
  approximate: boolean;
}

export interface TransitLine {
  code: string;
  name: string;
  routes: TransitRoute[];
  stops: TransitStop[];
  vehicles: TransitVehicle[];
  /** Operator notices for the line (diversions, cancelled trips). */
  notices: string[];
  fare?: string;
  lengthKm?: number;
  tripMinutes?: number;
}

/** A bus and the line it is running on now, if that could be found. */
export interface BusAnswer {
  doorNo: string;
  line?: TransitLine;
  direction?: TransitDirection;
  towards?: string;
  nearestStop?: TransitStop;
  /** Lines this bus ran yesterday, when today's could not be confirmed. */
  recentLines: string[];
  /** The bus as the map has it, for when its layer isn't loaded in the browser. */
  feature?: Feature;
}

export interface StopArrival {
  line: string;
  doorNo: string;
  vehicleId: string;
  /** Stops still to go before this one (0: the bus is at or arriving at this stop). */
  stopsAway: number;
}

/** A bus stop: the lines that call there and the buses on their way. */
export interface StopAnswer {
  code: string;
  lines: { code: string; name?: string }[];
  arrivals: StopArrival[];
  /** The line list is still being prepared (first run). */
  linesPending?: boolean;
  /** The stop as the map has it, for when its layer isn't loaded in the browser. */
  feature?: Feature;
}
