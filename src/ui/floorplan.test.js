// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findRoute } from '../core/router.js';
import { createVenue } from '../core/venue.js';
import demo from '../venues/demo-venue.json';
import { createFloorplan } from './floorplan.js';
import { t } from './strings/index.js';

const venue = () => createVenue(structuredClone(demo));
const pose = (x, y, heading = 0, floor = 0) => ({
  x,
  y,
  z: floor * 4,
  floor,
  heading,
  confidence: 1,
  timestamp: 1,
});

/** A recording 2-D context. */
function fakeContext() {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'calls') return calls;
        return (...args) => {
          calls.push([prop, ...args]);
        };
      },
      set(_, prop, value) {
        calls.push(['set', prop, value]);
        return true;
      },
    }
  );
  return ctx;
}

const tokens = {
  '--color-plan-bg': '#000001',
  '--color-plan-route': '#000002',
  '--color-plan-destination': '#000003',
  '--color-plan-position': '#000004',
  '--color-plan-edge': '#000005',
  '--color-plan-edge-stairs': '#000006',
  '--color-plan-poi': '#000007',
};
const getComputedStyle = () => ({ getPropertyValue: (n) => tokens[n] ?? '' });

function make(options = {}) {
  const context = fakeContext();
  const fp = createFloorplan({
    venue: venue(),
    context,
    getComputedStyle,
    pixelsPerMetre: 10,
    ...options,
  });
  fp.resize(400, 300, 1);
  return { fp, context };
}

const sets = (ctx, prop) =>
  ctx.calls.filter((c) => c[0] === 'set' && c[1] === prop).map((c) => c[2]);

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Floorplan — setup', () => {
  it('requires a venue', () => {
    expect(() => createFloorplan({})).toThrow(/requires a Venue/);
  });

  it('mounts a labelled canvas and a rotation toggle', () => {
    const { fp } = make();
    expect(document.body.contains(fp.el)).toBe(true);
    expect(fp.canvas.getAttribute('role')).toBe('img');
    expect(fp.summary).toBe(t('floorplan.noPose'));
    const toggle = fp.el.querySelector('button');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();
    expect(fp.rotationMode).toBe('north-up');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Floorplan — projection', () => {
  it('centres on the user with north-up: +y is up the screen', () => {
    const { fp } = make({ rotationMode: 'north-up' });
    fp.setPose(pose(10, 20, 0));
    expect(fp.toScreen(10, 20)).toEqual({ x: 200, y: 150 });
    expect(fp.toScreen(10, 25)).toEqual({ x: 200, y: 100 }); // 5 m north → 50 px up
    expect(fp.toScreen(15, 20)).toEqual({ x: 250, y: 150 });
  });

  it('heading-up rotates the map so the facing direction is up', () => {
    const { fp } = make({ rotationMode: 'heading-up' });
    fp.setPose(pose(0, 0, 90)); // facing +x
    const ahead = fp.toScreen(5, 0); // 5 m along +x
    expect(ahead.x).toBeCloseTo(200, 6);
    expect(ahead.y).toBeCloseTo(100, 6); // straight up the screen
    const left = fp.toScreen(0, 5); // +y is now to the left
    expect(left.x).toBeCloseTo(150, 6);
    expect(left.y).toBeCloseTo(150, 6);
  });

  it('centres on the floor before any pose', () => {
    const { fp } = make({ rotationMode: 'north-up' });
    const c = fp.toScreen(15, 6); // roughly the centroid of floor 0 nodes
    expect(Math.abs(c.x - 200)).toBeLessThan(40);
    expect(Math.abs(c.y - 150)).toBeLessThan(40);
  });
});

