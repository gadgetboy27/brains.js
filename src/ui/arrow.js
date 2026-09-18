/**
 * Navigation arrow — a single 3-D arrow (assets/models/arrow-model.glb) that
 * floats ahead of the user and points at the next node on the route, with a
 * distance label that always faces the camera.
 *
 * Ported from legacy/navigation.js:
 *  - the **bob** animation (position oscillating with easeInOutSine, 1 s per
 *    half cycle, alternating), now driven from `update(timeMs)` instead of an
 *    A-Frame animation attribute;
 *  - the **look-at** behaviour: the arrow's `lookAt()` the target each frame,
 *    and the label is a Sprite so it faces the camera.
 *
 * Colour comes from the `--color-arrow` CSS token (no hex in code, no colour
 * array); call `refreshColors()` after toggling high-contrast mode.
 *
 * The GLB loader is injectable so tests run without network or WebGL.
 */

import { Group, MeshBasicMaterial, Object3D, Vector3 } from 'three';

import { t } from './strings/index.js';
import { makeTextSprite, updateTextSprite } from './labels.js';
import { cssToken } from './tokens.js';
import { formatMetres } from './strings/index.js';
import { venueToScene } from './ar-scene.js';

/** @typedef {import('../core/positioning.js').Pose} Pose */

/**
 * @typedef {Object} ArrowOptions
 * @property {import('three').Object3D} parent     Scene or group to add the arrow to.
 * @property {string} [modelUrl='/models/arrow-model.glb']
 * @property {(url: string) => Promise<Object3D>} [loadModel]  Injectable loader.
 * @property {number} [distanceAhead=2]     Metres in front of the user to float the arrow.
 * @property {number} [height=1.2]          Metres above the pose's z for the arrow's rest position.
 * @property {number} [bobAmplitude=0.15]   Metres of vertical bob (legacy: 2 units on an 8-unit arrow).
 * @property {number} [bobPeriodMs=1000]    Time for one up-or-down leg (legacy `dur: 1000`).
 * @property {number} [scale=0.5]           Uniform scale applied to the model.
 * @property {(text: string) => object | null} [createLabel]
 * @property {(sprite: object, text: string) => boolean} [updateLabel]
 * @property {Document} [document]
 * @property {Function} [getComputedStyle]
 */

/** easeInOutSine as used by the legacy A-Frame animation. */
export function easeInOutSine(x) {
  return -(Math.cos(Math.PI * x) - 1) / 2;
}

/**
 * Bob offset at time `t`: alternates up and down over `period`, eased.
 * @param {number} timeMs
 * @param {number} amplitude
 * @param {number} periodMs
 */
export function bobOffset(timeMs, amplitude, periodMs) {
  if (periodMs <= 0 || amplitude === 0) return 0;
  const phase = (timeMs % (2 * periodMs)) / periodMs; // 0..2
  const x = phase <= 1 ? phase : 2 - phase; // 0→1→0 (dir: alternate)
  return easeInOutSine(x) * amplitude;
}

export class NavigationArrow {
  /** @type {Required<Omit<ArrowOptions, 'createLabel' | 'updateLabel' | 'document' | 'getComputedStyle'>> & ArrowOptions} */
  #opts;
  #root = new Group();
  #model = null;
  #label = null;
  #pose = null;
  #target = null;
  #distance = null;
  #ready;
  #disposed = false;
  #materials = [];

