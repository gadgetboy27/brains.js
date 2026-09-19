// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Object3D, Vector3 } from 'three';

import { PositionProvider } from '../core/positioning.js';
import { findRoute } from '../core/router.js';
import { createVenue } from '../core/venue.js';
import sample from '../venues/fixtures/sample-venue.json';
import { ArScene, createArScene, headingToYaw, venueToScene } from './ar-scene.js';

const venue = () => createVenue(structuredClone(sample));

const pose = (overrides = {}) => ({
  x: 0,
  y: 0,
  z: 0,
  floor: 0,
  heading: 0,
  confidence: 1,
  timestamp: 1,
  ...overrides,
});

/** Renderer stub: jsdom has no WebGL. */
function stubRenderer() {
  return {
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    domElement: document.createElement('canvas'),
  };
}

/** Label factory that avoids 2D canvas (absent in jsdom). */
const fakeLabel = (text) => {
  const o = new Object3D();
  o.name = `label:${text}`;
  return o;
};

function make(options = {}) {
  const renderer = stubRenderer();
  const scene = new ArScene({ venue: venue(), renderer, createLabel: fakeLabel, ...options });
  return { scene, renderer };
}

const names = (group) => group.children.map((c) => c.name);

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('frame conversion', () => {
  it('maps venue z-up onto three.js y-up with +y becoming −z', () => {
    expect(venueToScene({ x: 1, y: 2, z: 3 })).toEqual(new Vector3(1, 3, -2));
    expect(venueToScene({ x: 1, y: 2 })).toEqual(new Vector3(1, 0, -2));
  });

  it('turns a clockwise heading into a negative yaw', () => {
    expect(headingToYaw(0)).toBe(-0);
    expect(headingToYaw(90)).toBeCloseTo(-Math.PI / 2, 12);
    expect(headingToYaw(270)).toBeCloseTo(-1.5 * Math.PI, 12);
  });
});

describe('ArScene — construction', () => {
  it('requires a venue', () => {
    expect(() => new ArScene({})).toThrow(/requires a Venue/);
  });

  it('creates and mounts a canvas when none is given, and removes it on dispose', () => {
    const { scene } = make();
    expect(scene.canvas.tagName).toBe('CANVAS');
    expect(document.body.contains(scene.canvas)).toBe(true);
    scene.dispose();
    expect(document.body.contains(scene.canvas)).toBe(false);
  });

  it('uses a supplied canvas without touching the DOM', () => {
    const canvas = document.createElement('canvas');
    const { scene } = make({ canvas });
    expect(scene.canvas).toBe(canvas);
    expect(document.body.children).toHaveLength(0);
    scene.dispose();
    expect(canvas.isConnected).toBe(false); // was never attached; not removed from anywhere
  });

  it('starts with an empty scene and no floor', () => {
    const { scene } = make();
    expect(scene.floor).toBeNull();
    expect(scene.poiMarkerCount).toBe(0);
    expect(scene.routeObjectCount).toBe(0);
    expect(scene.scene.children.map((c) => c.name)).toEqual([
      'route',
      'pois',
      'light-hemisphere',
      'light-key',
    ]);
  });
});

