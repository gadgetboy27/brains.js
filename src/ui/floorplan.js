/**
 * Floor plan view — a 2-D, top-down map of the current floor showing where
 * the user is, the route, and the destination. Designed to be used with the
 * phone held at waist height, screen up: it is a first-class way to navigate,
 * not a fallback for when the camera fails.
 *
 *  - Draws the floor's plan image (from `floors[].plan`) when present, else a
 *    metre grid, then the route graph, the route, POIs, the destination and
 *    the user's position with a heading wedge.
 *  - "Heading-up" by default (the map rotates so the direction you face is
 *    up, like a car sat-nav) or "north-up" (venue +y up); toggle with
 *    `setRotationMode()`.
 *  - Follows the user's floor; if the destination is on another floor a
 *    banner says so.
 *  - Every colour is a CSS token; every string is from strings.js.
 *  - Exposes a text summary for screen readers (`aria-label` on the canvas,
 *    updated on each pose).
 *
 * The 2-D context is injectable so the drawing logic is tested without a real
 * canvas.
 */

import { t } from './strings/index.js';
import { cssToken, ensureStyle } from './tokens.js';

/** @typedef {import('../core/positioning.js').Pose} Pose */
/** @typedef {import('../core/venue.js').Venue} Venue */

const CSS = `
.floorplan { position: relative; width: 100%; height: 100%; background: var(--color-plan-bg); overflow: hidden; }
.floorplan[hidden] { display: none; }
.floorplan canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.floorplan-banner { position: absolute; top: 12px; left: 12px; right: 12px; padding: 10px 12px; border-radius: var(--radius);
  background: var(--color-surface); color: var(--color-text); font-family: var(--font); font-size: var(--font-size); }
.floorplan-banner[hidden] { display: none; }
.floorplan-controls { position: absolute; right: 12px; bottom: 12px; display: grid; gap: 8px; }
`;

const DEG = Math.PI / 180;

/**
 * @typedef {Object} FloorplanOptions
 * @property {Venue} venue
 * @property {HTMLElement} [mount]
 * @property {Document} [document]
 * @property {HTMLCanvasElement} [canvas]
 * @property {CanvasRenderingContext2D} [context]  Injectable for tests.
 * @property {number} [pixelsPerMetre=20]
 * @property {'heading-up' | 'north-up'} [rotationMode='heading-up']
 * @property {(src: string) => Promise<CanvasImageSource | null>} [loadImage]
 * @property {string} [planBaseUrl='/venues/']  Where floor plan images are served from.
 * @property {Function} [getComputedStyle]
 */

export class Floorplan {
  #opts;
  #venue;
  #doc;
  #el;
  #canvas;
  #ctx;
  #banner;
  #pose = null;
  #route = null;
  #destination = null;
  #floor = null;
  #rotationMode;
  #images = new Map();
  #width = 0;
  #height = 0;
  #dpr = 1;
  #onRotationChange = null;

