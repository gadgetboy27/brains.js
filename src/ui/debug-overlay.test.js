// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PositionProvider } from '../core/positioning.js';
import { createVenue } from '../core/venue.js';
import { createProviderChain } from '../providers/index.js';
import sample from '../venues/fixtures/sample-venue.json';
import { createDebugOverlay } from './debug-overlay.js';

const pose = (overrides = {}) => ({
  x: 1.234,
  y: -5.6,
  z: 0.5,
  floor: 1,
  heading: 271.6,
  confidence: 0.8,
  timestamp: Date.now(),
  ...overrides,
});

class Bare extends PositionProvider {
  static uploads = [];
  status = 'idle';
  #statusListeners = new Set();
  async start() {
    this.status = 'scanning';
  }
  async stop() {
    this.status = 'idle';
  }
  onStatus(l) {
    this.#statusListeners.add(l);
    return () => this.#statusListeners.delete(l);
  }
  report(status) {
    this.status = status;
    for (const l of this.#statusListeners) l({ status });
  }
  emit(p) {
    this.emitPose(p);
  }
}

const text = (overlay, field) => overlay.el.querySelector(`[data-f="${field}"]`).textContent.trim();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createDebugOverlay — basics', () => {
  it('requires a provider and a document', () => {
    expect(() => createDebugOverlay({})).toThrow(/requires a PositionProvider/);
    expect(() => createDebugOverlay({ provider: new Bare(), document: null })).toThrow(/document/);
  });

  it('mounts into document.body with a single shared stylesheet', () => {
    const a = createDebugOverlay({ provider: new Bare() });
    const b = createDebugOverlay({ provider: new Bare() });
    expect(document.body.querySelectorAll('.bdo')).toHaveLength(2);
    expect(document.head.querySelectorAll('style#brains-debug-overlay-style')).toHaveLength(1);
    expect(a.el.getAttribute('role')).toBe('status');
    a.destroy();
    b.destroy();
    expect(document.body.querySelectorAll('.bdo')).toHaveLength(0);
  });

  it('shows placeholders before any pose', () => {
    const overlay = createDebugOverlay({ provider: new Bare() });
    expect(text(overlay, 'provider')).toBe('Bare');
    expect(text(overlay, 'status')).toBe('idle');
    expect(text(overlay, 'confidence')).toBe('—');
    expect(text(overlay, 'xyz')).toBe('—');
    expect(text(overlay, 'age')).toBe('—');
    expect(overlay.el.querySelector('[data-f="bar"]').className).toBe('bar none');
    overlay.destroy();
  });
});

describe('createDebugOverlay — pose and status', () => {
  it('renders each pose: coordinates, floor, heading, confidence bar', () => {
    const provider = new Bare();
    const overlay = createDebugOverlay({ provider });
    provider.emit(pose());

    expect(text(overlay, 'xyz')).toBe('1.23 / -5.60 / 0.50');
    expect(text(overlay, 'floor')).toBe('1');
    expect(text(overlay, 'heading')).toBe('272°');
    expect(text(overlay, 'confidence')).toBe('0.80');
    const bar = overlay.el.querySelector('[data-f="bar"]');
    expect(bar.firstElementChild.style.width).toBe('80%');
    expect(bar.className).toBe('bar');

    provider.emit(pose({ confidence: 0.1 }));
    expect(bar.className).toBe('bar low');
    expect(bar.firstElementChild.style.width).toBe('10%');
    overlay.destroy();
  });

  it('tracks pose age on a timer', () => {
    const provider = new Bare();
    const overlay = createDebugOverlay({ provider, refreshMs: 250 });
    provider.emit(pose());
    expect(text(overlay, 'age')).toBe('0.0 s');
    vi.advanceTimersByTime(2600);
    expect(text(overlay, 'age')).toBe('2.5 s');
    overlay.destroy();
  });

  it('reflects provider status changes with a colour class', async () => {
    const provider = new Bare();
    const overlay = createDebugOverlay({ provider });
    const statusEl = overlay.el.querySelector('[data-f="status"]');
    expect(statusEl.className).toBe('status-wait');

    await provider.start();
    provider.report('scanning');
    expect(text(overlay, 'status')).toBe('scanning');
    expect(statusEl.className).toBe('status-ok');

    provider.report('permission-denied');
    expect(text(overlay, 'status')).toBe('permission-denied');
    expect(statusEl.className).toBe('status-bad');
    overlay.destroy();
  });

  it('hide / show / toggle and the hide button', () => {
    const overlay = createDebugOverlay({ provider: new Bare() });
    expect(overlay.el.hidden).toBe(false);
    overlay.hide();
    expect(overlay.el.hidden).toBe(true);
    overlay.show();
    expect(overlay.el.hidden).toBe(false);
    overlay.toggle();
    expect(overlay.el.hidden).toBe(true);
    overlay.show();
    overlay.el.querySelector('[data-f="hide"]').click();
    expect(overlay.el.hidden).toBe(true);
    overlay.destroy();
  });

  it('destroy() unsubscribes and clears the timer', () => {
    const provider = new Bare();
    const overlay = createDebugOverlay({ provider });
    overlay.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(() => provider.emit(pose())).not.toThrow();
    expect(document.body.contains(overlay.el)).toBe(false);
  });
});

