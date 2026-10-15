import { describe, expect, it, vi } from 'vitest';

import { createAudioCues } from './audio-cues.js';

function fakeAudio() {
  const made = { oscillators: [] };
  class Ctx {
    state = 'suspended';
    currentTime = 10;
    destination = {};
    resume = vi.fn(async () => {
      this.state = 'running';
    });
    createOscillator() {
      const o = {
        frequency: { value: 0 },
        type: '',
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      made.oscillators.push(o);
      return o;
    }
    createGain() {
      return {
        gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      };
    }
  }
  return { Ctx, made };
}
const store = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

describe('createAudioCues', () => {
  it('is silent until switched on, then plays each cue as a run of notes in order', () => {
    const { Ctx, made } = fakeAudio();
    const cues = createAudioCues({ AudioContextClass: Ctx });
    expect(cues.enabled).toBe(false);
    expect(cues.play('scan')).toBe(false);
    expect(made.oscillators).toHaveLength(0);

    cues.setEnabled(true);
    expect(cues.play('scan')).toBe(true);
    expect(made.oscillators.map((o) => o.frequency.value)).toEqual([880, 1320]);
    // The notes follow each other, not all at once.
    const starts = made.oscillators.map((o) => o.start.mock.calls[0][0]);
    expect(starts[1]).toBeGreaterThan(starts[0]);
  });

  it('has a different sound for fitting, not fitting, not reading, and saved', () => {
    const { Ctx, made } = fakeAudio();
    const cues = createAudioCues({ AudioContextClass: Ctx, defaultOn: true });
    const freqs = (name) => {
      made.oscillators.length = 0;
      cues.play(name);
      return made.oscillators.map((o) => o.frequency.value).join(',');
    };
    const all = ['scan', 'warn', 'problem', 'saved'].map(freqs);
    expect(new Set(all).size).toBe(4);
    expect(freqs('saved').split(',')).toHaveLength(3);
    expect(freqs('problem')).toBe('300,220'); // lower and falling: something is wrong
  });

  it('queues cues one after another instead of playing them on top of each other', () => {
    const { Ctx, made } = fakeAudio();
    const cues = createAudioCues({ AudioContextClass: Ctx, defaultOn: true });
    cues.play('scan');
    cues.play('saved'); // asked for at the same instant
    const starts = made.oscillators.map((o) => o.start.mock.calls[0][0]);
    expect(starts).toHaveLength(5);
    expect(starts[2]).toBeGreaterThanOrEqual(starts[1] + 0.1); // 'saved' waits for 'scan' to finish
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('ignores an unknown cue', () => {
    const { Ctx } = fakeAudio();
    expect(createAudioCues({ AudioContextClass: Ctx, defaultOn: true }).play('nope')).toBe(false);
  });

  it('remembers the choice on the phone, and the choice beats the default', () => {
    const { Ctx } = fakeAudio();
    const s = store();
    const first = createAudioCues({ AudioContextClass: Ctx, storage: s, defaultOn: true });
    expect(first.enabled).toBe(true);
    first.setEnabled(false);
    const later = createAudioCues({ AudioContextClass: Ctx, storage: s, defaultOn: true });
    expect(later.enabled).toBe(false);
  });

  it('unlock() wakes a locked context so a later cue is heard', () => {
    const { Ctx } = fakeAudio();
    const cues = createAudioCues({ AudioContextClass: Ctx, defaultOn: true });
    cues.unlock();
    cues.unlock(); // idempotent
    expect(cues.play('scan')).toBe(true);
  });

  it('does nothing, without throwing, where audio is unavailable or breaks', () => {
    const none = createAudioCues({ AudioContextClass: null, defaultOn: true });
    expect(none.supported).toBe(false);
    expect(none.play('scan')).toBe(false);
    none.unlock();
    class Broken {
      constructor() {
        throw new Error('blocked');
      }
    }
    expect(createAudioCues({ AudioContextClass: Broken, defaultOn: true }).play('scan')).toBe(
      false
    );
    const badStore = {
      getItem: () => {
        throw new Error('no');
      },
      setItem: () => {
        throw new Error('no');
      },
    };
    const c = createAudioCues({ AudioContextClass: Broken, storage: badStore, defaultOn: true });
    expect(c.enabled).toBe(true);
    expect(() => c.setEnabled(false)).not.toThrow();
  });
});
