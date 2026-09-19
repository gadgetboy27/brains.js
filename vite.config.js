import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

/**
 * public/index.html loads ../src/main.js, which sits outside the Vite root.
 * The build handles that fine, but in dev the browser normalises the URL to
 * /src/main.js and Vite serves the HTML fallback for it. Rewrite the tag to a
 * /@fs/ URL during `vite serve` only.
 */
const entryOutsideRoot = {
  name: 'brains:entry-outside-root',
  apply: 'serve',
  transformIndexHtml: {
    order: 'pre', // before Vite normalises the relative URL to /src/main.js
    handler(html) {
      return html.replace('src="../src/main.js"', `src="/@fs/${projectRoot}src/main.js"`);
    },
  },
};

/** docs/PRIVACY.md is linked from the first-run screen as /PRIVACY.md. */
const privacyNotice = {
  name: 'brains:privacy-notice',
  configureServer(server) {
    server.middlewares.use('/PRIVACY.md', async (_req, res) => {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.end(await readFile(resolve(projectRoot, 'docs/PRIVACY.md'), 'utf8'));
    });
  },
  async generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'PRIVACY.md',
      source: await readFile(resolve(projectRoot, 'docs/PRIVACY.md'), 'utf8'),
    });
  },
};

export default defineConfig(({ command }) => ({
  // `npm run dev:https` serves a self-signed certificate so a phone on the
  // same network can open the app in a secure context (camera and motion
  // APIs refuse plain HTTP; only localhost is exempt). See docs/deployment.md.
  plugins: [
    entryOutsideRoot,
    privacyNotice,
    ...(command === 'serve' && process.env.npm_lifecycle_event === 'dev:https' ? [basicSsl()] : []),
  ],
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
    // CLI tests spawn node several times; under load that exceeds the 5 s default.
    testTimeout: 30_000,
    include: ['src/**/*.test.js'],
    exclude: ['legacy/**', 'node_modules/**'],
  },
}));