describe('createDebugOverlay — with a ProviderChain', () => {
  const venue = () => createVenue(structuredClone(sample));

  it('shows the active provider, the chain order and fallback reasons', async () => {
    const denied = new Error('no');
    denied.name = 'NotAllowedError';
    const chain = createProviderChain(venue(), {
      order: ['qr', 'mock'],
      allowMock: true,
      qr: { getUserMedia: async () => Promise.reject(denied), BarcodeDetector: class {} },
      mock: { path: [{ x: 3, y: 4, floor: 0 }], fixIntervalMs: 500 },
    });
    const overlay = createDebugOverlay({ provider: chain });
    expect(text(overlay, 'chain')).toBe('qr → mock');
    expect(text(overlay, 'status')).toBe('idle');

    await chain.start();

    expect(text(overlay, 'provider')).toBe('mock');
    expect(text(overlay, 'chain')).toBe('qr → [mock]');
    expect(text(overlay, 'status')).toBe('running');
    const failed = overlay.el.querySelector('[data-f="failed"]');
    expect(failed.hidden).toBe(false);
    expect(failed.textContent).toContain('qr: permission-denied');
    expect(text(overlay, 'xyz')).toBe('3.00 / 4.00 / 0.00');

    await chain.stop();
    expect(text(overlay, 'status')).toBe('idle');
    expect(failed.hidden).toBe(true);
    overlay.destroy();
  });

  it('shows exhausted when every provider fails', async () => {
    const denied = new Error('no');
    denied.name = 'NotAllowedError';
    const chain = createProviderChain(venue(), {
      order: ['qr'],
      qr: { getUserMedia: async () => Promise.reject(denied), BarcodeDetector: class {} },
    });
    const overlay = createDebugOverlay({ provider: chain });
    await chain.start();
    expect(text(overlay, 'status')).toBe('exhausted');
    expect(overlay.el.querySelector('[data-f="status"]').className).toBe('status-bad');
    expect(text(overlay, 'provider')).toBe('—');
    overlay.destroy();
  });
});

describe('createDebugOverlay — fusion and rescan', () => {
  it('shows fusion confidence and drift, and the rescan banner', () => {
    const rescanListeners = new Set();
    const fusion = {
      getPose: vi.fn(() => pose({ confidence: 0.42 })),
      distanceSinceFix: 1.5,
    };
    const provider = new Bare();
    provider.fusion = fusion;
    provider.onRescanNeeded = (l) => {
      rescanListeners.add(l);
      return () => rescanListeners.delete(l);
    };
    const overlay = createDebugOverlay({ provider });

    expect(text(overlay, 'confidence')).toBe('0.42');
    expect(text(overlay, 'drift')).toBe('1.50 m since fix');
    const banner = overlay.el.querySelector('[data-f="rescan"]');
    expect(banner.hidden).toBe(true);

    for (const l of rescanListeners) l({ confidence: 0.2 });
    expect(banner.hidden).toBe(false);

    provider.emit(pose()); // a fresh fix clears it
    expect(banner.hidden).toBe(true);
    overlay.destroy();
  });
});
