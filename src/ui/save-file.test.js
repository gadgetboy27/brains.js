// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveFile } from './save-file.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('saveFile', () => {
  it('makes a download link for the text under the given name, clicks it once, and removes it', async () => {
    const clicks = [];
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = real(tag);
      if (tag === 'a') el.click = () => clicks.push({ name: el.download, href: el.href });
      return el;
    });
    let blob;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blob = b;
      return 'blob:abc';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    expect(saveFile('walk.learning.json', '{"a":1}')).toBe(true);
    expect(clicks).toEqual([{ name: 'walk.learning.json', href: 'blob:abc' }]);
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe('{"a":1}');
    expect(document.querySelector('a')).toBeNull();
  });

  it('can save other types, and uses the document and URL it is given', () => {
    const body = { appendChild: vi.fn() };
    const link = { click: vi.fn(), remove: vi.fn() };
    const doc = { createElement: vi.fn(() => link), body };
    const urls = { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() };
    vi.useFakeTimers();
    saveFile('notes.txt', 'hi', { type: 'text/plain', document: doc, URL: urls });
    expect(link.download).toBe('notes.txt');
    expect(link.href).toBe('blob:x');
    expect(urls.createObjectURL.mock.calls[0][0].type).toBe('text/plain');
    expect(link.click).toHaveBeenCalledOnce();
    expect(urls.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });
});