describe('Floorplan — drawing', () => {
  it('draws background, graph, POIs and the position from CSS tokens', () => {
    const { fp, context } = make();
    fp.setPose(pose(0, 0));
    const fills = sets(context, 'fillStyle');
    expect(fills).toContain('#000001'); // bg
    expect(fills).toContain('#000004'); // position
    expect(fills).toContain('#000007'); // poi
    expect(sets(context, 'strokeStyle')).toContain('#000005'); // edges
    expect(sets(context, 'strokeStyle')).toContain('#000006'); // vertical edges (stairs/lift)
    const texts = context.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
    expect(texts).toContain('Clinic A');
    expect(texts).not.toContain('Staff room'); // wrong floor and staff-only
    expect(fp.summary).toBe('Floor plan of Ground. You are at 0.0, 0.0 metres, facing 0 degrees.');
  });

  it('draws the route on the current floor only and the destination ring', () => {
    const { fp, context } = make();
    const v = venue();
    const route = findRoute(v.graph, 'n-entrance', 'n-clinic-b', {
      wheelchair: true,
      timeOfDay: '12:00',
    });
    fp.setPose(pose(0, 0));
    fp.setRoute(route);
    fp.setDestination(v.poiById('poi-clinic-b'));

    expect(sets(context, 'strokeStyle')).toContain('#000002'); // route drawn
    // Floor 0 part of the route: entrance, lobby, 3 corridor nodes, lift-g = 6 points.
    const routeCalls = context.calls.slice(
      context.calls.findIndex((c) => c[0] === 'set' && c[2] === '#000002')
    );
    const moves = routeCalls.filter((c) => c[0] === 'moveTo').length;
    const lines = routeCalls.filter((c) => c[0] === 'lineTo').length;
    expect(moves).toBeGreaterThanOrEqual(1);
    expect(lines).toBeGreaterThanOrEqual(5);
    // Destination is on floor 1: no ring here, banner shown.
    expect(sets(context, 'strokeStyle')).not.toContain('#000003');
    const banner = fp.el.querySelector('.floorplan-banner');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toBe('Your destination is on First floor.');

    // Go upstairs: ring drawn, banner hidden.
    context.calls.length = 0;
    fp.setPose(pose(30, 10, 0, 1));
    expect(fp.floor).toBe(1);
    expect(sets(context, 'strokeStyle')).toContain('#000003');
    expect(banner.hidden).toBe(true);
  });

  it('does not draw staff-only edges', () => {
    const { fp, context } = make({ rotationMode: 'north-up' });
    fp.setPose(pose(0, 6));
    context.calls.length = 0;
    fp.render();
    // Edge drawing is the stretch between the first edge colour and the POI colour.
    const start = context.calls.findIndex(
      (c) => c[0] === 'set' && c[1] === 'strokeStyle' && c[2] === '#000005'
    );
    const end = context.calls.findIndex(
      (c, i) => i > start && c[0] === 'set' && c[1] === 'fillStyle' && c[2] === '#000007'
    );
    const segs = [];
    const slice = context.calls.slice(start, end);
    for (let i = 0; i < slice.length - 1; i += 1) {
      if (slice[i][0] === 'moveTo' && slice[i + 1][0] === 'lineTo') {
        segs.push(`${slice[i][1]},${slice[i][2]}→${slice[i + 1][1]},${slice[i + 1][2]}`);
      }
    }
    // Staff corridor lobby (0,6) → clinic A (10,12) would be (200,150)→(300,90).
    expect(segs).not.toContain('200,150→300,90');
    expect(segs).toContain('300,150→300,90'); // the public door to Clinic A
    expect(segs).toContain('200,150→300,150'); // lobby → corridor-g-1
  });

  it('draws the plan image when the floor has one and it loads', async () => {
    const v = venue();
    const json = structuredClone(demo);
    json.floors[0].plan = {
      image: 'ground.png',
      widthPx: 400,
      heightPx: 300,
      metresPerPixel: 0.1,
      originPx: { x: 0, y: 300 },
    };
    const img = { fake: true };
    const loadImage = vi.fn(async () => img);
    const { fp, context } = make({ venue: createVenue(json), loadImage, planBaseUrl: '/venues/' });
    fp.setPose(pose(0, 0));
    expect(loadImage).toHaveBeenCalledWith('/venues/demo-health-centre/ground.png');
    await Promise.resolve();
    await Promise.resolve();
    const draw = context.calls.find((c) => c[0] === 'drawImage');
    expect(draw).toBeDefined();
    expect(draw[1]).toBe(img);
    expect(draw[4]).toBe(400); // 400 px × 0.1 m/px × 10 px/m
    expect(draw[5]).toBe(300);
    expect(v.floorByIndex(0).plan).toBeUndefined(); // original untouched
  });

  it('renders nothing without a context or size', () => {
    const fp = createFloorplan({ venue: venue(), context: null, getComputedStyle });
    expect(() => fp.setPose(pose(0, 0))).not.toThrow();
    const { fp: fp2, context } = make();
    fp2.resize(0, 0);
    context.calls.length = 0;
    fp2.render();
    expect(context.calls).toEqual([]);
  });

  it('show / hide / destroy', () => {
    const { fp } = make();
    fp.hide();
    expect(fp.el.hidden).toBe(true);
    fp.show();
    expect(fp.el.hidden).toBe(false);
    fp.destroy();
    expect(document.body.contains(fp.el)).toBe(false);
  });
});
