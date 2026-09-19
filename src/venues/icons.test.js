import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ICONS, decodePng, renderIcon } from '../../scripts/make-icons.mjs';
import { imageSize } from '../../scripts/lib/venue-builder.mjs';

describe('app icons', () => {
  it('committed PNGs are valid and match the generator', () => {
    for (const icon of ICONS) {
      const file = readFileSync(resolve(process.cwd(), 'assets/icons', icon.file));
      expect(imageSize(file)).toEqual({ width: icon.size, height: icon.size, type: 'png' });
      // Compare pixels, not bytes: zlib output differs between platforms.
      const { rgba } = decodePng(file);
      const fresh = renderIcon(icon.size, { rounded: icon.rounded ?? true });
      expect(rgba.equals(fresh), `${icon.file} is stale: run node scripts/make-icons.mjs`).toBe(
        true
      );
    }
  }, 30_000); // the 512 px render with 4× supersampling takes a few seconds

  it('renders the arrow in the accent colour on a transparent-cornered dark square', () => {
    const px = renderIcon(64);
    const at = (x, y) => [...px.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
    expect(at(0, 0)[3]).toBe(0); // rounded corner is transparent
    expect(at(32, 30)).toEqual([0x38, 0xbd, 0xf8, 255]); // arrow
    expect(at(6, 32)).toEqual([0x0f, 0x17, 0x2a, 255]); // background
    expect(at(32, 52)).toEqual([0x22, 0xc5, 0x5e, 255]); // dot
  });

  it('index.html and the manifest reference the icons', () => {
    const html = readFileSync(resolve(process.cwd(), 'public/index.html'), 'utf8');
    expect(html).toContain('href="/favicon.svg"');
    expect(html).toContain('href="/icons/apple-touch-icon.png"');
    expect(html).toContain('rel="manifest"');
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), 'assets/manifest.webmanifest'), 'utf8')
    );
    expect(manifest.icons.map((i) => i.src)).toContain('/icons/icon-512.png');
  });
});
