import { computeStatus, point, type Feature, type ServerEvent } from '@durbun/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { createHttpClient, HttpError } from '../src/kit/http.ts';
import { nextDelaySec, Scheduler } from '../src/kit/scheduler.ts';
import type { LayerDefinition, SourceDefinition } from '../src/kit/source.ts';
import { Store } from '../src/kit/store.ts';
import { istanbulTimeToIso, turkishTitleCase } from '../src/kit/text.ts';

const layer: LayerDefinition = {
  id: 'test-layer',
  name: { tr: 'Deneme', en: 'Test' },
  group: 'hazards',
  color: '#000',
  defaultOn: true,
  attribution: 'test',
};

function feature(id: string): Feature {
  return {
    type: 'Feature',
    geometry: point(29, 41),
    properties: { id, layer: 'test-layer', source: 'test-source', title: id, observedAt: '2026-10-05T10:00:00.000Z' },
  };
}

function source(fetchImpl: SourceDefinition['fetch']): SourceDefinition {
  return {
    id: 'test-source',
    name: { tr: 'Deneme kaynağı', en: 'Test source' },
    layer: 'test-layer',
    homepage: 'https://example.org',
    intervalSec: 60,
    fetch: fetchImpl,
  };
}

const quietHttp = createHttpClient('test');

describe('status rules', () => {
  const base = { intervalSec: 60, attempted: true };
  it('is pending before the first attempt', () => {
    expect(computeStatus({ ...base, attempted: false, consecutiveFailures: 0 }, 0)).toBe('pending');
  });
  it('is ok after a success', () => {
    expect(computeStatus({ ...base, consecutiveFailures: 0, lastSuccessAt: 0 }, 1000)).toBe('ok');
  });
  it('is degraded while recent data is still on the map', () => {
    expect(computeStatus({ ...base, consecutiveFailures: 2, lastSuccessAt: 0 }, 120_000)).toBe('degraded');
  });
  it('is failing once data is older than three intervals', () => {
    expect(computeStatus({ ...base, consecutiveFailures: 5, lastSuccessAt: 0 }, 181_000)).toBe('failing');
    expect(computeStatus({ ...base, consecutiveFailures: 1 }, 0)).toBe('failing');
  });
  it('is disabled when switched off', () => {
    expect(computeStatus({ ...base, consecutiveFailures: 0, disabled: true }, 0)).toBe('disabled');
  });
});

describe('backoff', () => {
  const mid = () => 0.5;
  it('waits one interval after a success', () => {
    expect(nextDelaySec(60, 0, mid)).toBe(60);
  });
  it('doubles after each failure', () => {
    expect(nextDelaySec(60, 1, mid)).toBe(60);
    expect(nextDelaySec(60, 2, mid)).toBe(120);
    expect(nextDelaySec(60, 3, mid)).toBe(240);
  });
  it('caps at 30 minutes', () => {
    expect(nextDelaySec(60, 20, mid)).toBe(1800);
    expect(nextDelaySec(3600, 5, mid)).toBe(1800);
  });
  it('retries a daily source within minutes, not the next day', () => {
    expect(nextDelaySec(86_400, 1, mid)).toBe(120);
    expect(nextDelaySec(86_400, 3, mid)).toBe(480);
    expect(nextDelaySec(86_400, 9, mid)).toBe(1800);
  });
});

