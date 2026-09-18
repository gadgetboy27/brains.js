// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNavigator } from '../core/navigation.js';
import { findRoute } from '../core/router.js';
import { createVenue } from '../core/venue.js';
import demo from '../venues/demo-venue.json';
import { RATES, createSpeechGuide, speechLang } from './speech.js';
import { setLanguage, t } from './strings/index.js';

const venue = createVenue(structuredClone(demo));
const pose = (x, y, floor = 0) => ({
  x,
  y,
  z: floor * 4,
  floor,
  heading: 0,
  confidence: 1,
  timestamp: 1,
});

function fakeSynth() {
  const utterances = [];
  const synth = { speak: vi.fn((u) => utterances.push(u)), cancel: vi.fn() };
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  return { synth, Utterance, utterances };
}

function make(options = {}) {
  const { synth, Utterance, utterances } = fakeSynth();
  const live = document.createElement('div');
  const storage = {
    data: {},
    getItem: (k) => storage.data[k] ?? null,
    setItem: (k, v) => (storage.data[k] = v),
  };
  const guide = createSpeechGuide({ synth, Utterance, liveRegion: live, storage, ...options });
  return { guide, synth, utterances, live, storage };
}

afterEach(() => setLanguage('en'));

describe('SpeechGuide — basics', () => {
  it('maps UI languages to speech locales', () => {
    expect(speechLang('en')).toBe('en-NZ');
    expect(speechLang('mi')).toBe('mi-NZ');
    expect(speechLang('mi-NZ')).toBe('mi-NZ');
    expect(speechLang('sm')).toBe('sm');
  });

  it('speaks with the language and rate, and mirrors to the live region', () => {
    const { guide, synth, utterances, live } = make({ lang: 'mi', rate: 1.3 });
    expect(guide.supported).toBe(true);
    expect(guide.announce('Kia ora')).toBe(true);
    expect(synth.cancel).toHaveBeenCalledOnce(); // interrupts by default
    expect(utterances[0]).toMatchObject({ text: 'Kia ora', lang: 'mi-NZ', rate: 1.3 });
    expect(live.textContent).toBe('Kia ora');
    expect(guide.spoken).toEqual(['Kia ora']);
    guide.announce('again', { interrupt: false });
    expect(synth.cancel).toHaveBeenCalledOnce();
  });

  it('degrades to the live region when synthesis is unsupported', () => {
    const live = document.createElement('div');
    const guide = createSpeechGuide({
      synth: null,
      Utterance: null,
      liveRegion: live,
      storage: null,
    });
    expect(guide.supported).toBe(false);
    expect(guide.announce('hello')).toBe(false);
    expect(live.textContent).toBe('hello');
  });

  it('mute stops speech but keeps the live region, and persists', () => {
    const { guide, synth, utterances, live, storage } = make();
    const onChange = vi.fn();
    guide.onChange(onChange);
    guide.setMuted(true);
    expect(guide.muted).toBe(true);
    expect(synth.cancel).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith({ muted: true, rate: 1, supported: true });
    expect(live.textContent).toBe(t('speech.off'));
    expect(utterances.map((u) => u.text)).not.toContain(t('speech.off')); // muted: not spoken

    expect(guide.announce('silent')).toBe(false);
    expect(live.textContent).toBe('silent');
    expect(JSON.parse(storage.data['brains:speech'])).toEqual({ muted: true, rate: 1 });

    guide.toggleMuted();
    expect(guide.muted).toBe(false);
    expect(utterances.at(-1).text).toBe(t('speech.on')); // confirmation is spoken when unmuting
  });

  it('rate is clamped and persisted; stored settings are restored', () => {
    const { guide, storage } = make();
    guide.setRate(5);
    expect(guide.rate).toBe(2);
    guide.setRate('x');
    expect(guide.rate).toBe(RATES.normal);
    guide.setRate(RATES.slow);
    expect(JSON.parse(storage.data['brains:speech']).rate).toBe(0.8);

    const restored = createSpeechGuide({ ...fakeSynth(), storage });
    expect(restored.rate).toBe(0.8);
  });

  it('setLanguage changes the utterance locale', () => {
    const { guide, utterances } = make();
    guide.setLanguage('mi');
    guide.announce('x');
    expect(utterances[0].lang).toBe('mi-NZ');
  });
});