describe('ArScene — pose', () => {
  it('places the camera at eye height above the pose, facing the heading', () => {
    const { scene } = make({ eyeHeight: 1.6 });
    scene.setPose(pose({ x: 3, y: 4, z: 0.2, heading: 90 }));
    expect(scene.camera.position.x).toBeCloseTo(3, 9);
    expect(scene.camera.position.y).toBeCloseTo(1.8, 9);
    expect(scene.camera.position.z).toBeCloseTo(-4, 9);
    expect(scene.camera.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
    expect(scene.camera.rotation.order).toBe('YXZ');
  });

  it('a heading of 0 looks along venue +y (scene −z)', () => {
    const { scene } = make();
    scene.setPose(pose({ heading: 0 }));
    const dir = new Vector3();
    scene.camera.getWorldDirection(dir);
    expect(dir.x).toBeCloseTo(0, 9);
    expect(dir.z).toBeCloseTo(-1, 9);
  });

  it('a heading of 90 looks along venue +x', () => {
    const { scene } = make();
    scene.setPose(pose({ heading: 90 }));
    const dir = new Vector3();
    scene.camera.getWorldDirection(dir);
    expect(dir.x).toBeCloseTo(1, 9);
    expect(dir.z).toBeCloseTo(0, 9);
  });
});

describe('ArScene — POI markers', () => {
  it('shows public POIs on the current floor only, with labels', () => {
    const { scene } = make();
    scene.setPose(pose({ floor: 0 }));
    // Sample floor 0: poi-info, poi-shop-a, poi-toilets-g. Staff room is on floor 1 and staff-only.
    expect(names(scene.scene.getObjectByName('pois')).sort()).toEqual([
      'poi:poi-info',
      'poi:poi-shop-a',
      'poi:poi-toilets-g',
    ]);
    const info = scene.scene.getObjectByName('poi:poi-info');
    const node = venue().nodeById('n-atrium');
    expect(info.position.x).toBeCloseTo(node.x, 9);
    expect(info.position.y).toBeCloseTo(1.8, 9); // poiHeight
    expect(info.position.z).toBeCloseTo(-node.y, 9);
    expect(info.children.map((c) => c.name)).toContain('label:Information desk');
    expect(info.userData.poi.id).toBe('poi-info');
  });

  it('switches markers when the pose changes floor', () => {
    const { scene } = make();
    scene.setPose(pose({ floor: 0 }));
    scene.setPose(pose({ floor: 1 }));
    // Floor 1 public: poi-toilets-l1 only (staff room hidden).
    expect(names(scene.scene.getObjectByName('pois'))).toEqual(['poi:poi-toilets-l1']);
    expect(scene.floor).toBe(1);
  });

  it('does not rebuild when the floor is unchanged', () => {
    const { scene } = make();
    scene.setPose(pose({ floor: 0 }));
    const before = scene.scene.getObjectByName('poi:poi-info');
    scene.setPose(pose({ floor: 0, x: 5 }));
    expect(scene.scene.getObjectByName('poi:poi-info')).toBe(before);
  });

  it('accepts an explicit POI list (e.g. a search result) and honours poi.floor', () => {
    const { scene } = make();
    const v = venue();
    scene.setPose(pose({ floor: 1 }));
    scene.setPois([v.poiById('poi-staff-room'), v.poiById('poi-info')]);
    expect(names(scene.scene.getObjectByName('pois'))).toEqual(['poi:poi-staff-room']);
  });

  it('degrades to markers without labels when no label can be made', () => {
    const scene = new ArScene({
      venue: venue(),
      renderer: stubRenderer(),
      createLabel: () => null,
    });
    scene.setPose(pose({ floor: 0 }));
    const info = scene.scene.getObjectByName('poi:poi-info');
    expect(info.children).toHaveLength(1); // pin only
    scene.dispose();
  });

  it('falls back to no label when 2D canvas is unavailable (jsdom default)', () => {
    const scene = new ArScene({ venue: venue(), renderer: stubRenderer() });
    scene.setPose(pose({ floor: 0 }));
    const info = scene.scene.getObjectByName('poi:poi-info');
    expect(info.children.filter((c) => c.name.startsWith('label:'))).toHaveLength(0);
    scene.dispose();
  });
});

describe('ArScene — route', () => {
  it('draws the route line and destination ring for a single-floor route', () => {
    const { scene } = make();
    const v = venue();
    const route = findRoute(v.graph, 'n-entrance', 'n-shop-a');
    scene.setPose(pose({ floor: 0 }));
    scene.setRoute(route);

    const group = scene.scene.getObjectByName('route');
    expect(names(group)).toEqual(['route-line', 'route-centreline', 'route-destination']);
    const tube = scene.scene.getObjectByName('route-line');
    expect(tube.geometry.type).toBe('TubeGeometry'); // WebGL ignores line width; the route is a tube
    expect(tube.userData.points).toBe(3);
    const line = scene.scene.getObjectByName('route-centreline');
    const positions = line.geometry.getAttribute('position');
    expect(positions.count).toBe(3);
    expect(positions.getX(2)).toBeCloseTo(20, 9);
    expect(positions.getY(0)).toBeCloseTo(0.05, 6); // pathHeight (float32)
    const ring = scene.scene.getObjectByName('route-destination');
    expect(ring.position.x).toBeCloseTo(20, 9);
  });

  it('draws only the current floor and marks the floor change', () => {
    const { scene } = make();
    const v = venue();
    const route = findRoute(v.graph, 'n-entrance', 'n-l1-toilets', { wheelchair: true });
    expect(route.path).toEqual(['n-entrance', 'n-atrium', 'n-l1-landing', 'n-l1-toilets']);

    scene.setPose(pose({ floor: 0 }));
    scene.setRoute(route);
    let group = scene.scene.getObjectByName('route');
    expect(names(group)).toEqual(['route-floor-change:lift:up', 'route-line', 'route-centreline']);
    const cone = group.children[0];
    expect(cone.userData.toFloor).toBe(1);
    expect(cone.position.x).toBeCloseTo(10, 9); // at n-atrium
    expect(cone.children.map((c) => c.name)).toContain('label:lift up to floor 1');
    expect(scene.scene.getObjectByName('route-destination')).toBeUndefined();

    scene.setPose(pose({ floor: 1 }));
    group = scene.scene.getObjectByName('route');
    expect(names(group)).toEqual(['route-line', 'route-centreline', 'route-destination']);
    const line = scene.scene.getObjectByName('route-centreline');
    expect(line.geometry.getAttribute('position').count).toBe(2);
  });

  it('clears the route with null or a not-found result', () => {
    const { scene } = make();
    scene.setPose(pose({ floor: 0 }));
    scene.setRoute(findRoute(venue().graph, 'n-entrance', 'n-shop-a'));
    expect(scene.routeObjectCount).toBe(3);
    scene.setRoute(null);
    expect(scene.routeObjectCount).toBe(0);
    scene.setRoute({ found: false, reason: 'no-route' });
    expect(scene.routeObjectCount).toBe(0);
  });

  it('draws nothing before the first pose', () => {
    const { scene } = make();
    scene.setRoute(findRoute(venue().graph, 'n-entrance', 'n-shop-a'));
    expect(scene.routeObjectCount).toBe(0);
    scene.setPose(pose({ floor: 0 }));
    expect(scene.routeObjectCount).toBe(3);
  });
});

describe('ArScene — rendering and resize', () => {
  it('resizes camera aspect and renderer', () => {
    const { scene, renderer } = make();
    scene.resize(800, 400, 2);
    expect(scene.camera.aspect).toBe(2);
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(2);
    expect(renderer.setSize).toHaveBeenCalledWith(800, 400, false);
  });

  it('renders with the injected renderer and disposes it only if it created it', () => {
    const { scene, renderer } = make();
    scene.render();
    expect(renderer.render).toHaveBeenCalledWith(scene.scene, scene.camera);
    scene.dispose();
    expect(renderer.dispose).not.toHaveBeenCalled();
  });

  it('disposes geometries and materials of everything it built', () => {
    const { scene } = make();
    scene.setPose(pose({ floor: 0 }));
    scene.setRoute(findRoute(venue().graph, 'n-entrance', 'n-shop-a'));
    const line = scene.scene.getObjectByName('route-centreline');
    const geomDispose = vi.spyOn(line.geometry, 'dispose');
    const matDispose = vi.spyOn(line.material, 'dispose');
    scene.dispose();
    expect(geomDispose).toHaveBeenCalled();
    expect(matDispose).toHaveBeenCalled();
    expect(scene.routeObjectCount).toBe(0);
    expect(scene.poiMarkerCount).toBe(0);
  });
});

describe('createArScene', () => {
  class Fake extends PositionProvider {
    static uploads = [];
    async start() {}
    async stop() {}
    emit(p) {
      this.emitPose(p);
    }
  }

  it('feeds provider poses to the scene, renders on frames, and tears down', () => {
    const provider = new Fake();
    const renderer = stubRenderer();
    const frames = [];
    const raf = vi.fn((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const caf = vi.fn();
    const mount = document.createElement('div');
    Object.defineProperty(mount, 'clientWidth', { value: 640 });
    Object.defineProperty(mount, 'clientHeight', { value: 480 });
    document.body.appendChild(mount);

    const handle = createArScene({
      provider,
      venue: venue(),
      renderer,
      mount,
      createLabel: fakeLabel,
      requestAnimationFrame: raf,
      cancelAnimationFrame: caf,
    });

    expect(renderer.setSize).toHaveBeenCalledWith(640, 480, false);
    expect(raf).toHaveBeenCalledOnce();

    provider.emit(pose({ x: 7, floor: 0 }));
    expect(handle.scene.camera.position.x).toBeCloseTo(7, 9);
    expect(handle.scene.poiMarkerCount).toBe(3);

    frames[0]();
    expect(renderer.render).toHaveBeenCalledOnce();
    expect(raf).toHaveBeenCalledTimes(2);

    handle.destroy();
    expect(caf).toHaveBeenCalledWith(2);
    provider.emit(pose({ x: 9 }));
    expect(handle.scene.camera.position.x).toBeCloseTo(7, 9); // unsubscribed
    expect(document.body.contains(handle.scene.canvas)).toBe(false);
  });

  it('requires a provider', () => {
    expect(() => createArScene({ venue: venue() })).toThrow(/requires a PositionProvider/);
  });
});
