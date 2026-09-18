import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // The single entry point is public/index.html; static assets (models,
  // images) come from assets/ and are served at the site root.
  root: 'public',
  publicDir: '../assets',
  // Expose the variables documented in .env.example to the client bundle in
  // addition to Vite's default VITE_ prefix. Anything shipped to the browser is
  // public by nature, so only put keys here that are safe to embed client-side.
  envPrefix: ['VITE_', 'IMMERSAL_', 'VENUE_', 'POSITIONING_'],
  envDir: projectRoot,
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    root: projectRoot,
    include: ['src/**/*.test.js'],
    exclude: ['legacy/**', 'node_modules/**'],
  },
});