  /** @param {ArrowOptions} options */
  constructor(options) {
    if (!options?.parent || typeof options.parent.add !== 'function') {
      throw new TypeError('NavigationArrow requires a parent Object3D');
    }
    this.#opts = {
      modelUrl: '/models/arrow-model.glb',
      loadModel: defaultLoadModel,
      distanceAhead: 2,
      height: 1.2,
      bobAmplitude: 0.15,
      bobPeriodMs: 1000,
      scale: 0.5,
      ...options,
    };
    this.#root.name = 'navigation-arrow';
    this.#root.visible = false;
    this.#opts.parent.add(this.#root);
    this.#ready = this.#load();
  }

  /** Resolves once the model is loaded (or failed to load — see `model`). */
  get ready() {
    return this.#ready;
  }

  /** The loaded model, or null. */
  get model() {
    return this.#model;
  }

  /** The three.js group containing arrow and label. */
  get object() {
    return this.#root;
  }

  get visible() {
    return this.#root.visible;
  }

  async #load() {
    let model;
    try {
      model = await this.#opts.loadModel(this.#opts.modelUrl);
    } catch (err) {
      // Fall back to a plain placeholder so navigation still shows direction.
      model = new Object3D();
      model.name = 'arrow-placeholder';
      model.userData.loadError = err;
    }
    if (this.#disposed) return;
    model.scale.setScalar(this.#opts.scale);
    model.name = model.name || 'arrow-model';
    this.#model = model;
    this.#root.add(model);
    this.#collectMaterials(model);
    this.refreshColors();

    this.#label = this.#opts.createLabel
      ? this.#opts.createLabel('')
      : makeTextSprite(' ', { document: this.#opts.document });
    if (this.#label) {
      this.#label.position.set(0, 0.5, 0);
      this.#root.add(this.#label);
    }
    this.#applyDistanceLabel();
  }

  #collectMaterials(model) {
    this.#materials = [];
    model.traverse?.((child) => {
      if (!child.isMesh) return;
      // Replace whatever the GLB shipped with by a token-coloured unlit material.
      child.material = new MeshBasicMaterial();
      this.#materials.push(child.material);
    });
  }

  /** Re-read `--color-arrow` and apply it (after theme / contrast changes). */
  refreshColors() {
    const color = cssToken('--color-arrow', {
      fallback: 'white',
      getComputedStyle: this.#opts.getComputedStyle,
    });
    for (const m of this.#materials) m.color.set(color);
  }

  /**
   * Set the user's pose. The arrow floats `distanceAhead` metres in front.
   * @param {Pose} pose
   */
  setPose(pose) {
    this.#pose = pose;
    this.#updateVisibility();
  }

  /**
   * Set the point to aim at (venue coordinates), with the distance to show.
   * Pass null to hide the arrow.
   * @param {{ x: number, y: number, z?: number } | null} target
   * @param {number | null} [distanceMetres]
   */
  setTarget(target, distanceMetres = null) {
    this.#target = target;
    this.#distance = distanceMetres;
    this.#applyDistanceLabel();
    this.#updateVisibility();
  }

  #applyDistanceLabel() {
    if (!this.#label) return;
    const text =
      this.#distance === null ? ' ' : t('arrow.distance', { metres: formatMetres(this.#distance) });
    if (this.#opts.updateLabel) this.#opts.updateLabel(this.#label, text);
    else updateTextSprite(this.#label, text);
  }

  #updateVisibility() {
    this.#root.visible = Boolean(this.#pose && this.#target && this.#model);
  }

  /**
   * Per-frame: place the arrow ahead of the user, bob it, and point it at the
   * target.
   * @param {number} timeMs
   */
  update(timeMs) {
    if (!this.#root.visible) return;
    const pose = this.#pose;
    const target = this.#target;

    // Direction from user to target, in the floor plane (venue frame).
    let dx = target.x - pose.x;
    let dy = target.y - pose.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      dx = Math.sin(pose.heading * (Math.PI / 180));
      dy = Math.cos(pose.heading * (Math.PI / 180));
    } else {
      dx /= len;
      dy /= len;
    }
    const ahead = Math.min(this.#opts.distanceAhead, Math.max(0.5, len));
    const base = venueToScene({
      x: pose.x + dx * ahead,
      y: pose.y + dy * ahead,
      z: (pose.z ?? 0) + this.#opts.height,
    });
    base.y += bobOffset(timeMs, this.#opts.bobAmplitude, this.#opts.bobPeriodMs);
    this.#root.position.copy(base);

    // Look-at: aim the model at the target (same height, so it stays level).
    const aim = venueToScene({ x: target.x, y: target.y, z: (pose.z ?? 0) + this.#opts.height });
    aim.y += bobOffset(timeMs, this.#opts.bobAmplitude, this.#opts.bobPeriodMs);
    this.#model.lookAt(aim);
  }

  /** World-space position of the arrow (for tests and debug). */
  get position() {
    return this.#root.position.clone();
  }

  /** Direction the model is facing, in world space. */
  get direction() {
    const d = new Vector3();
    this.#model?.getWorldDirection(d);
    return d;
  }

  dispose() {
    this.#disposed = true;
    this.#root.removeFromParent();
    for (const m of this.#materials) m.dispose();
    this.#materials = [];
    this.#label?.material?.map?.dispose?.();
    this.#label?.material?.dispose?.();
    this.#model?.traverse?.((c) => c.geometry?.dispose?.());
  }
}

/** Default loader: three's GLTFLoader, imported lazily (it is large). */
async function defaultLoadModel(url) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  return gltf.scene;
}
