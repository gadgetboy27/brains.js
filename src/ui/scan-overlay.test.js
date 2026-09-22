// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createScanOverlay } from './scan-overlay.js';
import { t } from './strings/index.js';

function make(overrides = {}) {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const overlay = createScanOverlay({ mount, document, ...overrides });
  const frame = overlay.el.querySelector('[data-f="frame"]');
  const badge = overlay.el.querySelector('[data-f="badge"]');
  return { overlay, mount, frame, badge };
}

describe('ScanOverlay', () => {
  it('starts with the viewfinder and the recording badge both hidden', () => {
    const { frame, badge } = make();
    expect(frame.hidden).toBe(true);
    expect(badge.hidden).toBe(true);
  });

  it('shows the viewfinder only when told to, and flashes it on a decode', () => {
    vi.useFakeTimers();
    try {
      const { overlay, frame } = make();
      overlay.flash(); // no effect while hidden — nothing to flash
      expect(frame.classList.contains('flash')).toBe(false);

      overlay.setViewfinderVisible(true);
      expect(frame.hidden).toBe(false);
      overlay.flash();
      expect(frame.classList.contains('flash')).toBe(true);
      vi.advanceTimersByTime(219);
      expect(frame.classList.contains('flash')).toBe(true);
      vi.advanceTimersByTime(1);
      expect(frame.classList.contains('flash')).toBe(false);

      overlay.setViewfinderVisible(false);
      expect(frame.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('repeated flashes restart the timer rather than clearing early', () => {
    vi.useFakeTimers();
    try {
      const { overlay, frame } = make();
      overlay.setViewfinderVisible(true);
      overlay.flash();
      vi.advanceTimersByTime(150);
      overlay.flash(); // a second decode before the first flash faded
      vi.advanceTimersByTime(150);
      expect(frame.classList.contains('flash')).toBe(true); // still within the restarted window
      vi.advanceTimersByTime(70);
      expect(frame.classList.contains('flash')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the recording badge with the live distance, and hides it when told to stop', () => {
    const { overlay, badge } = make();
    overlay.setRecording(true, 0);
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toContain(t('scan.recording', { distance: 0 }));

    overlay.setRecording(true, 23.6);
    expect(badge.textContent).toBe(t('scan.recording', { distance: 24 })); // rounded

    overlay.setRecording(false);
    expect(badge.hidden).toBe(true);
  });

  it('destroy removes the overlay from the page and clears any pending flash', () => {
    vi.useFakeTimers();
    try {
      const { overlay, mount } = make();
      overlay.setViewfinderVisible(true);
      overlay.flash();
      overlay.destroy();
      expect(mount.children).toHaveLength(0);
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
