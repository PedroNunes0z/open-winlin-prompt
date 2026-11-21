import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // o login do Google (backup no Drive) exige exatamente esta origem
  server: { port: 43210, strictPort: true },
  preview: { port: 43210, strictPort: true },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
