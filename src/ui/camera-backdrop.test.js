// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCameraBackdrop } from './camera-backdrop.js';

const stream = () => {
  const track = { stop: vi.fn() };
  return { getTracks: () => [track], track };
};

beforeEach(() => {
  document.body.innerHTML = '<div id="ar"><canvas></canvas></div>';
});

describe('CameraBackdrop', () => {
  it('mounts a hidden video before the canvas', () => {
    const mount = document.querySelector('#ar');
    const b = createCameraBackdrop({ mount, getUserMedia: vi.fn() });
    expect(mount.firstChild).toBe(b.video);
    expect(b.video.hidden).toBe(true);
    expect(b.video.getAttribute('aria-hidden')).toBe('true');
    expect(b.source).toBe('none');
  });

  it("reuses the provider's own camera stream without opening another", async () => {
    const getUserMedia = vi.fn();
    const b = createCameraBackdrop({ mount: document.querySelector('#ar'), getUserMedia });
    const s = stream();
    b.video.play = vi.fn(async () => {});
    expect(await b.attach({ video: { srcObject: s } })).toBe('provider');
    expect(b.video.srcObject).toBe(s);
    expect(b.video.hidden).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
    b.detach();
    expect(b.video.hidden).toBe(true);
    expect(s.track.stop).not.toHaveBeenCalled(); // not ours to stop
  });

  it('opens a preview stream for providers without a camera (mock), and releases it', async () => {
    const own = stream();
    const getUserMedia = vi.fn(async () => own);
    const b = createCameraBackdrop({ mount: document.querySelector('#ar'), getUserMedia });
    b.video.play = vi.fn(async () => {});
    expect(await b.attach({ constructor: { name: 'MockProvider' } })).toBe('preview');
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment' },
      audio: false,
    });
    b.detach();
    expect(own.track.stop).toHaveBeenCalledOnce();
  });

  it('stays out of the way of a provider that mounts its own camera', async () => {
    const getUserMedia = vi.fn();
    const b = createCameraBackdrop({ mount: document.querySelector('#ar'), getUserMedia });
    expect(await b.attach({ constructor: { name: 'ImmersalProvider' } })).toBe('external');
    expect(b.video.hidden).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('degrades to none when the camera cannot be opened', async () => {
    const b = createCameraBackdrop({
      mount: document.querySelector('#ar'),
      getUserMedia: async () => Promise.reject(new Error('NotAllowedError')),
    });
    expect(await b.attach(null)).toBe('none');
    expect(b.video.hidden).toBe(true);
    b.destroy();
    expect(document.querySelector('video')).toBeNull();
  });
});
