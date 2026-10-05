/**
 * A small, polite HTTP client for collectors: identifies itself, times out,
 * and turns bad responses into readable errors for the source status page.
 */

export class HttpError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface HttpClient {
  getText(url: string, opts?: RequestOptions): Promise<string>;
  getJson<T = unknown>(url: string, opts?: RequestOptions): Promise<T>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createHttpClient(userAgent: string, fetchImpl: FetchLike = fetch): HttpClient {
  async function getText(url: string, opts: RequestOptions = {}): Promise<string> {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json, text/plain, */*', ...opts.headers },
        signal: opts.signal ?? null,
        redirect: 'follow',
      });
    } catch (err) {
      throw new HttpError(describeNetworkError(err));
    }
    const body = await res.text();
    if (!res.ok) {
      throw new HttpError(`HTTP ${res.status}${body ? `: ${snippet(body)}` : ''}`, res.status);
    }
    return body;
  }

  async function getJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
    const body = await getText(url, opts);
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new HttpError(`Expected JSON, got: ${snippet(body)}`);
    }
  }

  return { getText, getJson };
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat;
}

function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'Timed out';
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    if (cause?.code) return `Network error: ${cause.code}`;
    return `Network error: ${err.message}`;
  }
  return 'Network error';
}