describe('SpeechGuide — narration', () => {
  it('announces the destination, then each new step, floor changes and arrival, without repeats', () => {
    const { guide } = make();
    const clinicB = venue.poiById('poi-clinic-b');
    const route = findRoute(venue.graph, 'n-entrance', 'n-clinic-b', {
      wheelchair: true,
      timeOfDay: '12:00',
    });
    const nav = createNavigator(route);
    const floorName = (i) => venue.floorByIndex(i).name;

    let state = nav.update(pose(0, 0));
    guide.announceDestination(clinicB, state);
    expect(guide.spoken.at(-1)).toBe('Navigating to Clinic B. 68 metres to go.');

    // Same step, barely moved: silent.
    expect(guide.narrate(nav.update(pose(0, 1)), { floorName })).toBeNull();

    // Reached the lobby → next step announced.
    state = nav.update(pose(0, 6));
    expect(guide.narrate(state, { floorName })).toBe(
      'Continue 10 metres to Ground corridor, west.'
    );
    expect(guide.narrate(nav.update(pose(2, 6)), { floorName })).toBeNull();

    // Walk to the lift lobby: the next node becomes the lift on floor 1 → floor change spoken once.
    nav.update(pose(10, 6));
    guide.narrate(nav.state, { floorName });
    nav.update(pose(20, 6));
    guide.narrate(nav.state, { floorName });
    nav.update(pose(30, 6));
    guide.narrate(nav.state, { floorName });
    state = nav.update(pose(30, 10));
    expect(state.nextNode.id).toBe('n-lift-1');
    expect(guide.narrate(state, { floorName })).toBe('Go up to First floor using the lift.');
    expect(guide.narrate(nav.update(pose(30, 10)), { floorName })).toBeNull(); // not repeated

    // Upstairs and on to the clinic.
    state = nav.update(pose(30, 10, 1));
    expect(guide.narrate(state, { floorName })).toBe('Continue 4 metres to First corridor, east.');
    state = nav.update(pose(20, 1, 1));
    expect(guide.narrate(state, { floorName, destinationName: 'Clinic B' })).toBe(
      'You have arrived at Clinic B.'
    );
    expect(guide.narrate(state, { floorName, destinationName: 'Clinic B' })).toBeNull();
  });

  it('gives a progress update every progressEveryM metres on a long leg', () => {
    const { guide } = make({ progressEveryM: 10 });
    const graph = {
      nodes: [
        { id: 'a', x: 0, y: 0, floor: 0, name: 'Start' },
        { id: 'b', x: 50, y: 0, floor: 0, name: 'Far end' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    };
    const nav = createNavigator(findRoute(graph, 'a', 'b'));
    guide.announceDestination({ name: 'Far end' }, nav.update(pose(0, 0)));
    expect(guide.narrate(nav.update(pose(5, 0)))).toBeNull();
    expect(guide.narrate(nav.update(pose(11, 0)))).toBe('Continue 39 metres to Far end.');
    expect(guide.narrate(nav.update(pose(15, 0)))).toBeNull();
    expect(guide.narrate(nav.update(pose(22, 0)))).toBe('Continue 28 metres to Far end.');
  });

  it('speaks cancellation and rescan prompts, and narrates in te reo Māori', () => {
    const { guide } = make();
    guide.announceCancelled();
    expect(guide.spoken.at(-1)).toBe(t('speech.cancelled'));
    guide.announceRescan();
    expect(guide.spoken.at(-1)).toBe(t('speech.rescan'));

    setLanguage('mi');
    const nav = createNavigator(findRoute(venue.graph, 'n-entrance', 'n-clinic-a'));
    guide.announceDestination(venue.poiById('poi-clinic-a'), nav.update(pose(0, 0)));
    expect(guide.spoken.at(-1)).toBe('E ārahi ana ki Clinic A. 22 mita e toe ana.');
  });
});