describe('scheduler and store', () => {
  it('records a success, bumps the layer version once per change, and emits events', async () => {
    const s = source(async () => [feature('a'), feature('b')]);
    const store = new Store([layer], [s], new Set());
    const events: ServerEvent[] = [];
    store.on('event', (e) => events.push(e));
    const scheduler = new Scheduler([s], store, quietHttp, { log: () => {} });

    expect(await scheduler.runOnce(s)).toBe(true);
    expect(await scheduler.runOnce(s)).toBe(true);

    const [summary] = store.layerSummaries();
    expect(summary?.count).toBe(2);
    expect(summary?.version).toBe(1); // same data twice: one version
    expect(summary?.sources).toEqual(['test-source']);
    const health = store.sourceHealth('test-source');
    expect(health.status).toBe('ok');
    expect(health.itemCount).toBe(2);
    expect(health.newestItemAt).toBe('2026-10-05T10:00:00.000Z');
    expect(events.filter((e) => e.type === 'layer')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'health')).toHaveLength(2);
  });

  it('keeps the last good data when a fetch fails', async () => {
    let fail = false;
    const s = source(async () => {
      if (fail) throw new HttpError('HTTP 502', 502);
      return [feature('a')];
    });
    const store = new Store([layer], [s], new Set());
    const scheduler = new Scheduler([s], store, quietHttp, { log: () => {} });
    await scheduler.runOnce(s);
    fail = true;
    expect(await scheduler.runOnce(s)).toBe(false);
    const health = store.sourceHealth('test-source');
    expect(health.status).toBe('degraded');
    expect(health.lastError).toBe('HTTP 502');
    expect(health.consecutiveFailures).toBe(1);
    expect(store.getCollection('test-layer')?.features).toHaveLength(1);
  });

  it('reports a timeout', async () => {
    const s = { ...source((ctx) => new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted'))))), timeoutSec: 0.05 };
    const store = new Store([layer], [s], new Set());
    const scheduler = new Scheduler([s], store, quietHttp, { log: () => {} });
    await scheduler.runOnce(s);
    expect(store.sourceHealth('test-source').lastError).toBe('Timed out');
  });

  it('rejects a source that points at a missing layer', () => {
    expect(() => new Store([], [source(async () => [])], new Set())).toThrow(/unknown layer/);
  });
});

describe('http client', () => {
  it('sends the user agent and extra headers, and explains bad JSON', async () => {
    let seen: Headers | undefined;
    const http = createHttpClient('Durbun-test', async (_url, init) => {
      seen = new Headers(init?.headers);
      return new Response('<html>maintenance</html>', { status: 200 });
    });
    await expect(http.getJson('https://example.org', { headers: { Referer: 'https://x' } })).rejects.toThrow(/Expected JSON, got: <html>maintenance/);
    expect(seen?.get('user-agent')).toBe('Durbun-test');
    expect(seen?.get('referer')).toBe('https://x');
  });

  it('turns HTTP errors into readable messages', async () => {
    const http = createHttpClient('t', async () => new Response('Bad Gateway', { status: 502 }));
    await expect(http.getText('https://example.org')).rejects.toMatchObject({ message: 'HTTP 502: Bad Gateway', status: 502 });
  });
});

describe('text helpers', () => {
  it('converts İstanbul local time to UTC', () => {
    expect(istanbulTimeToIso('2026-10-05T21:05:00')).toBe('2026-10-05T18:05:00.000Z');
    expect(istanbulTimeToIso('')).toBeUndefined();
    expect(istanbulTimeToIso('not a date')).toBeUndefined();
  });
  it('title-cases Turkish text', () => {
    expect(turkishTitleCase('YENİ ÇAMLICA ECZANESİ')).toBe('Yeni Çamlıca Eczanesi');
    expect(turkishTitleCase('IŞIK ECZANESİ')).toBe('Işık Eczanesi');
  });
});

describe('API', () => {
  it('serves layers, layer data, sources and config', async () => {
    const s = source(async () => [feature('a')]);
    const store = new Store([layer], [s], new Set());
    await new Scheduler([s], store, quietHttp, { log: () => {} }).runOnce(s);
    const app = await buildApp({ store, cesiumIonToken: 'tok' });

    const layers = await app.inject('/api/layers');
    expect(layers.statusCode).toBe(200);
    expect(layers.headers['cache-control']).toBe('no-store');
    expect(layers.json()[0].count).toBe(1);

    const data = await app.inject('/api/layers/test-layer');
    expect(data.json().features).toHaveLength(1);

    expect((await app.inject('/api/layers/nope')).statusCode).toBe(404);
    expect((await app.inject('/api/sources')).json()[0].status).toBe('ok');
    expect((await app.inject('/api/config')).json()).toEqual({ cesiumIonToken: 'tok' });
    await app.close();
  });
});
