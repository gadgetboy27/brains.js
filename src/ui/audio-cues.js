/**
 * Audio cues — short tones that say what just happened without looking.
 *
 * Staff walking a venue with the camera held out in front of them cannot watch
 * the screen as well as the scanner, so each scan gets a sound: a bright chime
 * when a marker read and fits, a flat double tone when it read but does not fit
 * where the walker was, a low tone when it did not read at all, and a rising
 * three-note phrase when a route is saved. Generated with the Web Audio API,
 * so there are no audio files to ship.
 *
 * Browsers only let a page make sound after a user gesture, so {@link unlock}
 * is called from the first tap. The on/off choice is remembered on the phone
 * (it is a setting, like language) and defaults to on for staff and off for
 * visitors, who may be in a quiet ward.
 *
 * Injectable (AudioContext class, storage) so it is testable without audio.
 */

const KEY = 'brains:sound';

/** [frequency Hz, duration s] notes, played in sequence. */
const TONES = Object.freeze({
  scan: [
    [880, 0.08],
    [1320, 0.1],
  ],
  saved: [
    [660, 0.09],
    [880, 0.09],
    [1320, 0.16],
  ],
  warn: [
    [520, 0.12],
    [520, 0.12],
  ],
  problem: [
    [300, 0.18],
    [220, 0.26],
  ],
});

/**
 * @param {Object} [options]
 * @param {typeof AudioContext | null} [options.AudioContextClass]
 * @param {Storage | null} [options.storage]  Remembers the on/off choice.
 * @param {boolean} [options.defaultOn=false] Used until the user has chosen.
 * @param {number} [options.volume=0.25]
 */
export function createAudioCues({
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null,
  storage = null,
  defaultOn = false,
  volume = 0.25,
} = {}) {
  let ctx = null;
  let busyUntil = 0; // cues queue up rather than playing over each other
  let on = defaultOn;
  try {
    const saved = storage?.getItem(KEY);
    if (saved === 'on') on = true;
    else if (saved === 'off') on = false;
  } catch {
    // storage unavailable: keep the default
  }

  function context() {
    if (ctx || typeof AudioContextClass !== 'function') return ctx;
    try {
      ctx = new AudioContextClass();
    } catch {
      ctx = null;
    }
    return ctx;
  }

  return {
    /** Whether sounds are on. */
    get enabled() {
      return on;
    },
    /** Whether this browser can make them at all. */
    get supported() {
      return typeof AudioContextClass === 'function';
    },

    /** Turn sounds on or off, and remember the choice. */
    setEnabled(value) {
      on = Boolean(value);
      try {
        storage?.setItem(KEY, on ? 'on' : 'off');
      } catch {
        // best-effort
      }
      return on;
    },

    /** Call from a user gesture: browsers keep audio locked until then. */
    unlock() {
      const c = context();
      if (c?.state === 'suspended') void c.resume?.();
    },

    /**
     * Play a cue. Never throws; returns whether anything was scheduled.
     * @param {'scan' | 'saved' | 'warn' | 'problem'} name
     */
    play(name) {
      const notes = TONES[name];
      if (!on || !notes) return false;
      const c = context();
      if (!c) return false;
      try {
        if (c.state === 'suspended') void c.resume?.();
        let t = Math.max(c.currentTime, busyUntil);
        for (const [freq, seconds] of notes) {
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = name === 'problem' || name === 'warn' ? 'square' : 'sine';
          osc.frequency.value = freq;
          // A quick ramp up and down so notes do not click.
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(volume, t + 0.01);
          gain.gain.linearRampToValueAtTime(0, t + seconds);
          osc.connect(gain);
          gain.connect(c.destination);
          osc.start(t);
          osc.stop(t + seconds + 0.02);
          t += seconds;
        }
        busyUntil = t + 0.06;
        return true;
      } catch {
        return false;
      }
    },
  };
}
