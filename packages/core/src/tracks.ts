/** One remembered position: [lng, lat, time (ms), altitude (m) or null]. Altitude 0 means on the ground. */
export type TrackPoint = [number, number, number, number | null];

export interface Airport {
  icao: string;
  iata?: string;
  name: string;
  city?: string;
  lng: number;
  lat: number;
}

/** Departure and destination of a flight. */
export interface FlightRoute {
  from: Airport;
  to: Airport;
}

/** What /api/tracks/:id answers: one aircraft's or ship's path. */
export interface TrackAnswer {
  id: string;
  points: TrackPoint[];
  /** Aircraft: the path begins on the ground, so it shows the whole flight so far. */
  fromGround?: boolean;
  /** Aircraft: when it left the ground, if the path shows it. */
  takeoffAt?: number;
  route?: FlightRoute;
  /** Outside sources that filled in the path. */
  sources?: string[];
}