  /** @param {FloorplanOptions} options */
  constructor(options) {
    if (!options?.venue?.floors) throw new TypeError('Floorplan requires a Venue');
    this.#opts = {
      pixelsPerMetre: 20,
      rotationMode: 'heading-up',
      planBaseUrl: '/venues/',
      ...options,
    };
    this.#venue = options.venue;
    this.#doc = options.document ?? globalThis.document;
    this.#rotationMode = this.#opts.rotationMode;
    if (!this.#doc) throw new TypeError('Floorplan requires a document');

    ensureStyle('brains-floorplan-style', CSS, this.#doc);
    this.#el = this.#doc.createElement('section');
    this.#el.className = 'floorplan';
    this.#el.setAttribute('aria-label', t('floorplan.title'));
    this.#canvas = options.canvas ?? this.#doc.createElement('canvas');
    this.#canvas.setAttribute('role', 'img');
    this.#canvas.setAttribute('aria-label', t('floorplan.noPose'));
    this.#el.appendChild(this.#canvas);
    this.#banner = this.#doc.createElement('div');
    this.#banner.className = 'floorplan-banner';
    this.#banner.setAttribute('role', 'status');
    this.#banner.hidden = true;
    this.#el.appendChild(this.#banner);

    const controls = this.#doc.createElement('div');
    controls.className = 'floorplan-controls';
    const rotate = this.#doc.createElement('button');
    rotate.type = 'button';
    rotate.className = 'btn';
    rotate.setAttribute('aria-pressed', String(this.#rotationMode === 'north-up'));
    rotate.textContent = 'N';
    rotate.setAttribute('aria-label', t('floorplan.title'));
    rotate.addEventListener('click', () => {
      this.setRotationMode(this.#rotationMode === 'heading-up' ? 'north-up' : 'heading-up');
      rotate.setAttribute('aria-pressed', String(this.#rotationMode === 'north-up'));
    });
    controls.appendChild(rotate);
    this.#el.appendChild(controls);

    (options.mount ?? this.#doc.body).appendChild(this.#el);
    this.#ctx = options.context ?? this.#canvas.getContext?.('2d') ?? null;
  }

  get el() {
    return this.#el;
  }

  get canvas() {
    return this.#canvas;
  }

  get floor() {
    return this.#floor;
  }

  get rotationMode() {
    return this.#rotationMode;
  }

  /** Screen-reader summary of the current state. */
  get summary() {
    return this.#canvas.getAttribute('aria-label');
  }

  // ---------------------------------------------------------------- inputs

  /** @param {Pose} pose */
  setPose(pose) {
    this.#pose = pose;
    if (pose.floor !== this.#floor) this.#setFloor(pose.floor);
    const floorName = this.#venue.floorByIndex(pose.floor)?.name ?? t('floor.unknown');
    this.#canvas.setAttribute(
      'aria-label',
      t('floorplan.summary', {
        floor: floorName,
        x: pose.x.toFixed(1),
        y: pose.y.toFixed(1),
        heading: Math.round(pose.heading),
      })
    );
    this.render();
  }

  /** @param {import('../core/router.js').RouteFound | null} route */
  setRoute(route) {
    this.#route = route && route.found ? route : null;
    this.render();
  }

  /** @param {object | null} poi */
  setDestination(poi) {
    this.#destination = poi;
    this.#updateBanner();
    this.render();
  }

  /** @param {'heading-up' | 'north-up'} mode */
  setRotationMode(mode) {
    if (mode !== 'heading-up' && mode !== 'north-up') throw new RangeError('rotation mode');
    this.#rotationMode = mode;
    this.#onRotationChange?.(mode);
    this.render();
  }

  /** Show a floor explicitly (e.g. to preview the destination floor). */
  showFloor(index) {
    this.#setFloor(index);
    this.render();
  }

  #setFloor(index) {
    this.#floor = index;
    const floor = this.#venue.floorByIndex(index);
    if (floor?.plan?.image && !this.#images.has(index) && this.#opts.loadImage) {
      this.#images.set(index, null);
      this.#opts
        .loadImage(resolvePlanUrl(floor.plan.image, this.#opts.planBaseUrl, this.#venue.id))
        .then((img) => {
          this.#images.set(index, img);
          this.render();
        })
        .catch(() => this.#images.set(index, null));
    }
    this.#updateBanner();
  }

  #updateBanner() {
    const dest = this.#destination;
    if (!dest || this.#floor === null) {
      this.#banner.hidden = true;
      return;
    }
    const node = this.#venue.nodeById(dest.node);
    const destFloor = dest.floor ?? node?.floor;
    if (destFloor !== undefined && destFloor !== this.#floor) {
      const name = this.#venue.floorByIndex(destFloor)?.name ?? t('floor.unknown');
      this.#banner.textContent = t('floorplan.otherFloor', { name });
      this.#banner.hidden = false;
    } else {
      this.#banner.hidden = true;
    }
  }

  // --------------------------------------------------------------- drawing

  /**
   * Size the canvas in CSS pixels.
   * @param {number} width
   * @param {number} height
   * @param {number} [dpr]
   */
  resize(width, height, dpr = globalThis.devicePixelRatio ?? 1) {
    this.#width = width;
    this.#height = height;
    this.#dpr = dpr;
    this.#canvas.width = Math.round(width * dpr);
    this.#canvas.height = Math.round(height * dpr);
    this.render();
  }

  /** Map venue metres → canvas CSS pixels for the current view. */
  toScreen(x, y) {
    const centre = this.#pose ?? this.#centreOfFloor();
    const rot = this.#rotationMode === 'heading-up' && this.#pose ? this.#pose.heading * DEG : 0;
    const dx = x - centre.x;
    const dy = y - centre.y;
    // Rotate so that the heading direction points up the screen, then flip y.
    const rx = dx * Math.cos(rot) - dy * Math.sin(rot);
    const ry = dx * Math.sin(rot) + dy * Math.cos(rot);
    const s = this.#opts.pixelsPerMetre;
    return { x: this.#width / 2 + rx * s, y: this.#height / 2 - ry * s };
  }

  #centreOfFloor() {
    const nodes = this.#venue.nodesOnFloor(this.#floor ?? this.#venue.floors[0].index);
    if (nodes.length === 0) return { x: 0, y: 0 };
    const sum = nodes.reduce((a, n) => ({ x: a.x + n.x, y: a.y + n.y }), { x: 0, y: 0 });
    return { x: sum.x / nodes.length, y: sum.y / nodes.length };
  }

  #token(name, fallback) {
    return cssToken(name, { fallback, getComputedStyle: this.#opts.getComputedStyle });
  }

  render() {
    const ctx = this.#ctx;
    if (!ctx || this.#width === 0 || this.#height === 0) return;
    const floorIndex = this.#floor ?? this.#venue.floors[0].index;
    const floor = this.#venue.floorByIndex(floorIndex);
    const s = this.#opts.pixelsPerMetre;

    ctx.save();
    ctx.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    ctx.fillStyle = this.#token('--color-plan-bg', 'black');
    ctx.fillRect(0, 0, this.#width, this.#height);

    // Plan image or grid.
    const img = this.#images.get(floorIndex);
    if (img && floor?.plan?.metresPerPixel) {
      const { metresPerPixel, originPx, widthPx, heightPx } = floor.plan;
      const origin = originPx ?? { x: 0, y: heightPx };
      // Image corners in venue metres → screen.
      const tl = this.toScreen((0 - origin.x) * metresPerPixel, (origin.y - 0) * metresPerPixel);
      const rot = this.#rotationMode === 'heading-up' && this.#pose ? this.#pose.heading * DEG : 0;
      ctx.save();
      ctx.translate(tl.x, tl.y);
      ctx.rotate(rot);
      ctx.globalAlpha = 0.6;
      ctx.drawImage(img, 0, 0, widthPx * metresPerPixel * s, heightPx * metresPerPixel * s);
      ctx.restore();
    } else {
      ctx.strokeStyle = this.#token('--color-plan-grid', 'gray');
      ctx.lineWidth = 1;
      const centre = this.#pose ?? this.#centreOfFloor();
      const span = Math.ceil(Math.max(this.#width, this.#height) / s) + 2;
      for (let gx = Math.floor(centre.x) - span; gx <= centre.x + span; gx += 5) {
        for (let gy = Math.floor(centre.y) - span; gy <= centre.y + span; gy += 5) {
          const a = this.toScreen(gx, gy);
          const b = this.toScreen(gx + 5, gy);
          const c = this.toScreen(gx, gy + 5);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(c.x, c.y);
          ctx.stroke();
        }
      }
    }

    // Route graph on this floor.
    const nodesHere = new Set(this.#venue.nodesOnFloor(floorIndex).map((n) => n.id));
    ctx.lineWidth = 3;
    for (const edge of this.#venue.graph.edges) {
      const a = this.#venue.nodeById(edge.from);
      const b = this.#venue.nodeById(edge.to);
      if (!nodesHere.has(a.id) && !nodesHere.has(b.id)) continue;
      if (edge.staffOnly) continue;
      const vertical = a.floor !== b.floor;
      ctx.strokeStyle = this.#token(
        vertical ? '--color-plan-edge-stairs' : '--color-plan-edge',
        'gray'
      );
      const pa = this.toScreen(a.x, a.y);
      const pb = this.toScreen(b.x, b.y);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // POIs on this floor.
    ctx.fillStyle = this.#token('--color-plan-poi', 'silver');
    ctx.font = `${Math.max(12, s * 0.6)}px ${this.#token('--font', 'sans-serif')}`;
    ctx.textBaseline = 'middle';
    for (const poi of this.#venue.poisOnFloor(floorIndex)) {
      if ((poi.access ?? 'public') !== 'public') continue;
      const node = this.#venue.nodeById(poi.node);
      const p = this.toScreen(node.x, node.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.#token('--color-plan-text', 'white');
      ctx.fillText(poi.name, p.x + 8, p.y);
      ctx.fillStyle = this.#token('--color-plan-poi', 'silver');
    }

    // Route (this floor's segment).
    if (this.#route) {
      ctx.strokeStyle = this.#token('--color-plan-route', 'blue');
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      let started = false;
      for (const node of this.#route.nodes) {
        if (node.floor !== floorIndex) {
          started = false;
          continue;
        }
        const p = this.toScreen(node.x, node.y);
        if (started) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        started = true;
      }
      ctx.stroke();
    }

    // Destination.
    if (this.#destination) {
      const node = this.#venue.nodeById(this.#destination.node);
      if (node && (this.#destination.floor ?? node.floor) === floorIndex) {
        const p = this.toScreen(node.x, node.y);
        ctx.strokeStyle = this.#token('--color-plan-destination', 'green');
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Position + heading wedge.
    if (this.#pose) {
      const p = this.toScreen(this.#pose.x, this.#pose.y);
      const rot = this.#rotationMode === 'heading-up' ? 0 : this.#pose.heading * DEG;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(rot);
      ctx.fillStyle = this.#token('--color-plan-position', 'cyan');
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 40, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.#token('--color-plan-position-heading', 'white');
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  // --------------------------------------------------------------- lifecycle

  show() {
    this.#el.hidden = false;
  }

  hide() {
    this.#el.hidden = true;
  }

  destroy() {
    this.#el.remove();
  }
}

/** Absolute or root-relative image paths are used as-is; others are venue-relative. */
export function resolvePlanUrl(image, baseUrl, venueId) {
  if (/^(https?:)?\/\//i.test(image) || image.startsWith('/') || image.startsWith('data:'))
    return image;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${venueId}/${image}`;
}

/** @param {FloorplanOptions} options */
export function createFloorplan(options) {
  return new Floorplan(options);
}
