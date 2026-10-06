// Builds the web app. With --if-changed (used by `npm start`), builds only when
// its sources differ from the last build, so a `git pull` can't leave an old page.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'apps/web/dist');
const stamp = join(dist, '.sources-hash');

/** Everything the built page depends on. */
const INPUTS = [
  'apps/web/src',
  'apps/web/public',
  'apps/web/index.html',
  'apps/web/vite.config.ts',
  'apps/web/tsconfig.json',
  'apps/web/package.json',
  'packages/core/src',
  'package-lock.json',
];

function filesOf(path) {
  const abs = join(root, path);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return [path];
  return readdirSync(abs, { recursive: true })
    .map((f) => `${path}/${String(f).replaceAll('\\', '/')}`)
    .filter((f) => statSync(join(root, f)).isFile());
}

function sourcesHash() {
  const hash = createHash('sha1');
  for (const f of INPUTS.flatMap(filesOf).sort()) {
    // Line endings may differ between checkouts (Windows), so they don't count as a change.
    hash.update(f).update('\0').update(readFileSync(join(root, f), 'utf8').replaceAll('\r\n', '\n')).update('\0');
  }
  return hash.digest('hex');
}

const hash = sourcesHash();
if (process.argv.includes('--if-changed')) {
  const current = existsSync(join(dist, 'index.html')) && existsSync(stamp) && readFileSync(stamp, 'utf8') === hash;
  if (current) process.exit(0);
  console.log('Dürbün: the web page is new or changed, so it is being built first (about a minute)...');
}

const result = spawnSync('npm run build -w @durbun/web', { cwd: root, stdio: 'inherit', shell: true });
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync(stamp, hash);
