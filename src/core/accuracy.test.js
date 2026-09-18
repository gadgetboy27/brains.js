import { describe, expect, it } from 'vitest';

import { analyseLog, createRecorder, formatReport } from './accuracy.js';

const pose = (x, y, confidence = 0.9, floor = 0) => ({
  x,
  y,
  z: 0,
  floor,
  heading: 0,
  confidence,
  timestamp: 0,
});

describe('createRecorder', () => {
  it('timestamps events with the injected clock and serialises a versioned log', () => {
    let t = 1000;
    const rec = createRecorder({ now: () => t, venueId: 'v', provider: 'mock' });
    rec.fixRequest('start');
    t = 1500;
    rec.pose(pose(1, 2));
    t = 2000;
    rec.checkpoint({ id: 'cp1', x: 1, y: 2, floor: 0, note: 'by the lift' });
    rec.status('localising');
    expect(rec.count).toBe(4);
    const log = rec.toJSON();
    expect(log).toMatchObject({
      version: 1,
      venueId: 'v',
      provider: 'mock',
      startedAt: 1000,
      endedAt: 2000,
    });
    expect(log.events.map((e) => [e.t, e.type])).toEqual([
      [1000, 'fix-request'],
      [1500, 'pose'],
      [2000, 'checkpoint'],
      [2000, 'status'],
    ]);
    expect(log.events[2]).toMatchObject({
      id: 'cp1',
      x: 1,
      y: 2,
      z: 0,
      floor: 0,
      note: 'by the lift',
    });
  });
});

describe('analyseLog', () => {
  it('rejects other shapes', () => {
    expect(() => analyseLog({ version: 2, events: [] })).toThrow(TypeError);
  });

  it('computes position error per checkpoint and the summary statistics', () => {
    const log = {
      version: 1,
      startedAt: 0,
      events: [
        { t: 0, type: 'fix-request', reason: 'start' },
        { t: 1000, type: 'pose', pose: pose(0, 0) },
        { t: 1100, type: 'checkpoint', id: 'a', x: 3, y: 4, floor: 0 }, // 5 m off
        { t: 2000, type: 'pose', pose: pose(10, 0) },
        { t: 2100, type: 'checkpoint', id: 'b', x: 10, y: 1, floor: 0 }, // 1 m off
        { t: 3000, type: 'pose', pose: pose(20, 0, 0.9, 1) },
        { t: 3100, type: 'checkpoint', id: 'c', x: 20, y: 0, floor: 0 }, // exact, wrong floor
        { t: 9000, type: 'checkpoint', id: 'd', x: 0, y: 0, floor: 0 }, // stale estimate (6 s old)
      ],
    };
    const r = analyseLog(log);
    expect(r.position).toMatchObject({
      checkpoints: 4,
      measured: 3,
      noEstimate: 1,
      meanErrorM: 2,
      medianErrorM: 1,
      p95ErrorM: 5,
      worstErrorM: 5,
      worstCheckpoint: 'a',
      wrongFloor: 1,
    });
    expect(r.position.details[0]).toMatchObject({
      id: 'a',
      error: 5,
      floorCorrect: true,
      poseAgeMs: 100,
    });
    expect(r.position.details[2]).toMatchObject({ id: 'c', error: 0, floorCorrect: false });
    expect(r.position.details[3]).toMatchObject({
      id: 'd',
      error: null,
      floorCorrect: null,
      poseAgeMs: 6000,
    });
    expect(r.poses).toMatchObject({ count: 3, durationMs: 2000, perSecond: 1 });
  });

  it('measures fix latency and the failed-fix rate', () => {
    const log = {
      version: 1,
      startedAt: 0,
      events: [
        { t: 0, type: 'fix-request', reason: 'start' },
        { t: 500, type: 'pose', pose: pose(0, 0, 0.2) }, // dead reckoning, not a fix
        { t: 1500, type: 'pose', pose: pose(0, 0, 0.9) }, // fix after 1.5 s
        { t: 10000, type: 'fix-request', reason: 'rescan' },
        { t: 10400, type: 'pose', pose: pose(0, 0, 0.9) }, // 0.4 s
        { t: 20000, type: 'fix-request', reason: 'rescan' },
        { t: 45000, type: 'pose', pose: pose(0, 0, 0.9) }, // 25 s: too late
        { t: 50000, type: 'fix-request', reason: 'rescan' }, // never fixed
      ],
    };
    const r = analyseLog(log, { fixTimeoutMs: 20_000 });
    expect(r.fixes).toMatchObject({
      requests: 4,
      succeeded: 2,
      failed: 2,
      failedRate: 0.5,
      meanLatencyMs: 950,
      medianLatencyMs: 400,
      maxLatencyMs: 1500,
    });
    expect(r.fixes.details.map((f) => f.failed)).toEqual([false, false, true, true]);
  });

  it('handles an empty walk', () => {
    const r = analyseLog({ version: 1, startedAt: 0, events: [] });
    expect(r.position.meanErrorM).toBeNull();
    expect(r.fixes.failedRate).toBeNull();
    expect(r.poses.count).toBe(0);
  });
});

describe('formatReport', () => {
  it('renders the key numbers in Markdown', () => {
    const log = {
      version: 1,
      venueId: 'demo',
      provider: 'immersal',
      startedAt: 0,
      events: [
        { t: 0, type: 'fix-request', reason: 'start' },
        { t: 1000, type: 'pose', pose: pose(0, 0) },
        { t: 1100, type: 'checkpoint', id: 'a', x: 3, y: 4, floor: 0, note: 'lift lobby' },
      ],
    };
    const text = formatReport(analyseLog(log));
    expect(text).toContain('# Positioning accuracy report');
    expect(text).toContain('Venue: demo  ·  Provider: immersal');
    expect(text).toContain('| 5 m | 5 m | 5 m | 5 m (a) | 0 | 0 |');
    expect(text).toContain('| a — lift lobby | 5 m | yes | 0.9 | 100 ms |');
    expect(text).toContain('| 1 | 0 | 0 % | 1000 ms | 1000 ms | 1000 ms |');
  });
});
