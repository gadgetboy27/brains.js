import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PositionProvider, validateProvider } from '../core/positioning.js';
import { createVenue } from '../core/venue.js';
import sample from '../venues/fixtures/sample-venue.json';
import { QrProvider, formatQrPayload, parseQrPayload } from './qr.js';

const venue = () => createVenue(structuredClone(sample));

/** A fake MediaStream with stoppable tracks. */
function fakeStream() {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track], track };
}

/** A fake video element. */
function fakeVideo() {
  return {
    srcObject: null,
    muted: false,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    setAttribute: vi.fn(),
  };
}

/** A fake BarcodeDetector whose detect() returns whatever the test queues. */
function fakeDetectorClass() {
  const queue = [];
  const ctor = vi.fn(function FakeDetector(options) {
    this.options = options;
    this.detect = vi.fn(async () => queue.shift() ?? []);
  });
  ctor.queue = queue;
  return ctor;
}

function make(overrides = {}) {
  const stream = fakeStream();
  const video = fakeVideo();
  const BarcodeDetector = fakeDetectorClass();
  const getUserMedia = vi.fn(async () => stream);
  const provider = new QrProvider({
    venue: venue(),
    video,
    getUserMedia,
    BarcodeDetector,
    scanIntervalMs: 100,
    ...overrides,
  });
  return { provider, stream, video, BarcodeDetector, getUserMedia };
}

