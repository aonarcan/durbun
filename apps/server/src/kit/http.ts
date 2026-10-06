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
  getBuffer(url: string, opts?: RequestOptions): Promise<Buffer>;
  getJson<T = unknown>(url: string, opts?: RequestOptions): Promise<T>;
  /** POSTs a JSON body and reads a JSON answer. */
  postJson<T = unknown>(url: string, body: unknown, opts?: RequestOptions): Promise<T>;
  /** POSTs a text body (e.g. a SOAP envelope; set its Content-Type in the headers) and reads the answer as text. */
  postText(url: string, body: string, opts?: RequestOptions): Promise<string>;
  /** The raw response, for downloads too large to hold in memory at once. */
  getResponse(url: string, opts?: RequestOptions): Promise<Response>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createHttpClient(userAgent: string, fetchImpl: FetchLike = fetch): HttpClient {
  /** Dropped connections (resets, failed fetches) are common on some public servers: a GET is tried once more. */
  async function request(url: string, opts: RequestOptions, body?: string): Promise<Response> {
    try {
      return await attempt(url, opts, body);
    } catch (err) {
      const dropped = err instanceof HttpError && err.status === undefined && /ECONNRESET|fetch failed|socket|other side closed/i.test(err.message);
      if (!dropped || body !== undefined || opts.signal?.aborted) throw err;
      await new Promise((r) => setTimeout(r, 1500));
      return attempt(url, opts, body);
    }
  }

  async function attempt(url: string, opts: RequestOptions, body?: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json, text/plain, */*',
          ...(body !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
          ...opts.headers,
        },
        ...(body !== undefined ? { method: 'POST', body } : {}),
        signal: opts.signal ?? null,
        redirect: 'follow',
      });
    } catch (err) {
      throw new HttpError(describeNetworkError(err));
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new HttpError(`HTTP ${res.status}${body ? `: ${snippet(body)}` : ''}`, res.status);
    }
    return res;
  }

  async function getText(url: string, opts: RequestOptions = {}): Promise<string> {
    return (await request(url, opts)).text();
  }

  async function getBuffer(url: string, opts: RequestOptions = {}): Promise<Buffer> {
    return Buffer.from(await (await request(url, opts)).arrayBuffer());
  }

  function parseJson<T>(body: string): T {
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new HttpError(`Expected JSON, got: ${snippet(body)}`);
    }
  }

  async function getJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
    return parseJson<T>(await getText(url, opts));
  }

  async function postJson<T>(url: string, payload: unknown, opts: RequestOptions = {}): Promise<T> {
    return parseJson<T>(await (await request(url, opts, JSON.stringify(payload))).text());
  }

  async function postText(url: string, payload: string, opts: RequestOptions = {}): Promise<string> {
    return (await request(url, opts, payload)).text();
  }

  return { getText, getJson, getBuffer, postJson, postText, getResponse: (url, opts = {}) => request(url, opts) };
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
