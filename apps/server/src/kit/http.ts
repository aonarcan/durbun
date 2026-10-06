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
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createHttpClient(userAgent: string, fetchImpl: FetchLike = fetch): HttpClient {
  async function request(url: string, opts: RequestOptions, body?: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json, text/plain, */*',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
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

  return { getText, getJson, getBuffer, postJson };
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