function collect(provider) {
  const poses = [];
  const statuses = [];
  const scans = [];
  provider.onPose((p) => poses.push(p));
  provider.onStatus((s) => statuses.push(s.status));
  provider.onScan((s) => scans.push(s));
  return { poses, statuses, scans };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(2_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('parseQrPayload', () => {
  it('parses the compact brains:// scheme', () => {
    expect(parseQrPayload('brains://sample-mall/a-entrance')).toEqual({
      venueId: 'sample-mall',
      anchorId: 'a-entrance',
    });
    expect(parseQrPayload('  BRAINS://sample-mall/a-entrance/  ')).toEqual({
      venueId: 'sample-mall',
      anchorId: 'a-entrance',
    });
  });

  it('parses http(s) URLs with venue and anchor in query or hash', () => {
    expect(parseQrPayload('https://example.com/ar?venue=sample-mall&anchor=a-1')).toEqual({
      venueId: 'sample-mall',
      anchorId: 'a-1',
    });
    expect(parseQrPayload('https://example.com/#venue=sample-mall&anchor=a-1')).toEqual({
      venueId: 'sample-mall',
      anchorId: 'a-1',
    });
    expect(parseQrPayload('https://wayfinding.example.nz/?v=sample-mall&anchor=a-1')).toEqual({
      venueId: 'sample-mall',
      anchorId: 'a-1',
    });
    expect(parseQrPayload('http://localhost:5173/#/venue=m&anchor=a')).toEqual({
      venueId: 'm',
      anchorId: 'a',
    });
  });

  it('returns null for anything else', () => {
    expect(parseQrPayload('hello')).toBeNull();
    expect(parseQrPayload('https://example.com/?venue=only')).toBeNull();
    expect(parseQrPayload('ftp://example.com/?venue=a&anchor=b')).toBeNull();
    expect(parseQrPayload('brains://only-venue')).toBeNull();
    expect(parseQrPayload(42)).toBeNull();
    expect(parseQrPayload('')).toBeNull();
  });

  it('round-trips formatQrPayload, including encoded characters', () => {
    const text = formatQrPayload('my venue', 'a/1');
    expect(text).toBe('brains://my%20venue/a%2F1');
    expect(parseQrPayload(text)).toEqual({ venueId: 'my venue', anchorId: 'a/1' });
  });
});

describe('QrProvider — interface', () => {
  it('is a PositionProvider that passes validateProvider()', () => {
    const { provider } = make();
    expect(provider).toBeInstanceOf(PositionProvider);
    expect(() => validateProvider(provider)).not.toThrow();
  });

  it('declares on its own class that nothing leaves the device', () => {
    expect(Object.hasOwn(QrProvider, 'uploads')).toBe(true);
    expect(QrProvider.uploads).toEqual([]);
  });

  it('requires a Venue', () => {
    expect(() => new QrProvider()).toThrow(/requires a Venue/);
    expect(() => new QrProvider({ venue: { id: 'x' } })).toThrow(/requires a Venue/);
  });

  it('validates numeric options', () => {
    expect(() => make({ scanIntervalMs: -1 })).toThrow(RangeError);
    expect(() => make({ repeatSuppressMs: NaN })).toThrow(RangeError);
  });

  it('starts idle', () => {
    const { provider } = make();
    expect(provider.status).toBe('idle');
    expect(provider.error).toBeNull();
    expect(provider.video).toBeNull();
  });
});

describe('QrProvider — camera lifecycle', () => {
  it('opens the rear camera, attaches it to the video and starts scanning', async () => {
    const { provider, stream, video, BarcodeDetector, getUserMedia } = make();
    const { statuses } = collect(provider);

    await provider.start();

    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment' },
      audio: false,
    });
    expect(BarcodeDetector).toHaveBeenCalledWith({ formats: ['qr_code'] });
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
    expect(video.setAttribute).toHaveBeenCalledWith('playsinline', '');
    expect(video.play).toHaveBeenCalledOnce();
    expect(provider.status).toBe('scanning');
    expect(provider.video).toBe(video);
    expect(statuses).toEqual(['starting', 'scanning']);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('creates an off-screen video element when none is supplied', async () => {
    const created = fakeVideo();
    const { provider } = make({ video: undefined, createVideo: () => created });
    await provider.start();
    expect(provider.video).toBe(created);
  });

  it('stop() releases the camera, detaches the video and clears the timer', async () => {
    const { provider, stream, video } = make();
    const { statuses } = collect(provider);
    await provider.start();
    await provider.stop();

    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(provider.status).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
    expect(statuses).toEqual(['starting', 'scanning', 'idle']);
  });

  it('stop() is safe before start() and twice', async () => {
    const { provider } = make();
    const { statuses } = collect(provider);
    await provider.stop();
    await provider.stop();
    expect(statuses).toEqual([]); // already idle: no spurious event
  });

  it('start() while scanning is a no-op', async () => {
    const { provider, getUserMedia } = make();
    await provider.start();
    await provider.start();
    expect(getUserMedia).toHaveBeenCalledOnce();
  });
});

describe('QrProvider — camera permission and availability', () => {
  const denied = (name) => {
    const err = new Error('denied');
    err.name = name;
    return err;
  };

  it.each(['NotAllowedError', 'PermissionDeniedError', 'SecurityError'])(
    'settles into permission-denied on %s without throwing',
    async (name) => {
      const { provider } = make({ getUserMedia: vi.fn(async () => Promise.reject(denied(name))) });
      const { statuses, poses } = collect(provider);

      await expect(provider.start()).resolves.toBeUndefined();

      expect(provider.status).toBe('permission-denied');
      expect(provider.error.name).toBe(name);
      expect(statuses).toEqual(['starting', 'permission-denied']);
      expect(poses).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      expect(provider.video).toBeNull();
    }
  );

  it.each(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'])(
    'settles into no-camera on %s',
    async (name) => {
      const { provider } = make({ getUserMedia: vi.fn(async () => Promise.reject(denied(name))) });
      await provider.start();
      expect(provider.status).toBe('no-camera');
    }
  );

  it('reports unsupported when getUserMedia or BarcodeDetector is missing', async () => {
    const a = make({ getUserMedia: undefined });
    await a.provider.start();
    expect(a.provider.status).toBe('unsupported');
    expect(a.provider.error.message).toMatch(/getUserMedia/);

    const b = make({ BarcodeDetector: undefined });
    await b.provider.start();
    expect(b.provider.status).toBe('unsupported');
    expect(b.provider.error.message).toMatch(/BarcodeDetector/);
  });

  it('reports error for an unexpected failure and releases the stream', async () => {
    const { provider, stream } = make({
      video: {
        ...fakeVideo(),
        play: vi.fn(async () => Promise.reject(new Error('autoplay blocked'))),
      },
    });
    await provider.start();
    expect(provider.status).toBe('error');
    expect(provider.error.message).toBe('autoplay blocked');
    expect(stream.track.stop).toHaveBeenCalledOnce();
  });

  it('retries on the next start() after a denial', async () => {
    const stream = fakeStream();
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(denied('NotAllowedError'))
      .mockResolvedValueOnce(stream);
    const { provider } = make({ getUserMedia });
    const { statuses } = collect(provider);

    await provider.start();
    expect(provider.status).toBe('permission-denied');
    await provider.start();
    expect(provider.status).toBe('scanning');
    expect(statuses).toEqual(['starting', 'permission-denied', 'starting', 'scanning']);
  });

  it('keeps the base contract: other listeners are unaffected by a denial', async () => {
    const { provider } = make({
      getUserMedia: vi.fn(async () => Promise.reject(denied('NotAllowedError'))),
    });
    const listener = vi.fn();
    provider.onPose(listener);
    await provider.start();
    // The app can still feed poses through handleScan() (e.g. typed code).
    provider.handleScan('brains://sample-mall/a-entrance');
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('QrProvider — scanning and pose emission', () => {
  it('emits the anchor pose with confidence 1 when a valid code is detected', async () => {
    const { provider, BarcodeDetector } = make();
    const { poses, scans } = collect(provider);
    await provider.start();

    BarcodeDetector.queue.push([{ rawValue: 'brains://sample-mall/a-entrance' }]);
    await vi.advanceTimersByTimeAsync(100);

    expect(poses).toHaveLength(1);
    expect(poses[0]).toEqual({
      x: 0.5,
      y: 1,
      z: 0,
      floor: 0,
      heading: 90,
      confidence: 1,
      timestamp: 2_000_100,
    });
    expect(scans).toEqual([
      {
        text: 'brains://sample-mall/a-entrance',
        result: 'accepted',
        venueId: 'sample-mall',
        anchorId: 'a-entrance',
      },
    ]);
  });

  it('defaults anchor z and heading to 0', async () => {
    const { provider } = make();
    const { poses } = collect(provider);
    provider.handleScan('brains://sample-mall/a-l1-landing');
    expect(poses[0]).toMatchObject({ x: 10, y: 1.5, z: 4.2, floor: 1, heading: 0 });
  });

  it('keeps scanning frames on the interval and tolerates empty frames', async () => {
    const { provider, BarcodeDetector } = make();
    const { poses } = collect(provider);
    await provider.start();

    await vi.advanceTimersByTimeAsync(300); // three empty frames
    const detector = BarcodeDetector.mock.instances[0];
    expect(detector.detect).toHaveBeenCalledTimes(3);
    expect(poses).toHaveLength(0);
    expect(provider.status).toBe('scanning');
  });

  it('suppresses repeats of the same code within repeatSuppressMs', async () => {
    const { provider } = make({ repeatSuppressMs: 3000 });
    const { poses, scans } = collect(provider);

    expect(provider.handleScan('brains://sample-mall/a-entrance')).toBe('accepted');
    expect(provider.handleScan('brains://sample-mall/a-entrance')).toBe('repeat');
    vi.setSystemTime(2_002_999);
    expect(provider.handleScan('brains://sample-mall/a-entrance')).toBe('repeat');
    vi.setSystemTime(2_003_000);
    expect(provider.handleScan('brains://sample-mall/a-entrance')).toBe('accepted');

    expect(poses).toHaveLength(2);
    expect(scans.map((s) => s.result)).toEqual(['accepted', 'repeat', 'repeat', 'accepted']);
  });

  it('a different code is accepted immediately', () => {
    const { provider } = make();
    const { poses } = collect(provider);
    provider.handleScan('brains://sample-mall/a-entrance');
    provider.handleScan('brains://sample-mall/a-l1-landing');
    expect(poses.map((p) => p.floor)).toEqual([0, 1]);
  });

  it('ignores codes for a different venue, an unknown anchor, or junk', () => {
    const { provider } = make();
    const { poses, scans } = collect(provider);

    expect(provider.handleScan('brains://other-mall/a-entrance')).toBe('wrong-venue');
    expect(provider.handleScan('brains://sample-mall/a-nope')).toBe('unknown-anchor');
    expect(provider.handleScan('https://example.com/not-ours')).toBe('unrecognised');

    expect(poses).toEqual([]);
    expect(scans.map((s) => s.result)).toEqual(['wrong-venue', 'unknown-anchor', 'unrecognised']);
    expect(scans[0]).toMatchObject({ venueId: 'other-mall', anchorId: 'a-entrance' });
  });

  it('accepts the URL form of the payload', () => {
    const { provider } = make();
    const { poses } = collect(provider);
    provider.handleScan('https://example.com/ar#venue=sample-mall&anchor=a-entrance');
    expect(poses).toHaveLength(1);
  });

  it('keeps scanning after an InvalidStateError (video not ready) frame', async () => {
    const { provider, BarcodeDetector } = make();
    await provider.start();
    const detector = BarcodeDetector.mock.instances[0];
    const notReady = new Error('not ready');
    notReady.name = 'InvalidStateError';
    detector.detect.mockRejectedValueOnce(notReady);

    await vi.advanceTimersByTimeAsync(200);
    expect(detector.detect).toHaveBeenCalledTimes(2);
    expect(provider.status).toBe('scanning');
  });

  it('moves to error and releases the camera on an unexpected decode failure', async () => {
    const { provider, BarcodeDetector, stream } = make();
    const { statuses } = collect(provider);
    await provider.start();
    BarcodeDetector.mock.instances[0].detect.mockRejectedValueOnce(new Error('wasm crashed'));

    await vi.advanceTimersByTimeAsync(100);
    expect(provider.status).toBe('error');
    expect(provider.error.message).toBe('wasm crashed');
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(statuses.at(-1)).toBe('error');
  });

  it('does not emit after stop() even if a frame was in flight', async () => {
    const { provider, BarcodeDetector } = make();
    const { poses } = collect(provider);
    await provider.start();
    let resolveDetect;
    BarcodeDetector.mock.instances[0].detect.mockImplementationOnce(
      () => new Promise((resolve) => (resolveDetect = resolve))
    );
    vi.advanceTimersByTime(100); // detect() now pending
    await provider.stop();
    resolveDetect([{ rawValue: 'brains://sample-mall/a-entrance' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(poses).toEqual([]);
  });
});
