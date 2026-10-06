import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { Store } from '../src/kit/store.ts';
import { readVersion } from '../src/version.ts';

const SHA = '1143210b0c90ce92e772c4170829a220f2a1598b';

function repo(head: string, refs: Record<string, string> = {}, packed?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'durbun-version-'));
  mkdirSync(join(root, '.git/refs/heads'), { recursive: true });
  writeFileSync(join(root, '.git/HEAD'), `${head}\n`);
  for (const [name, sha] of Object.entries(refs)) writeFileSync(join(root, '.git/refs/heads', name), `${sha}\n`);
  if (packed) writeFileSync(join(root, '.git/packed-refs'), packed);
  return root;
}

describe('version', () => {
  it('reads the branch and commit from .git', () => {
    expect(readVersion(repo('ref: refs/heads/main', { main: SHA }))).toEqual({ branch: 'main', commit: '1143210' });
  });

  it('finds packed refs (Windows line endings too)', () => {
    const packed = `# pack-refs with: peeled fully-peeled sorted\r\n${SHA} refs/heads/stage-2b\r\n`;
    expect(readVersion(repo('ref: refs/heads/stage-2b', {}, packed))).toEqual({ branch: 'stage-2b', commit: '1143210' });
  });

  it('copes with a detached head or no git folder', () => {
    expect(readVersion(repo(SHA))).toEqual({ commit: '1143210' });
    expect(readVersion(mkdtempSync(join(tmpdir(), 'durbun-nogit-')))).toEqual({});
  });

  it('answers /api/version', async () => {
    const app = await buildApp({ store: new Store([], [], new Set()), cesiumIonToken: '', version: { branch: 'main', commit: '1143210' } });
    const res = await app.inject('/api/version');
    expect(res.json()).toEqual({ branch: 'main', commit: '1143210' });
    await app.close();
  });
});
