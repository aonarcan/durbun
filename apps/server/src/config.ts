import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../../..');

// Read .env from the repository root if there is one (Node's built-in loader).
const envFile = resolve(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: int(process.env.PORT, 8080),
  host: process.env.HOST || '127.0.0.1',
  userAgent: process.env.DURBUN_USER_AGENT || 'Durbun/0.1 (personal, non-commercial; github.com/aonarcan/durbun)',
  cesiumIonToken: process.env.CESIUM_ION_TOKEN || '',
  /** Comma-separated source ids to switch off, e.g. DISABLED_SOURCES=ibb-pharmacies */
  disabledSources: new Set(
    (process.env.DISABLED_SOURCES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),
  webDist: resolve(repoRoot, 'apps/web/dist'),
};
