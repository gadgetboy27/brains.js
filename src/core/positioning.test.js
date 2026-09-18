import { describe, expect, it, vi } from 'vitest';

import { PositionProvider, validatePose, validateProvider } from './positioning.js';

const goodPose = () => ({
  x: 12.5,
  y: -3.25,
  z: 1.4,
  floor: 1,
  heading: 270,
  confidence: 0.85,
  timestamp: 1_758_240_000_000,
});

class NoUploads extends PositionProvider {
  static uploads = [];
  async start() {}
  async stop() {}
}

class CameraUploads extends PositionProvider {
  static uploads = [
    {
      data: 'camera frames',
      destination: 'Example VPS cloud API',
      purpose: 'Localise the device against the venue map.',
      retention: 'Discarded after localisation.',
    },
  ];
  async start() {}
  async stop() {}
}

describe('validatePose', () => {
  it('accepts a well-formed pose', () => {
    expect(() => validatePose(goodPose())).not.toThrow();
  });

  it('accepts boundary values', () => {
    expect(() => validatePose({ ...goodPose(), heading: 0, confidence: 0 })).not.toThrow();
    expect(() => validatePose({ ...goodPose(), heading: 359.999, confidence: 1 })).not.toThrow();
    expect(() => validatePose({ ...goodPose(), floor: -2 })).not.toThrow();
  });

  it('rejects non-objects', () => {
    expect(() => validatePose(null)).toThrow(TypeError);
    expect(() => validatePose('pose')).toThrow(TypeError);
  });

  it.each(['x', 'y', 'z', 'floor', 'heading', 'confidence', 'timestamp'])(
    'rejects a missing or non-finite %s',
    (field) => {
      const missing = goodPose();
      delete missing[field];
      expect(() => validatePose(missing)).toThrow(new RegExp(`pose\\.${field}`));
      expect(() => validatePose({ ...goodPose(), [field]: NaN })).toThrow(TypeError);
      expect(() => validatePose({ ...goodPose(), [field]: '1' })).toThrow(TypeError);
    }
  );

  it('rejects a non-integer floor', () => {
    expect(() => validatePose({ ...goodPose(), floor: 1.5 })).toThrow(RangeError);
  });

  it('rejects a heading outside [0, 360)', () => {
    expect(() => validatePose({ ...goodPose(), heading: -1 })).toThrow(RangeError);
    expect(() => validatePose({ ...goodPose(), heading: 360 })).toThrow(RangeError);
  });

  it('rejects a confidence outside [0, 1]', () => {
    expect(() => validatePose({ ...goodPose(), confidence: -0.1 })).toThrow(RangeError);
    expect(() => validatePose({ ...goodPose(), confidence: 1.01 })).toThrow(RangeError);
  });

  it('rejects poses that smuggle GPS coordinates', () => {
    for (const key of ['lat', 'lon', 'lng', 'latitude', 'longitude']) {
      expect(() => validatePose({ ...goodPose(), [key]: 51.5 })).toThrow(/GPS/);
    }
  });
});

describe('validateProvider', () => {
  it('accepts a subclass with an empty uploads declaration', () => {
    expect(() => validateProvider(new NoUploads())).not.toThrow();
  });

  it('accepts a subclass declaring uploads', () => {
    expect(() => validateProvider(new CameraUploads())).not.toThrow();
  });

  it('accepts a duck-typed plain object', () => {
    const provider = {
      uploads: [],
      start: async () => {},
      stop: async () => {},
      onPose: () => () => {},
    };
    expect(() => validateProvider(provider)).not.toThrow();
  });

  it('rejects non-objects', () => {
    expect(() => validateProvider(null)).toThrow(TypeError);
    expect(() => validateProvider(42)).toThrow(TypeError);
  });

  it.each(['start', 'stop', 'onPose'])('rejects a provider missing %s()', (method) => {
    const provider = {
      uploads: [],
      start: async () => {},
      stop: async () => {},
      onPose: () => () => {},
    };
    delete provider[method];
    expect(() => validateProvider(provider)).toThrow(
      new RegExp(`missing required method ${method}`)
    );
  });

  it('rejects a subclass that never declared uploads', () => {
    class Forgot extends PositionProvider {
      async start() {}
      async stop() {}
    }
    expect(() => validateProvider(new Forgot())).toThrow(/Forgot must declare a static "uploads"/);
  });

  it('does not let a subclass inherit its parent’s uploads declaration', () => {
    class Child extends NoUploads {}
    expect(() => validateProvider(new Child())).toThrow(/Child must declare a static "uploads"/);
  });

  it('rejects a non-array uploads declaration', () => {
    class Wrong extends PositionProvider {
      static uploads = 'none';
      async start() {}
      async stop() {}
    }
    expect(() => validateProvider(new Wrong())).toThrow(/must be an array/);
  });

  it.each(['data', 'destination', 'purpose'])(
    'rejects an upload declaration with a missing or blank %s',
    (field) => {
      const entry = { data: 'camera frames', destination: 'somewhere', purpose: 'because' };
      delete entry[field];
      class Incomplete extends PositionProvider {
        static uploads = [entry];
        async start() {}
        async stop() {}
      }
      expect(() => validateProvider(new Incomplete())).toThrow(
        new RegExp(`uploads\\[0\\]\\.${field} must be a non-empty string`)
      );

      class Blank extends PositionProvider {
        static uploads = [{ ...entry, [field]: '   ' }];
        async start() {}
        async stop() {}
      }
      expect(() => validateProvider(new Blank())).toThrow(/must be a non-empty string/);
    }
  );

  it('rejects a non-object upload entry', () => {
    class Bad extends PositionProvider {
      static uploads = ['camera frames'];
      async start() {}
      async stop() {}
    }
    expect(() => validateProvider(new Bad())).toThrow(/uploads\[0\] must be an object/);
  });
});

describe('PositionProvider base class', () => {
  it('throws from start() and stop() when not overridden', async () => {
    class Bare extends PositionProvider {
      static uploads = [];
    }
    const bare = new Bare();
    await expect(bare.start()).rejects.toThrow(/Bare must implement start\(\)/);
    await expect(bare.stop()).rejects.toThrow(/Bare must implement stop\(\)/);
  });

  it('delivers emitted poses to every listener', () => {
    const provider = new NoUploads();
    const a = vi.fn();
    const b = vi.fn();
    provider.onPose(a);
    provider.onPose(b);

    const pose = goodPose();
    provider.emitPose(pose);

    expect(a).toHaveBeenCalledOnce();
    expect(a).toHaveBeenCalledWith(pose);
    expect(b).toHaveBeenCalledOnce();
  });

  it('returns an unsubscribe function from onPose', () => {
    const provider = new NoUploads();
    const listener = vi.fn();
    const off = provider.onPose(listener);

    provider.emitPose(goodPose());
    off();
    provider.emitPose(goodPose());

    expect(listener).toHaveBeenCalledOnce();
  });

  it('rejects a non-function listener', () => {
    expect(() => new NoUploads().onPose('nope')).toThrow(TypeError);
  });

  it('refuses to emit an invalid pose', () => {
    const provider = new NoUploads();
    const listener = vi.fn();
    provider.onPose(listener);

    expect(() => provider.emitPose({ ...goodPose(), heading: 400 })).toThrow(RangeError);
    expect(() => provider.emitPose({ ...goodPose(), lat: 51.5 })).toThrow(/GPS/);
    expect(listener).not.toHaveBeenCalled();
  });
});
