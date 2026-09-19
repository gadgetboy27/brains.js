// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Scene, Vector3 } from 'three';

import { NavigationArrow, bobOffset, easeInOutSine } from './arrow.js';

const pose = (x, y, heading = 0) => ({
  x,
  y,
  z: 0,
  floor: 0,
  heading,
  confidence: 1,
  timestamp: 1,
});

/** A fake GLB: a group with one mesh, as GLTFLoader would return. */
function fakeModel() {
  const g = new Group();
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  g.add(mesh);
  return g;
}

const fakeLabel = () => {
  const o = new Object3D();
  o.name = 'label:';
  return o;
};

function make(options = {}) {
  const parent = new Scene();
  const style = {
    getPropertyValue: vi.fn((name) => (name === '--color-arrow' ? ' rgb(255, 0, 0) ' : '')),
  };
  const arrow = new NavigationArrow({
    parent,
    loadModel: vi.fn(async () => fakeModel()),
    createLabel: fakeLabel,
    updateLabel: vi.fn((label, text) => {
      label.name = `label:${text}`;
      return true;
    }),
    getComputedStyle: () => style,
    ...options,
  });
  return { arrow, parent, style };
}

describe('bob animation (ported from legacy)', () => {
  it('easeInOutSine hits 0, 0.5, 1', () => {
    expect(easeInOutSine(0)).toBeCloseTo(0, 12);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOutSine(1)).toBeCloseTo(1, 12);
  });

  it('alternates up and down over the period, eased', () => {
    expect(bobOffset(0, 0.15, 1000)).toBeCloseTo(0, 12);
    expect(bobOffset(500, 0.15, 1000)).toBeCloseTo(0.075, 12);
    expect(bobOffset(1000, 0.15, 1000)).toBeCloseTo(0.15, 12); // top
    expect(bobOffset(1500, 0.15, 1000)).toBeCloseTo(0.075, 12); // coming back down
    expect(bobOffset(2000, 0.15, 1000)).toBeCloseTo(0, 12); // loop
    expect(bobOffset(2250, 0.15, 1000)).toBeCloseTo(easeInOutSine(0.25) * 0.15, 12);
  });

  it('is zero with no amplitude or period', () => {
    expect(bobOffset(700, 0, 1000)).toBe(0);
    expect(bobOffset(700, 0.15, 0)).toBe(0);
  });
});

