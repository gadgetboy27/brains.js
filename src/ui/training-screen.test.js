// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrainingScreen } from './training-screen.js';
import { t } from './strings/index.js';

/** A wizard stand-in: the screen only uses this small surface. */
function fakeWizard() {
  const listeners = new Set();
  const w = {
    step: 'start',
    uncertain: false,
    route: null,
    chain: true,
    scanHere: vi.fn(),
    startHere: vi.fn(),
    stopHere: vi.fn(),
    nextFromHere: vi.fn(),
    reset: vi.fn(),
    rewalk: vi.fn(),
    setChain: (on) => (w.chain = on),
    onStep: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    go(step) {
      w.step = step;
      for (const l of listeners) l(step);
    },
    listenerCount: () => listeners.size,
  };
  return w;
}

/** A step source like the app's: counts up, and drops to 0 at every exact fix. */
function stepSource() {
  let n = 0;
  const subs = new Set();
  return {
    get: () => n,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    step(k = 1) {
      for (let i = 0; i < k; i += 1) {
        n += 1;
        for (const s of subs) s(n);
      }
    },
    scan() {
      n = 0;
      for (const s of subs) s(0);
    },
  };
}

function make(overrides = {}) {
  const wizard = fakeWizard();
  const steps = stepSource();
  let nowMs = 1_000_000;
  const timers = new Map();
  let id = 0;
  const sentinel = { release: vi.fn(async () => {}), addEventListener: vi.fn() };
  const wakeLock = { request: vi.fn(async () => sentinel) };
  const vibrate = vi.fn();
  const screen = createTrainingScreen({
    wizard,
    steps,
    mount: document.body,
    document,
    now: () => nowMs,
    vibrate,
    wakeLock,
    setInterval: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clearInterval: (i) => timers.delete(i),
    getPose: () => null,
    ...overrides,
  });
  const f = (n) => screen.el.querySelector(`[data-f="${n}"]`);
  const advance = (ms) => {
    nowMs += ms;
    for (const fn of timers.values()) fn();
  };
  return { screen, wizard, steps, f, advance, wakeLock, sentinel, vibrate, timers };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('TrainingScreen', () => {
  it('is hidden until opened, then shows only a counter, one button and a status line', () => {
    const { screen, f, wizard } = make();
    expect(screen.el.hidden).toBe(true);
    screen.open();
    expect(screen.el.hidden).toBe(false);
    expect(wizard.chain).toBe(false); // STOP ends a route rather than chaining on
    expect(f('count').textContent).toBe('0');
    expect(f('main').textContent).toBe(t('train.start'));
    expect(f('banner').textContent).toBe(t('train.banner.idle'));
    expect(f('result').hidden).toBe(true);
    expect(f('alt').hidden).toBe(true); // no position yet: nothing to "start here" at
  });

  it('START HERE opens the camera; with a position it also offers starting without a scan', () => {
    const { screen, f, wizard } = make({ getPose: () => ({ x: 0, y: 0 }) });
    screen.open();
    f('main').click();
    expect(wizard.scanHere).toHaveBeenCalledTimes(1);
    expect(f('alt').hidden).toBe(false);
    f('alt').click();
    expect(wizard.startHere).toHaveBeenCalledTimes(1);
  });

  it('counts steps live, ticks and buzzes on each, and resets for a new route', () => {
    const { screen, f, steps, vibrate, wizard } = make();
    screen.open();
    steps.step(3);
    expect(f('count').textContent).toBe('3'); // idle: shown dim, so "is it alive" can be checked
    wizard.go('walk');
    expect(screen.mode).toBe('recording');
    expect(f('count').textContent).toBe('0');
    expect(screen.el.dataset.mode).toBe('recording');
    expect(f('main').textContent).toBe(t('train.stop'));
    vibrate.mockClear();
    steps.step(5);
    expect(f('count').textContent).toBe('5');
    expect(f('count').classList.contains('tick')).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(5);
  });

  it('keeps counting through the drop to zero at an intermediate scan', () => {
    const { screen, f, steps, wizard } = make();
    screen.open();
    wizard.go('walk');
    steps.step(10);
    steps.scan(); // an exact fix resets the source's own count
    steps.step(4);
    expect(f('count').textContent).toBe('14');
    expect(screen.steps).toBe(14);
  });

  it('shows distance from steps and the points saved so far', () => {
    const { screen, f, steps, wizard } = make({ getStrideM: () => 0.5 });
    screen.open();
    wizard.go('walk');
    wizard.route = { nodes: 4, distance: 9, scans: 1, edges: [] };
    steps.step(20);
    expect(f('sub').textContent).toBe(t('train.sub', { metres: 10, points: 4 }));
  });

  it('warns when no step arrives, when the position is uncertain, and when paused', () => {
    const { screen, f, steps, wizard, advance } = make();
    screen.open();
    wizard.go('walk');
    advance(5000);
    expect(f('banner').textContent).toBe(t('train.banner.tracking'));
    advance(6000);
    expect(f('banner').textContent).toBe(t('train.banner.noSteps'));
    expect(screen.el.dataset.warn).toBe('true');

    steps.step(2);
    expect(f('banner').textContent).toBe(t('train.banner.tracking'));
    expect(screen.el.dataset.warn).toBe('false');
    advance(7000);
    expect(f('banner').textContent).toBe(t('train.banner.paused'));

    wizard.uncertain = true;
    screen.onPose({});
    expect(f('banner').textContent).toBe(t('train.banner.uncertain'));
    expect(screen.el.dataset.warn).toBe('true');
  });

  it('says so plainly when the device has no step counting', () => {
    const { screen, f } = make({ steps: null });
    screen.open();
    expect(f('count').textContent).toBe('–');
    expect(f('banner').textContent).toBe(t('train.banner.noSensor'));
  });

  it('STOP HERE scans; "stop at my position" ends without one', () => {
    const { screen, f, wizard } = make();
    screen.open();
    wizard.go('walk');
    f('main').click();
    expect(wizard.scanHere).toHaveBeenCalled();
    f('alt').click();
    expect(wizard.stopHere).toHaveBeenCalledTimes(1);
  });

  it('after a route is saved, shows the result and offers walking on or finishing', () => {
    const { screen, f, steps, wizard } = make();
    screen.open();
    wizard.go('walk');
    wizard.route = { nodes: 5, distance: 41.4, scans: 2, edges: [] };
    steps.step(56);
    wizard.go('done');
    expect(screen.mode).toBe('result');
    expect(f('result').hidden).toBe(false);
    expect(f('main').hidden).toBe(true);
    expect(f('result-text').textContent).toBe(
      t('train.result', { metres: 41, steps: 56, points: 5 })
    );
    steps.step(3); // wandering about with the result up must not change what was saved
    expect(f('count').textContent).toBe('56');
    f('next').click();
    expect(wizard.nextFromHere).toHaveBeenCalled();
    f('done').click();
    expect(wizard.reset).toHaveBeenCalled();
    wizard.go('start');
    expect(screen.mode).toBe('idle');
  });

  it('keeps the screen awake while open and lets go when closed', async () => {
    const { screen, wakeLock, sentinel, wizard } = make();
    screen.open();
    await Promise.resolve();
    expect(wakeLock.request).toHaveBeenCalledWith('screen');
    const onExit = vi.fn();
    screen.close();
    await Promise.resolve();
    expect(sentinel.release).toHaveBeenCalled();
    expect(wizard.chain).toBe(true); // normal chaining comes back
    expect(onExit).not.toHaveBeenCalled();
  });

  it('still works when the wake lock is refused or missing', async () => {
    const refused = { request: vi.fn(async () => Promise.reject(new Error('denied'))) };
    const a = make({ wakeLock: refused });
    a.screen.open();
    await Promise.resolve();
    expect(a.screen.isOpen).toBe(true);
    const b = make({ wakeLock: null });
    b.screen.open();
    expect(b.screen.isOpen).toBe(true);
  });

  it('Exit closes it, calls onExit, and stops listening', () => {
    const onExit = vi.fn();
    const { screen, f, wizard, steps, timers } = make({ onExit });
    screen.open();
    expect(wizard.listenerCount()).toBe(1);
    f('exit').click();
    expect(screen.isOpen).toBe(false);
    expect(screen.el.hidden).toBe(true);
    expect(onExit).toHaveBeenCalled();
    expect(wizard.listenerCount()).toBe(0);
    expect(timers.size).toBe(0);
    steps.step(3);
    expect(screen.steps).toBe(0);
  });

  describe('quality line on the result', () => {
    function finish(quality) {
      const m = make();
      m.screen.open();
      m.wizard.go('walk');
      m.wizard.route = { nodes: 5, distance: 41, scans: 2, edges: [], quality };
      m.steps.step(56);
      m.wizard.go('done');
      return m;
    }

    it('good: says how small the drift was, no re-walk offered', () => {
      const { f } = finish({ verdict: 'good', driftM: 0.8, legM: 41.3, scale: 1.01 });
      expect(f('quality').textContent).toBe(t('train.quality.good', { drift: 0.8, len: 41 }));
      expect(f('quality').dataset.verdict).toBe('good');
      expect(f('rewalk').hidden).toBe(true);
      expect(f('quality-note').textContent).toBe('');
    });

    it('ok: says it was fixed up', () => {
      const { f } = finish({ verdict: 'ok', driftM: 2.4, legM: 20, corrected: true });
      expect(f('quality').textContent).toBe(t('train.quality.ok', { drift: 2.4, len: 20 }));
      expect(f('rewalk').hidden).toBe(true);
    });

    it('check: warns, offers walking it again, and demotes "walk on"', () => {
      const { f, wizard } = finish({ verdict: 'check', driftM: 8, legM: 18 });
      expect(f('quality').dataset.verdict).toBe('check');
      expect(f('rewalk').hidden).toBe(false);
      expect(f('next').classList.contains('btn-primary')).toBe(false);
      f('rewalk').click();
      expect(wizard.rewalk).toHaveBeenCalled();
    });

    it('unchecked: says there was nothing to compare with', () => {
      const { f } = finish({ verdict: 'unchecked' });
      expect(f('quality').textContent).toBe(t('train.quality.unchecked'));
      expect(f('rewalk').hidden).toBe(true);
    });

    it('points out steps that are consistently short or long', () => {
      expect(
        finish({ verdict: 'ok', driftM: 2, legM: 20, scale: 1.08 }).f('quality-note').textContent
      ).toBe(t('train.quality.short', { pct: 8 }));
      expect(
        finish({ verdict: 'ok', driftM: 2, legM: 20, scale: 0.9 }).f('quality-note').textContent
      ).toBe(t('train.quality.long', { pct: 10 }));
    });

    it('walking it again goes back to counting from zero', () => {
      const { screen, f, wizard } = finish({ verdict: 'check', driftM: 8, legM: 18 });
      wizard.go('walk');
      expect(screen.mode).toBe('recording');
      expect(f('count').textContent).toBe('0');
      expect(f('result').hidden).toBe(true);
    });
  });
});
