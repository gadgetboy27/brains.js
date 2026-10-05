// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReadyCard } from './ready-card.js';
import { t } from './strings/index.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('ReadyCard', () => {
  const info = {
    poi: { id: 'p-x', name: 'Radiology' },
    fromName: 'Main entrance',
    distanceM: 80,
    viaTypes: ['walk', 'lift', 'door', 'lift'],
  };

  it('is hidden until shown, then summarises the route', () => {
    const card = createReadyCard();
    expect(card.visible).toBe(false);
    card.show(info);
    expect(card.visible).toBe(true);
    expect(card.el.textContent).toContain('Main entrance → Radiology');
    expect(card.el.textContent).toContain('1 min');
    expect(card.el.textContent).toContain(t('ready.via', { via: 'lift' }));
  });

  it('Start hands over the place and hides; Change hides and asks for another', () => {
    const onStart = vi.fn();
    const onChange = vi.fn();
    const card = createReadyCard({ onStart, onChange });
    card.show(info);
    card.el.querySelector('[data-f="start"]').click();
    expect(onStart).toHaveBeenCalledWith(info.poi);
    expect(card.visible).toBe(false);
    card.show(info);
    card.el.querySelector('[data-f="change"]').click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(card.visible).toBe(false);
  });
});
