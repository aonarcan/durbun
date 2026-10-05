export type LocateError = 'insecure' | 'denied' | 'unavailable' | 'timeout';

let last: { at: number; position: [number, number] } | undefined;

/**
 * The viewer's position as [lng, lat]. Browsers only allow this on a secure
 * page (https, or localhost on the same computer).
 */
export function locate(): Promise<[number, number]> {
  if (last && Date.now() - last.at < 60_000) return Promise.resolve(last.position);
  if (!window.isSecureContext || !('geolocation' in navigator)) return Promise.reject<[number, number]>('insecure');
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const position: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        last = { at: Date.now(), position };
        resolve(position);
      },
      (err) => {
        const code: LocateError =
          err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable';
        reject(code);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}
