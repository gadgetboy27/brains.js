// Application entry point. Wires together core, providers, ui and venues.
//
// For now this boots the sample venue on the mock provider so `npm run dev`
// shows the positioning stack and AR scene running end to end without any
// hardware: the simulated user walks the route graph while the scene draws
// POI markers and a route to the Level 1 toilets.

import { findRoute } from './core/router.js';
import { createVenue } from './core/venue.js';
import { createProviderChain } from './providers/index.js';
import { createArScene } from './ui/ar-scene.js';
import { createDebugOverlay } from './ui/debug-overlay.js';
import sampleVenue from './venues/fixtures/sample-venue.json';

const app = document.querySelector('#app');
app.textContent = '';
app.style.cssText = 'position:fixed;inset:0;background:#111;';

const venue = createVenue(sampleVenue);
const path = venue.graph.nodes.map(({ x, y, z, floor }) => ({ x, y, z, floor }));

const chain = createProviderChain(venue, {
  order: ['mock'],
  allowMock: true,
  mock: { path, loop: true, speedMps: 1.2, fixIntervalMs: 1000, driftRateMps: 0.05 },
});

const ar = createArScene({ provider: chain, venue, mount: app });
ar.scene.setRoute(findRoute(venue.graph, 'n-entrance', 'n-l1-toilets', { wheelchair: true }));

createDebugOverlay({ provider: chain });
chain.start();
