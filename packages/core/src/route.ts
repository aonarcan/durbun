import type { LineStringGeometry } from './geo.ts';

export type TravelMode = 'car' | 'foot';

/** A route from the server's /api/route. Durations ignore live traffic. */
export interface RouteResult {
  mode: TravelMode;
  /** Metres. */
  distance: number;
  /** Seconds. */
  duration: number;
  geometry: LineStringGeometry;
  /** Who computed it, for the credit line. */
  provider: string;
}
