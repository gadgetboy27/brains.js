import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PositionProvider, validateProvider } from '../core/positioning.js';
import { MockProvider } from './mock.js';

const pose = (overrides = {}) => ({
  x: 0,
  y: 0,
  z: 0,
  floor: 0,
  heading: 0,
  confidence: 1,
  ...overrides,
});

describe('MockProvider — interface', () => {
  it('is a PositionProvider that passes validateProvider()', () => {
    const p = new MockProvider();
    expect(p).toBeInstanceOf(PositionProvider);
    expect(() => validateProvider(p)).not.toThrow();
  });

  it('declares that nothing leaves the device, on its own class', () => {
    expect(Object.hasOwn(MockProvider, 'uploads')).toBe(true);
    expect(MockProvider.uploads).toEqual([]);
  });

  it('starts idle', () => {
    const p = new MockProvider();
    expect(p.state).toBe('idle');
    expect(p.cursor).toBe(0);
  });
});

describe('MockProvider — construction', () => {
  it('rejects a non-array script', () => {
    expect(() => new MockProvider({ poses: pose() })).toThrow(TypeError);
  });

  it('rejects a negative or non-finite interval', () => {
    expect(() => new MockProvider({ intervalMs: -1 })).toThrow(RangeError);
    expect(() => new MockProvider({ intervalMs: NaN })).toThrow(RangeError);
  });

  it('validates every scripted pose up front and names the bad one', () => {
    expect(() => new MockProvider({ poses: [pose(), pose({ heading: 400 })] })).toThrow(
      /poses\[1\] is invalid: pose\.heading must be in \[0, 360\)/
    );
    expect(() => new MockProvider({ poses: [pose({ lat: 51.5 })] })).toThrow(/poses\[0\].*GPS/);
  });

  it('does not require timestamps in the script', () => {
    expect(() => new MockProvider({ poses: [pose()] })).not.toThrow();
  });
});

describe('MockProvider — scripted playback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits the first pose on start and the rest on the interval', async () => {
    const script = [pose({ x: 1 }), pose({ x: 2 }), pose({ x: 3 })];
    const p = new MockProvider({ poses: script, intervalMs: 500 });
    const seen = [];
    p.onPose((q) => seen.push(q.x));

    await p.start();
    expect(p.state).toBe('running');
    expect(seen).toEqual([1]);

    vi.advanceTimersByTime(499);
    expect(seen).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([1, 2]);
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([1, 2, 3]);

    // Script exhausted, loop off: nothing more, still "running".
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual([1, 2, 3]);
    expect(p.state).toBe('running');
    expect(p.cursor).toBe(3);
  });

  it('loops when asked', async () => {
    const p = new MockProvider({
      poses: [pose({ x: 1 }), pose({ x: 2 })],
      intervalMs: 100,
      loop: true,
    });
    const seen = [];
    p.onPose((q) => seen.push(q.x));

    await p.start();
    vi.advanceTimersByTime(450);
    expect(seen).toEqual([1, 2, 1, 2, 1]);
  });

  it('stamps each emitted pose from the injected clock', async () => {
    let t = 1_000;
    const p = new MockProvider({ poses: [pose(), pose()], intervalMs: 250, now: () => t });
    const stamps = [];
    p.onPose((q) => stamps.push(q.timestamp));

    await p.start();
    t = 1_250;
    vi.advanceTimersByTime(250);
    expect(stamps).toEqual([1_000, 1_250]);
  });

  it('keeps an explicit timestamp from the script', async () => {
    const p = new MockProvider({ poses: [pose({ timestamp: 42 })], now: () => 999 });
    const stamps = [];
    p.onPose((q) => stamps.push(q.timestamp));
    await p.start();
    expect(stamps).toEqual([42]);
  });

  it('stop() halts playback and clears the pending timer', async () => {
    const p = new MockProvider({
      poses: [pose({ x: 1 }), pose({ x: 2 }), pose({ x: 3 })],
      intervalMs: 100,
    });
    const seen = [];
    p.onPose((q) => seen.push(q.x));

    await p.start();
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([1, 2]);

    await p.stop();
    expect(p.state).toBe('idle');
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([1, 2]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restarts from the beginning and keeps listeners after stop()', async () => {
    const p = new MockProvider({ poses: [pose({ x: 1 }), pose({ x: 2 })], intervalMs: 100 });
    const seen = [];
    p.onPose((q) => seen.push(q.x));

    await p.start();
    await p.stop();
    await p.start();
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([1, 1, 2]);
  });

  it('start() while running is a no-op (no duplicate timers)', async () => {
    const p = new MockProvider({ poses: [pose({ x: 1 }), pose({ x: 2 })], intervalMs: 100 });
    const seen = [];
    p.onPose((q) => seen.push(q.x));

    await p.start();
    await p.start();
    expect(seen).toEqual([1]);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([1, 2]);
  });

  it('stop() is safe before start() and when called twice', async () => {
    const p = new MockProvider({ poses: [pose()] });
    await expect(p.stop()).resolves.toBeUndefined();
    await p.start();
    await p.stop();
    await expect(p.stop()).resolves.toBeUndefined();
    expect(p.state).toBe('idle');
  });

  it('with an empty script, start() emits nothing and schedules nothing', async () => {
    const p = new MockProvider();
    const listener = vi.fn();
    p.onPose(listener);
    await p.start();
    expect(listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(p.state).toBe('running');
  });

  it('uses injected timer functions', async () => {
    const setTimeout = vi.fn(() => 'timer-1');
    const clearTimeout = vi.fn();
    const p = new MockProvider({
      poses: [pose(), pose()],
      intervalMs: 300,
      setTimeout,
      clearTimeout,
    });
    await p.start();
    expect(setTimeout).toHaveBeenCalledOnce();
    expect(setTimeout.mock.calls[0][1]).toBe(300);
    await p.stop();
    expect(clearTimeout).toHaveBeenCalledWith('timer-1');
  });
});

describe('MockProvider — push()', () => {
  it('emits immediately whether or not playback is running', () => {
    const p = new MockProvider({ now: () => 7 });
    const listener = vi.fn();
    p.onPose(listener);

    p.push(pose({ x: 5 }));
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toEqual({ ...pose({ x: 5 }), timestamp: 7 });
  });

  it('rejects an invalid pose and emits nothing', () => {
    const p = new MockProvider();
    const listener = vi.fn();
    p.onPose(listener);
    expect(() => p.push(pose({ confidence: 2 }))).toThrow(RangeError);
    expect(() => p.push({ x: 1 })).toThrow(TypeError);
    expect(listener).not.toHaveBeenCalled();
  });

  it('honours an explicit timestamp', () => {
    const p = new MockProvider({ now: () => 7 });
    const listener = vi.fn();
    p.onPose(listener);
    p.push(pose({ timestamp: 99 }));
    expect(listener.mock.calls[0][0].timestamp).toBe(99);
  });
});
