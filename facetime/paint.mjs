// Paints a wall in a panorama any colour, the way scripts/render_finishes.py does it in Blender: the wall keeps
// its own light and shadow (its brightness) and takes the hue of the paint, so it still looks like the scan.
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const wallsDir = new URL('./media/walls/', import.meta.url);

/**
 * The paintable wall of each stop, from media/walls/index.json: { [stop]: { file, label } }.
 * Returns { [stop]: { label, mask, width, height } } where mask is one byte per panorama pixel (255 = wall).
 * A stop without a mask is absent; with no index at all the result is empty.
 */
export async function loadWalls() {
  let index;
  try { index = JSON.parse(await readFile(new URL('index.json', wallsDir), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  const walls = {};
  for (const [stop, { file, label }] of Object.entries(index)) {
    const { data, info } = await sharp(await readFile(new URL(file, wallsDir))).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
    walls[stop] = { label, mask: new Uint8Array(data), width: info.width, height: info.height };
  }
  return walls;
}

const toLinear = Float32Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});
const toSrgb = Uint8Array.from({ length: 4097 }, (_, index) => {
  const linear = index / 4096;
  return Math.round(255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055));
});
const GRAY = toLinear[160];              // the brightness the unpainted wall is treated as

/**
 * A painted copy of a panorama.
 * @param {Uint32Array} source RGBA pixels, one little-endian Uint32 each (red in the low byte)
 * @param {Uint8Array} mask one byte per pixel, 0 = leave alone, 255 = fully painted
 * @param {[number, number, number]} rgb the paint colour, 0 to 255 per channel
 */
export function tintPano(source, mask, [red, green, blue]) {
  const out = new Uint32Array(source);
  const tr = toLinear[red] / GRAY, tg = toLinear[green] / GRAY, tb = toLinear[blue] / GRAY;
  for (let i = 0; i < source.length; i++) {
    const amount = mask[i];
    if (amount === 0) continue;
    const pixel = source[i];
    const r = toLinear[pixel & 255], g = toLinear[(pixel >>> 8) & 255], b = toLinear[(pixel >>> 16) & 255];
    const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b, a = amount / 255;
    const mix = (photo, paint) => toSrgb[Math.round(Math.min(photo + (brightness * paint - photo) * a, 1) * 4096)];
    out[i] = 0xff000000 | (mix(b, tb) << 16) | (mix(g, tg) << 8) | mix(r, tr);
  }
  return out;
}
