// Application entry point. Wires together core, providers, ui and venues.
//
// For now this boots the sample venue on the mock provider so `npm run dev`
// shows the positioning stack running end to end without any hardware.

import { createProviderChain } from './providers/index.js';
import { createVenue } from './core/venue.js';
import { createDebugOverlay } from './ui/debug-overlay.js';
import sampleVenue from './venues/fixtures/sample-venue.json';

const app = document.querySelector('#app');
app.textContent = 'brains.js — indoor AR wayfinding';

const venue = createVenue(sampleVenue);
const path = venue.graph.nodes.map(({ x, y, z, floor }) => ({ x, y, z, floor }));

const chain = createProviderChain(venue, {
  order: ['mock'],
  allowMock: true,
  mock: { path, loop: true, speedMps: 1.2, fixIntervalMs: 1000, driftRateMps: 0.05 },
});

createDebugOverlay({ provider: chain });
chain.start();
