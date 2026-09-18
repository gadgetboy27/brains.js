/**
 * Billboard text labels for the 3-D scene, drawn to a canvas texture and
 * shown on a three.js Sprite (which always faces the camera — the "look-at"
 * behaviour of the legacy A-Frame labels). Colours come from CSS tokens.
 *
 * Returns null where no 2-D canvas is available (e.g. jsdom), so callers
 * degrade to unlabelled markers rather than failing.
 */

import { CanvasTexture, Sprite, SpriteMaterial } from 'three';

import { cssToken } from './tokens.js';

/**
 * @param {string} text
 * @param {Object} [options]
 * @param {Document} [options.document]
 * @param {string} [options.background]  CSS colour; default token --color-arrow-label-bg.
 * @param {string} [options.color]       CSS colour; default token --color-arrow-label-text.
 * @param {number} [options.fontPx=28]
 * @param {number} [options.scale=0.01]  World metres per texture pixel.
 * @returns {Sprite | null}
 */
export function makeTextSprite(text, options = {}) {
  const doc = options.document ?? globalThis.document;
  const canvas = doc?.createElement?.('canvas');
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return null;

  const fontPx = options.fontPx ?? 28;
  const font = `${fontPx}px system-ui, sans-serif`;
  const pad = Math.round(fontPx * 0.45);
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = Math.round(fontPx * 1.6);
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.fillStyle =
    options.background ?? cssToken('--color-arrow-label-bg', { fallback: 'rgba(0,0,0,0.7)' });
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = options.color ?? cssToken('--color-arrow-label-text', { fallback: '#ffffff' });
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2);

  const texture = new CanvasTexture(canvas);
  const sprite = new Sprite(
    new SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  );
  const scale = options.scale ?? 0.01;
  sprite.scale.set(w * scale, h * scale, 1);
  sprite.name = `label:${text}`;
  return sprite;
}

/** Update the text of a sprite made by makeTextSprite, reusing its canvas. */
export function updateTextSprite(sprite, text, options = {}) {
  const canvas = sprite?.material?.map?.image;
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return false;
  const fontPx = options.fontPx ?? 28;
  const font = `${fontPx}px system-ui, sans-serif`;
  const pad = Math.round(fontPx * 0.45);
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = Math.round(fontPx * 1.6);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    const scale = options.scale ?? 0.01;
    sprite.scale.set(w * scale, h * scale, 1);
  }
  ctx.clearRect(0, 0, w, h);
  ctx.font = font;
  ctx.fillStyle =
    options.background ?? cssToken('--color-arrow-label-bg', { fallback: 'rgba(0,0,0,0.7)' });
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = options.color ?? cssToken('--color-arrow-label-text', { fallback: '#ffffff' });
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2);
  sprite.material.map.needsUpdate = true;
  sprite.name = `label:${text}`;
  return true;
}
