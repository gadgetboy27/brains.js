/**
 * AR scene — renders the route path and POI markers in 3D, aligned to the
 * user's pose, on a transparent canvas laid over the camera view.
 *
 * Built on three.js. The scene is provider-agnostic: it does not own the
 * camera video (each provider does) and it does not know about fusion; it is
 * simply told the current pose via `setPose()` and draws the world from there.
 *
 * ## Frames
 *
 * Venue frame is right-handed, z-up, heading clockwise from +y. three.js is
 * right-handed, y-up, camera looking down −z. `venueToScene()` maps
 * `(x, y, z) → (x, z, −y)`, so venue +y becomes scene −z (forward), and a
 * heading of 0° looks down −z. Everything in the scene graph is in the venue
 * frame converted this way; the camera is moved to the pose, not the world.
 *
 * ## Floors
 *
 * Only the current floor's route segment and POIs are shown. A route that
 * changes floor is drawn up to the floor-change edge, with a marker on it.
 *
 * ## Testing
 *
 * `renderer` is injectable (tests pass a stub, since jsdom has no WebGL) and
 * label textures degrade to plain markers where 2D canvas is unavailable.
 */

import {
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';

import { makeTextSprite } from './labels.js';
import { cssToken } from './tokens.js';

/** @typedef {import('../core/positioning.js').Pose} Pose */
/** @typedef {import('../core/venue.js').Venue} Venue */
/** @typedef {import('../core/router.js').RouteFound} RouteFound */

const DEG = Math.PI / 180;

/** Venue (x, y, z; z up) → three.js (x, y, z; y up). */
export function venueToScene(p) {
  return new Vector3(p.x, p.z ?? 0, -p.y);
}

/** Venue heading (deg clockwise from +y) → three.js yaw about +y (radians). */
export function headingToYaw(headingDeg) {
  return -headingDeg * DEG;
}

/**
 * @typedef {Object} ArSceneOptions
 * @property {Venue} venue
 * @property {HTMLCanvasElement} [canvas]          Where to draw; created if omitted.
 * @property {HTMLElement} [mount]                 Parent for a created canvas (default document.body).
 * @property {object} [renderer]                   A three.js WebGLRenderer or a stub with
 *   `setSize`, `setPixelRatio`, `render`, `dispose`, `domElement`. Created if omitted.
 * @property {number} [fov=60]                     Vertical field of view in degrees.
 * @property {number} [eyeHeight=1.5]              Metres from the pose's z to the camera.
 * @property {number} [poiHeight=1.8]              Metres above the floor for POI markers.
 * @property {number} [pathHeight=0.05]            Metres above the floor for the route line.
 * @property {(text: string) => object | null} [createLabel]  Sprite factory; default draws to a canvas.
 * @property {Document} [document]
 */

export class ArScene {
  /** @type {ArSceneOptions & Required<Pick<ArSceneOptions, 'fov' | 'eyeHeight' | 'poiHeight' | 'pathHeight'>>} */
  #opts;
  #venue;
  #scene = new Scene();
  #camera;
  #renderer;
  #ownsRenderer = false;
  #canvas;
  #routeGroup = new Group();
  #poiGroup = new Group();
  #route = null;
  #pois = [];
  #pose = null;
  #floor = null;
  #disposables = new Set();

  /** @param {ArSceneOptions} options */
  constructor(options) {
    if (!options?.venue || !Array.isArray(options.venue.floors)) {
      throw new TypeError('ArScene requires a Venue');
    }
    this.#opts = { fov: 60, eyeHeight: 1.5, poiHeight: 1.8, pathHeight: 0.05, ...options };
    this.#venue = options.venue;
    const doc = this.#opts.document ?? globalThis.document;

    this.#canvas = this.#opts.canvas ?? doc?.createElement('canvas');
    if (!this.#canvas) throw new TypeError('ArScene needs a canvas (or a document to create one)');
    if (!this.#opts.canvas && (this.#opts.mount ?? doc?.body)) {
      // Fill the mount; the renderer sets the drawing-buffer size separately.
      this.#canvas.style.cssText = 'display:block;width:100%;height:100%;';
      (this.#opts.mount ?? doc.body).appendChild(this.#canvas);
    }

    this.#renderer = this.#opts.renderer ?? null;
    this.#camera = new PerspectiveCamera(this.#opts.fov, 1, 0.1, 500);
    this.#camera.rotation.order = 'YXZ';

    this.#routeGroup.name = 'route';
    this.#poiGroup.name = 'pois';
    this.#scene.add(this.#routeGroup, this.#poiGroup);
  }

  // -------------------------------------------------------------- accessors

  get scene() {
    return this.#scene;
  }

  get camera() {
    return this.#camera;
  }

  get canvas() {
    return this.#canvas;
  }

  /** The most recent pose given to setPose(), or null. */
  get pose() {
    return this.#pose;
  }

  /** Floor currently displayed, or null before the first pose. */
  get floor() {
    return this.#floor;
  }

  /** Number of POI markers currently in the scene. */
  get poiMarkerCount() {
    return this.#poiGroup.children.length;
  }

  /** Number of route objects (line + markers) currently in the scene. */
  get routeObjectCount() {
    return this.#routeGroup.children.length;
  }

  // ---------------------------------------------------------------- inputs

  /**
   * Move the camera to a pose. Switching floor rebuilds the visible layer.
   * @param {Pose} pose
   */
  setPose(pose) {
    this.#pose = pose;
    const eye = venueToScene({ x: pose.x, y: pose.y, z: (pose.z ?? 0) + this.#opts.eyeHeight });
    this.#camera.position.copy(eye);
    this.#camera.rotation.set(0, headingToYaw(pose.heading), 0);
    if (pose.floor !== this.#floor) {
      this.#floor = pose.floor;
      this.#rebuildRoute();
      this.#rebuildPois();
    }
  }

  /**
   * Show a route (from `findRoute()`), or clear it with `null`.
   * @param {RouteFound | null} route
   */
  setRoute(route) {
    this.#route = route && route.found ? route : null;
    this.#rebuildRoute();
  }

  /**
   * POIs to mark. Defaults to every public POI in the venue.
   * @param {ReadonlyArray<object>} pois
   */
  setPois(pois) {
    this.#pois = [...pois];
    this.#rebuildPois();
  }

  /** Resize the canvas and camera to the given CSS pixel size. */
  resize(width, height, pixelRatio = globalThis.devicePixelRatio ?? 1) {
    this.#camera.aspect = height === 0 ? 1 : width / height;
    this.#camera.updateProjectionMatrix();
    this.#ensureRenderer();
    this.#renderer?.setPixelRatio?.(pixelRatio);
    this.#renderer?.setSize?.(width, height, false);
  }

  /** Draw one frame. */
  render() {
    this.#ensureRenderer();
    this.#renderer?.render(this.#scene, this.#camera);
  }

  /** Release GPU resources and remove a canvas this instance created. */
  dispose() {
    this.#clear(this.#routeGroup);
    this.#clear(this.#poiGroup);
    for (const d of this.#disposables) d.dispose?.();
    this.#disposables.clear();
    if (this.#ownsRenderer) this.#renderer?.dispose?.();
    if (!this.#opts.canvas) this.#canvas.remove?.();
  }

  // -------------------------------------------------------------- building

  async #ensureRenderer() {
    if (this.#renderer) return;
    // Lazy: importing WebGLRenderer eagerly would break in jsdom tests.
    const { WebGLRenderer } = await import('three');
    this.#renderer = new WebGLRenderer({ canvas: this.#canvas, alpha: true, antialias: true });
    this.#renderer.setClearColor(0x000000, 0);
    this.#ownsRenderer = true;
  }

  /** Read a colour token (theme.css); `fallback` is a CSS colour name for stylesheet-less tests. */
  #token(name, fallback) {
    return cssToken(name, { fallback, getComputedStyle: this.#opts.getComputedStyle });
  }

  /** Rebuild everything with the current tokens (after a high-contrast toggle). */
  refreshColors() {
    this.#rebuildRoute();
    this.#rebuildPois();
  }

  #track(obj) {
    if (obj.geometry) this.#disposables.add(obj.geometry);
    if (obj.material) {
      this.#disposables.add(obj.material);
      if (obj.material.map) this.#disposables.add(obj.material.map);
    }
    return obj;
  }

  #clear(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose?.();
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
      this.#disposables.delete(child.geometry);
      this.#disposables.delete(child.material);
    }
  }

  #rebuildRoute() {
    this.#clear(this.#routeGroup);
    const route = this.#route;
    if (!route || this.#floor === null) return;

    // Walk the route; draw the stretch on the current floor, and mark where
    // it leaves the floor.
    const points = [];
    const lift = this.#opts.pathHeight;
    for (let i = 0; i < route.nodes.length; i += 1) {
      const node = route.nodes[i];
      if (node.floor === this.#floor) {
        points.push(venueToScene({ x: node.x, y: node.y, z: (node.z ?? 0) + lift }));
      }
      const edge = route.edges[i];
      const next = route.nodes[i + 1];
      if (edge && next && node.floor === this.#floor && next.floor !== this.#floor) {
        this.#routeGroup.add(this.#floorChangeMarker(node, edge, next));
        break;
      }
    }
    if (points.length >= 2) {
      const geometry = new BufferGeometry().setFromPoints(points);
      const material = new LineBasicMaterial({
        color: new Color(this.#token('--color-route', 'blue')),
        linewidth: 2,
      });
      const line = new Line(geometry, material);
      line.name = 'route-line';
      this.#routeGroup.add(this.#track(line));
    }
    // Destination marker on this floor.
    const last = route.nodes.at(-1);
    if (last && last.floor === this.#floor) {
      const ring = new Mesh(
        new RingGeometry(0.35, 0.5, 32),
        new MeshBasicMaterial({
          color: new Color(this.#token('--color-destination', 'green')),
          transparent: true,
          opacity: 0.9,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(venueToScene({ x: last.x, y: last.y, z: (last.z ?? 0) + lift + 0.01 }));
      ring.name = 'route-destination';
      this.#routeGroup.add(this.#track(ring));
    }
  }

  #floorChangeMarker(node, edge, next) {
    const cone = new Mesh(
      new ConeGeometry(0.3, 0.6, 16),
      new MeshBasicMaterial({ color: new Color(this.#token('--color-floor-change', 'orange')) })
    );
    const up = next.floor > node.floor;
    cone.rotation.x = up ? 0 : Math.PI;
    cone.position.copy(venueToScene({ x: node.x, y: node.y, z: (node.z ?? 0) + 1.2 }));
    cone.name = `route-floor-change:${edge.type ?? 'walk'}:${up ? 'up' : 'down'}`;
    cone.userData = { edge, toFloor: next.floor };
    this.#track(cone);
    const label = this.#label(`${edge.type ?? 'go'} ${up ? 'up' : 'down'} to floor ${next.floor}`);
    if (label) {
      label.position.set(0, 0.7, 0);
      cone.add(label);
    }
    return cone;
  }

  #rebuildPois() {
    this.#clear(this.#poiGroup);
    if (this.#floor === null) return;
    const pois =
      this.#pois.length > 0
        ? this.#pois
        : this.#venue.pois.filter((p) => (p.access ?? 'public') === 'public');
    for (const poi of pois) {
      const node = this.#venue.nodeById(poi.node);
      if (!node || (poi.floor ?? node.floor) !== this.#floor) continue;
      const marker = new Group();
      marker.name = `poi:${poi.id}`;
      marker.userData = { poi };
      marker.position.copy(
        venueToScene({ x: node.x, y: node.y, z: (node.z ?? 0) + this.#opts.poiHeight })
      );

      const pin = new Mesh(
        new ConeGeometry(0.15, 0.4, 12),
        new MeshBasicMaterial({ color: new Color(this.#token('--color-poi', 'red')) })
      );
      pin.rotation.x = Math.PI;
      marker.add(this.#track(pin));

      const label = this.#label(poi.name);
      if (label) {
        label.position.set(0, 0.45, 0);
        marker.add(label);
      }
      this.#poiGroup.add(marker);
    }
  }

  /** A billboard text label, or null when no 2D canvas is available. */
  #label(text) {
    if (this.#opts.createLabel) return this.#opts.createLabel(text);
    const sprite = makeTextSprite(text, { document: this.#opts.document });
    return sprite ? this.#track(sprite) : null;
  }
}

/**
 * Convenience wrapper: build a scene, keep it sized to its canvas's parent,
 * feed it poses from a provider, and render on animation frames.
 *
 * @param {ArSceneOptions & { provider: import('../core/positioning.js').PositionProvider, requestAnimationFrame?: Function, cancelAnimationFrame?: Function, window?: Window }} options
 * @returns {{ scene: ArScene, destroy(): void }}
 */
export function createArScene(options) {
  const {
    provider,
    requestAnimationFrame: raf = (cb) => globalThis.requestAnimationFrame(cb),
    cancelAnimationFrame: caf = (id) => globalThis.cancelAnimationFrame(id),
    window: win = globalThis.window,
    ...sceneOptions
  } = options;
  if (!provider || typeof provider.onPose !== 'function') {
    throw new TypeError('createArScene requires a PositionProvider');
  }
  const scene = new ArScene(sceneOptions);
  const offPose = provider.onPose((pose) => scene.setPose(pose));

  const fit = () => {
    const parent = scene.canvas.parentElement;
    const w = parent?.clientWidth || win?.innerWidth || 1;
    const h = parent?.clientHeight || win?.innerHeight || 1;
    scene.resize(w, h);
  };
  win?.addEventListener?.('resize', fit);
  fit();

  let frame = null;
  const loop = () => {
    scene.render();
    frame = raf(loop);
  };
  frame = raf(loop);

  return {
    scene,
    destroy() {
      if (frame !== null) caf(frame);
      win?.removeEventListener?.('resize', fit);
      offPose();
      scene.dispose();
    },
  };
}
