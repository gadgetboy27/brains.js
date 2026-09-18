import { defineConfig } from 'vite';

export default defineConfig({
  // Expose the variables documented in .env.example to the client bundle in
  // addition to Vite's default VITE_ prefix. Anything shipped to the browser is
  // public by nature, so only put keys here that are safe to embed client-side.
  envPrefix: ['VITE_', 'IMMERSAL_', 'VENUE_'],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.js'],
    exclude: ['legacy/**', 'node_modules/**'],
  },
});
