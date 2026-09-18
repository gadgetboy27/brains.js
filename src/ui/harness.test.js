// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PositionProvider } from '../core/positioning.js';
import { createVenue } from '../core/venue.js';
import demo from '../venues/demo-venue.json';
import { createHarness } from './harness.js';
import { t } from './strings/index.js';

class Fake extends PositionProvider {
  static uploads = [];
  #rescan = new Set();
  async start() {}
  async stop() {}
  emit(p) {
    this.emitPose(p);
  }
  onRescanNeeded(l) {
    this.#rescan.add(l);
    return () => this.#rescan.delete(l);
  }
  rescan() {
    for (const l of this.#rescan) l({});
  }
}
const pose = (x, y, confidence = 0.9, floor = 0) => ({
  x,
  y,
  z: 0,
  floor,
  heading: 0,
  confidence,
  timestamp: 0,
});

let now;
beforeEach(() => {
  now = 10_000;
  document.body.innerHTML = '';
});
afterEach(() => vi.restoreAllMocks());

function make(options = {}) {
  const provider = new Fake();
  const download = vi.fn();
  const harness = createHarness({
    venue: createVenue(structuredClone(demo)),
    provider,
    providerName: 'fake',
    now: () => now,
    download,
    ...options,
  });
  return { harness, provider, download };
}

describe('Harness', () => {
  it('offers anchors and named nodes as checkpoints', () => {
    const { harness } = make();
    const ids = harness.checkpoints().map((c) => c.id);
    expect(ids.slice(0, 3)).toEqual(['anchor:a-entrance', 'anchor:a-lift-g', 'anchor:a-lift-1']);
    expect(ids).toContain('node:n-clinic-b');
    const buttons = [...harness.el.querySelectorAll('[data-checkpoint]')];
    expect(buttons).toHaveLength(ids.length);
    expect(buttons[3].textContent).toBe(t('harness.here', { name: 'Main entrance' }));
  });

  it('records poses, checkpoints and rescans, and reports on them', () => {
    const { harness, provider } = make();
    provider.emit(pose(0.5, 0.5));
    now += 100;
    harness.el.querySelector('[data-checkpoint="node:n-entrance"]').click(); // truth (0,0): ~0.71 m off
    expect(harness.el.querySelector('[data-f="status"]').textContent).toBe(
      t('harness.recorded', { name: 'Main entrance', count: 1 })
    );
    now += 5000;
    provider.rescan();
    expect(harness.el.querySelector('[data-f="status"]').textContent).toBe(t('harness.rescan'));
    now += 1500;
    provider.emit(pose(0, 6));
    harness.mark('node:n-lobby');

    const r = harness.showReport();
    expect(r.position.checkpoints).toBe(2);
    expect(r.position.meanErrorM).toBeCloseTo(0.35, 2);
    expect(r.position.worstCheckpoint).toBe('node:n-entrance');
    expect(r.fixes.requests).toBe(2); // start + rescan
    expect(r.fixes.details[1]).toMatchObject({ reason: 'rescan', latencyMs: 1500, failed: false });
    expect(harness.el.querySelector('[data-f="out"]').hidden).toBe(false);
    expect(harness.el.querySelector('[data-f="out"]').textContent).toContain(
      '# Positioning accuracy report'
    );
    expect(harness.el.querySelector('[data-f="status"]').textContent).toMatch(
      /^Mean error 0\.35 m, worst 0\.71 m, failed fixes 0 %/
    );
  });

  it('downloads the log as JSON and resets', () => {
    const { harness, provider, download } = make();
    provider.emit(pose(1, 1));
    const name = harness.download();
    expect(name).toMatch(/^accuracy-demo-health-centre-.*\.json$/);
    const [, text] = download.mock.calls[0];
    const log = JSON.parse(text);
    expect(log).toMatchObject({ version: 1, venueId: 'demo-health-centre', provider: 'fake' });
    expect(log.events.map((e) => e.type)).toEqual(['fix-request', 'pose']);

    harness.reset();
    expect(harness.log.events.map((e) => e.type)).toEqual(['fix-request']);
    expect(harness.el.querySelector('[data-f="out"]').hidden).toBe(true);
  });

  it('records chain transitions as fix requests and follows the active provider for rescans', () => {
    const active = new Fake();
    const listeners = new Set();
    const chain = {
      onPose: vi.fn(() => () => {}),
      onChange: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      state: { provider: null },
      active: null,
    };
    const harness = createHarness({
      venue: createVenue(structuredClone(demo)),
      provider: chain,
      now: () => now,
      download: vi.fn(),
    });
    for (const l of listeners)
      l({ type: 'fallback', from: 'immersal', to: 'qr', state: { provider: active } });
    active.rescan();
    const types = harness.log.events.map((e) => [e.type, e.reason ?? e.status]);
    expect(types).toEqual([
      ['fix-request', 'start'],
      ['status', 'fallback'],
      ['fix-request', 'fallback'],
      ['fix-request', 'rescan'],
    ]);
    harness.destroy();
    expect(document.querySelector('.harness')).toBeNull();
  });

  it('rejects unknown checkpoints', () => {
    const { harness } = make();
    expect(() => harness.mark('node:nope')).toThrow(RangeError);
  });
});
