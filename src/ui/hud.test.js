// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNavigator } from '../core/navigation.js';
import { findRoute } from '../core/router.js';
import { createVenue } from '../core/venue.js';
import demo from '../venues/demo-venue.json';
import { createHud } from './hud.js';
import en from './strings/en.js';
import { t } from './strings/index.js';

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

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Hud', () => {
  it('mounts with a prompt to choose a destination and no error or rescan', () => {
    const hud = createHud();
    expect(document.body.contains(hud.el)).toBe(true);
    expect(hud.text).toEqual({
      destination: t('hud.noDestination'),
      distance: '',
      step: '',
      error: '',
      rescan: '',
      notices: [],
    });
    expect(hud.el.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(hud.el.querySelector('[role="alert"]').hidden).toBe(true);
  });

  it('shows destination, distance and next step from navigator state', () => {
    const hud = createHud();
    const clinicA = venue.poiById('poi-clinic-a');
    hud.setDestination(clinicA);
    expect(hud.text.destination).toBe('To Clinic A');
    expect(hud.el.querySelector('[data-f="cancel"]').hidden).toBe(false);

    const nav = createNavigator(findRoute(venue.graph, 'n-entrance', 'n-clinic-a'));
    hud.setProgress(nav.update(pose(0, 0)));
    expect(hud.text.distance).toBe('22 m');
    expect(hud.el.querySelector('[data-f="distance"]').getAttribute('aria-label')).toBe(
      '22 metres to go'
    );
    expect(hud.text.step).toBe('Next: Lobby / reception');
  });

  it('describes the upcoming floor change with the floor name', () => {
    const hud = createHud();
    hud.setDestination(venue.poiById('poi-clinic-b'));
    const nav = createNavigator(
      findRoute(venue.graph, 'n-entrance', 'n-clinic-b', { wheelchair: true, timeOfDay: '12:00' })
    );
    hud.setProgress(nav.update(pose(0, 0)), { floorName: (i) => venue.floorByIndex(i).name });
    expect(hud.text.step).toBe('Go up to First floor via the lift');
  });

  it('shows arrival', () => {
    const hud = createHud();
    hud.setDestination(venue.poiById('poi-clinic-a'));
    const nav = createNavigator(findRoute(venue.graph, 'n-entrance', 'n-clinic-a'));
    hud.setProgress(nav.update(pose(10, 11)));
    expect(hud.text.destination).toBe('You have arrived at Clinic A');
    expect(hud.text.distance).toBe('Arrived');
    expect(hud.el.classList.contains('hud-arrived')).toBe(true);
    expect(hud.text.step).toBe('');
  });

  it('clearing the destination resets everything', () => {
    const hud = createHud();
    hud.setDestination(venue.poiById('poi-clinic-a'));
    hud.setArrived(true);
    hud.setDestination(null);
    expect(hud.text.destination).toBe(t('hud.noDestination'));
    expect(hud.el.classList.contains('hud-arrived')).toBe(false);
    expect(hud.el.querySelector('[data-f="cancel"]').hidden).toBe(true);
  });

  it('shows and acknowledges the rescan prompt', () => {
    const onRescanAcknowledged = vi.fn();
    const hud = createHud({ onRescanAcknowledged });
    hud.showRescan();
    expect(hud.text.rescan).toBe(t('hud.rescan.title'));
    expect(hud.el.querySelector('[data-f="rescan-body"]').textContent).toBe(t('hud.rescan.body'));
    hud.el.querySelector('[data-f="rescan-ok"]').click();
    expect(hud.text.rescan).toBe('');
    expect(onRescanAcknowledged).toHaveBeenCalledOnce();
  });

  it('renders inline errors with hint and retry instead of alert()', () => {
    const hud = createHud();
    const retry = vi.fn();
    hud.showError(t('error.noRoute', { name: 'Clinic B' }), {
      hint: t('error.noRouteHint'),
      retry,
    });
    expect(hud.text.error).toBe('No route to Clinic B with your current settings.');
    const hint = hud.el.querySelector('[data-f="error-hint"]');
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe(t('error.noRouteHint'));
    const retryBtn = hud.el.querySelector('[data-f="error-retry"]');
    expect(retryBtn.hidden).toBe(false);
    retryBtn.click();
    expect(retry).toHaveBeenCalledOnce();
    expect(hud.text.error).toBe('');

    hud.showError(t('error.cameraDenied'));
    expect(hud.el.querySelector('[data-f="error-retry"]').hidden).toBe(true);
    hud.el.querySelector('[data-f="error-dismiss"]').click();
    expect(hud.text.error).toBe('');
  });

  it('wires the change-destination and cancel buttons', () => {
    const onChangeDestination = vi.fn();
    const onCancel = vi.fn();
    const hud = createHud({ onChangeDestination, onCancel });
    hud.el.querySelector('[data-f="change"]').click();
    expect(onChangeDestination).toHaveBeenCalledOnce();
    hud.setDestination(venue.poiById('poi-clinic-a'));
    hud.el.querySelector('[data-f="cancel"]').click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('never contains text that is not from the strings module', () => {
    const hud = createHud();
    hud.setDestination(venue.poiById('poi-clinic-a'));
    hud.showRescan();
    hud.showError(t('error.generic', { message: 'x' }), { retry: () => {} });
    const allStrings = Object.values(en.strings);
    const texts = [...hud.el.querySelectorAll('button, h3, p')]
      .map((n) => n.textContent.trim())
      .filter(Boolean);
    for (const text of texts) {
      const known = allStrings.some(
        (s) => s === text || (s.includes('{') && matchesTemplate(s, text))
      );
      expect(known, `unexpected inline text: "${text}"`).toBe(true);
    }
  });

  it('show / hide / destroy', () => {
    const hud = createHud();
    hud.hide();
    expect(hud.el.hidden).toBe(true);
    hud.show();
    expect(hud.el.hidden).toBe(false);
    hud.destroy();
    expect(document.body.contains(hud.el)).toBe(false);
  });
});

describe('Hud — speech controls and live region', () => {
  it('exposes an assertive live region and reflects speech state on its controls', () => {
    const onToggleMute = vi.fn();
    const onRateChange = vi.fn();
    const hud = createHud({ onToggleMute, onRateChange });
    expect(hud.liveRegion.getAttribute('aria-live')).toBe('assertive');
    const mute = hud.el.querySelector('[data-f="mute"]');
    const rate = hud.el.querySelector('[data-f="rate"]');
    expect([...rate.options].map((o) => o.textContent)).toEqual([
      t('speech.rate.slow'),
      t('speech.rate.normal'),
      t('speech.rate.fast'),
    ]);

    hud.setSpeechState({ muted: false, rate: 1.3, supported: true });
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(mute.textContent).toBe(t('speech.on'));
    expect(rate.value).toBe('1.3');

    hud.setSpeechState({ muted: true, rate: 0.8, supported: true });
    expect(mute.getAttribute('aria-pressed')).toBe('false');
    expect(mute.textContent).toBe(t('speech.off'));

    mute.click();
    expect(onToggleMute).toHaveBeenCalledOnce();
    rate.value = '0.8';
    rate.dispatchEvent(new Event('change'));
    expect(onRateChange).toHaveBeenCalledWith(0.8);

    hud.setSpeechState({ muted: false, rate: 1, supported: false });
    expect(mute.disabled).toBe(true);
    expect(hud.el.querySelector('[data-f="speech-unsupported"]').hidden).toBe(false);
  });
});

function matchesTemplate(template, text) {
  const re = new RegExp(
    `^${template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '.+')}$`
  );
  return re.test(text);
}
