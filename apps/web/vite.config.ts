import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, normalizePath } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// CesiumJS loads its workers, widgets and assets at runtime from /cesium/.
const webRoot = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const cesiumBuild = join(dirname(require.resolve('cesium/package.json')), 'Build', 'Cesium');
// The copy plugin keeps each file's path relative to this folder (minus any "../"),
// so strip those leading folders to land files at /cesium/Workers, /cesium/Assets, …
const leadingDirs = normalizePath(relative(webRoot, cesiumBuild))
  .split('/')
  .filter((part) => part && part !== '..').length;

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map((dir) => ({
        src: normalizePath(join(cesiumBuild, dir)),
        dest: 'cesium',
        rename: { stripBase: leadingDirs },
      })),
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
  worker: {
    format: 'es',
  },
  build: {
    chunkSizeWarningLimit: 6000,
  },
});
