#!/usr/bin/env node
/**
 * make-icons — render the app icon to PNG at the sizes iOS/Android/manifests
 * want, with no image library: pixels are rasterised here and encoded with
 * node:zlib. Output goes to assets/icons/ (served at /icons/).
 *
 *   node scripts/make-icons.mjs
 *
 * The design matches assets/favicon.svg: dark rounded square, accent arrow,
 * green dot. Colours are the theme tokens' values.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const BG = [0x0f, 0x17, 0x2a];
const ARROW = [0x38, 0xbd, 0xf8];
const DOT = [0x22, 0xc5, 0x5e];

/** Point-in-triangle via barycentric signs. */
function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Rasterise the icon at `size` px with 4× supersampling for smooth edges. */
export function renderIcon(size, { rounded = true } = {}) {
  const ss = 4;
  const S = size * ss;
  const u = S / 64; // design units → supersampled px
  const radius = rounded ? 14 * u : 0;
  const arrowL = [
    [32 * u, 10 * u],
    [14 * u, 48 * u],
    [32 * u, 39 * u],
  ];
  const arrowR = [
    [32 * u, 10 * u],
    [32 * u, 39 * u],
    [50 * u, 48 * u],
  ];
  const dot = [32 * u, 52 * u, 3.5 * u];

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const px = x * ss + sx + 0.5;
          const py = y * ss + sy + 0.5;
          // rounded-square coverage
          const cx = Math.min(Math.max(px, radius), S - radius);
          const cy = Math.min(Math.max(py, radius), S - radius);
          const inside = (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius;
          if (!inside) continue;
          let c = BG;
          if ((px - dot[0]) ** 2 + (py - dot[1]) ** 2 <= dot[2] ** 2) c = DOT;
          else if (inTriangle(px, py, ...arrowL) || inTriangle(px, py, ...arrowR)) c = ARROW;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      const cov = a / n / 255;
      // premultiplied → straight alpha
      out[i] = cov ? Math.round(r / n / cov) : 0;
      out[i + 1] = cov ? Math.round(g / n / cov) : 0;
      out[i + 2] = cov ? Math.round(b / n / cov) : 0;
      out[i + 3] = Math.round(a / n);
    }
  }
  return out;
}

// --- minimal PNG encoder (RGBA, 8-bit, no filter)
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const ICONS = [
  { file: 'apple-touch-icon.png', size: 180, rounded: false }, // iOS masks its own corners
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'favicon-32.png', size: 32 },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = fileURLToPath(new URL('../assets/icons/', import.meta.url));
  await mkdir(dir, { recursive: true });
  for (const icon of ICONS) {
    const png = encodePng(
      renderIcon(icon.size, { rounded: icon.rounded ?? true }),
      icon.size,
      icon.size
    );
    await writeFile(new URL(icon.file, `file://${dir}`), png);
    console.log(`${icon.file}\t${icon.size}×${icon.size}\t${png.length} bytes`);
  }
}