describe('NavigationArrow', () => {
  it('requires a parent', () => {
    expect(() => new NavigationArrow({})).toThrow(/requires a parent/);
  });

  it('loads the model, colours it from the CSS token and hides until it has a pose and target', async () => {
    const { arrow, parent, style } = make();
    expect(parent.getObjectByName('navigation-arrow')).toBe(arrow.object);
    expect(arrow.visible).toBe(false);
    await arrow.ready;
    expect(arrow.model).not.toBeNull();
    expect(style.getPropertyValue).toHaveBeenCalledWith('--color-arrow');
    const mesh = arrow.model.children[0];
    expect(mesh.material.type).toBe('MeshStandardMaterial'); // GLB material replaced, lit
    expect(mesh.material.color.getHexString()).toBe('ff0000');
    expect(mesh.material.emissive.getHexString()).toBe('ff0000');
    expect(arrow.model.scale.x).toBe(0.5);

    arrow.setPose(pose(0, 0));
    expect(arrow.visible).toBe(false);
    arrow.setTarget({ x: 0, y: 10 }, 10);
    expect(arrow.visible).toBe(true);
    arrow.setTarget(null);
    expect(arrow.visible).toBe(false);
  });

  it('refreshColors() re-reads the token (high-contrast toggle)', async () => {
    const { arrow, style } = make();
    await arrow.ready;
    style.getPropertyValue.mockImplementation(() => '#ffff00');
    arrow.refreshColors();
    expect(arrow.model.children[0].material.color.getHexString()).toBe('ffff00');
  });

  it('falls back to a placeholder when the model fails to load', async () => {
    const { arrow } = make({ loadModel: vi.fn(async () => Promise.reject(new Error('404'))) });
    await arrow.ready;
    expect(arrow.model.name).toBe('arrow-placeholder');
    expect(arrow.model.userData.loadError.message).toBe('404');
    arrow.setPose(pose(0, 0));
    arrow.setTarget({ x: 1, y: 1 }, 1);
    expect(arrow.visible).toBe(true); // still usable
  });

  it('floats ahead of the user towards the target and looks at it', async () => {
    const { arrow } = make({ distanceAhead: 2, height: 1.2, bobAmplitude: 0 });
    await arrow.ready;
    arrow.setPose(pose(0, 0, 0));
    arrow.setTarget({ x: 10, y: 0 }, 10); // target due +x (venue)
    arrow.update(0);

    // 2 m ahead along +x at 1.2 m up → scene (2, 1.2, 0)
    expect(arrow.position.x).toBeCloseTo(2, 9);
    expect(arrow.position.y).toBeCloseTo(1.2, 9);
    expect(arrow.position.z).toBeCloseTo(0, 9);

    // Model faces +x in scene space (venue +x).
    const dir = arrow.direction;
    expect(dir.x).toBeCloseTo(1, 6);
    expect(dir.y).toBeCloseTo(0, 6);
    expect(dir.z).toBeCloseTo(0, 6);
  });

  it('points along venue +y as scene −z', async () => {
    const { arrow } = make({ bobAmplitude: 0 });
    await arrow.ready;
    arrow.setPose(pose(5, 5));
    arrow.setTarget({ x: 5, y: 20 }, 15);
    arrow.update(0);
    expect(arrow.direction.z).toBeCloseTo(-1, 6);
    expect(arrow.position.z).toBeCloseTo(-7, 9); // y = 5 + 2 ahead
  });

  it('bobs vertically over time', async () => {
    const { arrow } = make({ bobAmplitude: 0.2, bobPeriodMs: 1000, height: 1 });
    await arrow.ready;
    arrow.setPose(pose(0, 0));
    arrow.setTarget({ x: 0, y: 10 }, 10);
    arrow.update(0);
    const y0 = arrow.position.y;
    arrow.update(1000);
    expect(arrow.position.y - y0).toBeCloseTo(0.2, 9);
    arrow.update(2000);
    expect(arrow.position.y).toBeCloseTo(y0, 9);
    // Still level: looking at a point bobbing with it.
    expect(Math.abs(arrow.direction.y)).toBeLessThan(1e-6);
  });

  it('comes no closer than the target itself, and uses the heading when on top of it', async () => {
    const { arrow } = make({ distanceAhead: 2, bobAmplitude: 0 });
    await arrow.ready;
    arrow.setPose(pose(0, 0));
    arrow.setTarget({ x: 1, y: 0 }, 1);
    arrow.update(0);
    expect(arrow.position.x).toBeCloseTo(1, 9); // clamped to the target distance
    arrow.setPose(pose(1, 0, 90)); // on the target, facing +x
    arrow.update(0);
    expect(arrow.position.x).toBeCloseTo(1.5, 9); // min 0.5 m ahead along heading
  });

  it('updates the distance label through the strings module', async () => {
    const updateLabel = vi.fn(() => true);
    const { arrow } = make({ updateLabel });
    await arrow.ready;
    arrow.setTarget({ x: 0, y: 0 }, 12.6);
    expect(updateLabel).toHaveBeenLastCalledWith(expect.anything(), '13 m');
    arrow.setTarget({ x: 0, y: 0 }, 0.2);
    expect(updateLabel).toHaveBeenLastCalledWith(expect.anything(), '0 m');
  });

  it('dispose() removes it from the parent and releases materials', async () => {
    const { arrow, parent } = make();
    await arrow.ready;
    const material = arrow.model.children[0].material;
    const spy = vi.spyOn(material, 'dispose');
    arrow.dispose();
    expect(parent.getObjectByName('navigation-arrow')).toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });

  it('ignores a model that resolves after dispose()', async () => {
    let resolve;
    const loadModel = () => new Promise((r) => (resolve = r));
    const { arrow, parent } = make({ loadModel });
    arrow.dispose();
    resolve(fakeModel());
    await arrow.ready;
    expect(arrow.model).toBeNull();
    expect(parent.children).toHaveLength(0);
  });

  it('exposes a Vector3 position copy', async () => {
    const { arrow } = make();
    await arrow.ready;
    expect(arrow.position).toBeInstanceOf(Vector3);
  });
});
