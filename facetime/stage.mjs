// Furnishes (or otherwise changes) the part of a room the camera faces, so every direction from that standpoint
// agrees. The panorama is turned into ONE ordinary wide photo aimed where the camera looks, an image model edits
// that photo, and the result is laid back onto the panorama with feathered edges. Same idea as
// brace/backend/openproblems/reimagine_view.py, in the panorama's own yaw/pitch (see scripts/prepare_demo.py).
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const stagedDir = fileURLToPath(new URL('./media/staged/', import.meta.url));   // the first property's results; others pass their own folder

const ENDPOINT = 'https://api.openai.com/v1/images/edits';
const MODEL = process.env.STAGE_MODEL || 'gpt-image-2';
const QUALITY = process.env.STAGE_QUALITY || 'low';       // low is the only setting fast enough for a live call
const VIEW = { width: 1536, height: 1024, hfov: 100 };    // the photo the image model edits
const FEATHER = 0.05;                                     // share of the photo's edge blended into the real panorama
const TIMEOUT_MS = Number(process.env.STAGE_TIMEOUT_MS) || 90_000;

const KEEP = 'Apart from that one change, keep the camera position and the room exactly as they are: the same walls '
  + 'and wall colour, the same windows, blinds and doors, the same fireplace, the same ceiling and the same floor, '
  + 'and every piece of furniture that is already there in the same place. Do not add, remove or move any part of '
  + 'the building. Photorealistic, matching the light already in the photo.';

/** The instruction sent with the photo. */
export function stagingPrompt(request) {
  return `This is a real photo of a room in an apartment. Make exactly this change and nothing else: ${request.trim().replace(/[.\s]+$/, '')}. `
    + 'Anything you add must stand on the floor at a believable real-life size, in the correct perspective for this '
    + 'room, with soft contact shadows. Show every added piece whole: nothing new may touch or be cut off by the edges '
    + 'of the picture, so keep it all in the middle of the picture with bare floor and wall still visible to its left '
    + 'and right. Do not block doors, windows or the fireplace, and do not hang anything on the walls unless asked. If '
    + 'the change is to remove something, take out only that and show the floor and wall that were behind it. ' + KEEP;
}

// ---- the panorama as directions ---------------------------------------------------------------------------------
// Column u looks along yaw=(u+0.5)/W*2pi-pi, row v along pitch=pi/2-(v+0.5)/H*pi; a direction is
// (sin(yaw)cos(pitch), sin(pitch), cos(yaw)cos(pitch)).

/** A perspective camera's right, up and forward in panorama directions. */
function cameraAxes(yawDeg, pitchDeg) {
  const yaw = yawDeg * Math.PI / 180, pitch = pitchDeg * Math.PI / 180;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  return { right: [cy, 0, -sy], up: [-sp * sy, cp, -sp * cy], forward: [cp * sy, sp, cp * cy] };
}

/** Reads an equirect panorama as { data: RGB bytes, width, height }. */
export async function readPano(file) {
  const { data, info } = await sharp(file).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * One ordinary photo cut from the panorama: what a camera with this aim would see. `focal` is in pixels.
 * Returns RGB bytes, width * height * 3.
 */
export function cutView(pano, yawDeg, pitchDeg, width, height, focal) {
  const { right, up, forward } = cameraAxes(yawDeg, pitchDeg);
  const { data, width: W, height: H } = pano;
  const out = new Uint8Array(width * height * 3);
  for (let j = 0, o = 0; j < height; j++) {
    const y = (height / 2 - j - 0.5) / focal;
    for (let i = 0; i < width; i++, o += 3) {
      const x = (i + 0.5 - width / 2) / focal;
      const dx = right[0] * x + up[0] * y + forward[0], dy = right[1] * x + up[1] * y + forward[1], dz = right[2] * x + up[2] * y + forward[2];
      const u = (Math.atan2(dx, dz) + Math.PI) / (2 * Math.PI) * W - 0.5;
      const v = Math.min(Math.max((Math.PI / 2 - Math.atan2(dy, Math.hypot(dx, dz))) / Math.PI * H - 0.5, 0), H - 1);
      const u0 = Math.floor(u), v0 = Math.floor(v), fu = u - u0, fv = v - v0;
      const ua = ((u0 % W) + W) % W, ub = (ua + 1) % W, vb = Math.min(v0 + 1, H - 1);
      const a = (v0 * W + ua) * 3, b = (v0 * W + ub) * 3, c = (vb * W + ua) * 3, d = (vb * W + ub) * 3;
      for (let k = 0; k < 3; k++) {
        out[o + k] = (data[a + k] * (1 - fu) + data[b + k] * fu) * (1 - fv) + (data[c + k] * (1 - fu) + data[d + k] * fu) * fv + 0.5;
      }
    }
  }
  return out;
}

/** What the call shows: 60 degrees tall, like the tour's own camera. Writes a JPEG; for checking results by eye. */
export async function renderView(panoFile, yawDeg, pitchDeg, outFile, width = 1280, height = 720, vfov = 60, quality = 88) {
  const pano = await readPano(panoFile);
  const focal = (height / 2) / Math.tan(vfov * Math.PI / 360);
  await sharp(Buffer.from(cutView(pano, yawDeg, pitchDeg, width, height, focal)), { raw: { width, height, channels: 3 } })
    .jpeg({ quality }).toFile(outFile);
  return outFile;
}

// ---- making the edited photo agree with the real one ----------------------------------------------------------

/**
 * Image services redraw the whole frame and tend to nudge it a few pixels. Finds the shift that best lines the top
 * of the frame (ceiling and upper walls, which staging leaves alone) back up. Returns [right, down] in pixels.
 */
function findShift(real, redrawn, width, height, reach = 48) {
  const step = 4, w = Math.floor(width / step), h = Math.floor(height * 0.4 / step), r = reach / step;
  const grey = (rgb) => {
    const g = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const p = (j * step * width + i * step) * 3;
      g[j * w + i] = (rgb[p] + rgb[p + 1] + rgb[p + 2]) / 3;
    }
    return g;
  };
  const a = grey(real), b = grey(redrawn);
  let best = Infinity, shift = [0, 0];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, dy); j < h + Math.min(0, dy); j += 2) for (let i = Math.max(0, dx); i < w + Math.min(0, dx); i += 2) {
      sum += Math.abs(a[j * w + i] - b[(j - dy) * w + i - dx]); count++;
    }
    const score = sum / count + 0.002 * (Math.abs(dx) + Math.abs(dy));      // prefer no shift when it makes no difference
    if (score < best) { best = score; shift = [dx * step, dy * step]; }
  }
  return shift;
}

/**
 * The image model often shifts brightness or white balance a little, which would show as a tinted rectangle once
 * the photo is laid back. Works out, cell by cell, the gain per channel that brings the redrawn photo back to the
 * real one where the room is unchanged, fills in the cells that did change (furniture) from their neighbours, and
 * returns a smooth gain map: { cols, rows, gain: Float32Array(cols * rows * 3) }.
 */
function colourGains(real, redrawn, width, height, cols = 24, rows = 16) {
  const cw = width / cols, ch = height / rows, n = cols * rows;
  const gain = new Float32Array(n * 3).fill(1), known = new Uint8Array(n);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const sumA = [0, 0, 0], sumB = [0, 0, 0];
    let differs = 0, count = 0;
    for (let j = Math.floor(r * ch); j < Math.floor((r + 1) * ch); j += 2) for (let i = Math.floor(c * cw); i < Math.floor((c + 1) * cw); i += 2) {
      const p = (j * width + i) * 3;
      const d = Math.abs(real[p] - redrawn[p]) + Math.abs(real[p + 1] - redrawn[p + 1]) + Math.abs(real[p + 2] - redrawn[p + 2]);
      if (d > 90) differs++;
      for (let k = 0; k < 3; k++) { sumA[k] += real[p + k]; sumB[k] += redrawn[p + k]; }
      count++;
    }
    const g = sumA.map((s, k) => (s + count) / (sumB[k] + count));
    if (differs / count < 0.08 && g.every((value) => value > 0.8 && value < 1.25)) {
      known[r * cols + c] = 1;
      for (let k = 0; k < 3; k++) gain[(r * cols + c) * 3 + k] = g[k];
    }
  }
  // Fill the cells that changed from the ones that did not, then smooth the lot.
  let filled = Float32Array.from(known);
  for (let pass = 0; pass < cols; pass++) {
    const next = new Float32Array(gain), nextFilled = new Float32Array(filled);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const at = r * cols + c;
      if (known[at]) continue;
      const sum = [0, 0, 0];
      let weight = 0;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols || !filled[rr * cols + cc]) continue;
        for (let k = 0; k < 3; k++) sum[k] += gain[(rr * cols + cc) * 3 + k];
        weight++;
      }
      if (weight) { for (let k = 0; k < 3; k++) next[at * 3 + k] = sum[k] / weight; nextFilled[at] = 1; }
    }
    gain.set(next); filled = nextFilled;
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(gain);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) for (let k = 0; k < 3; k++) {
      let sum = 0, weight = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        sum += gain[(rr * cols + cc) * 3 + k]; weight++;
      }
      next[(r * cols + c) * 3 + k] = sum / weight;
    }
    gain.set(next);
  }
  return { cols, rows, gain };
}

/**
 * The redrawn photo moved back into place and colour-matched to the real one, as floats (width * height * 3).
 * Also reports what was undone: { photo, shift: [right, down], gain: [r, g, b] mean }.
 */
export function settle(real, redrawn, width, height) {
  const [dx, dy] = findShift(real, redrawn, width, height);
  const moved = new Uint8Array(redrawn.length);
  for (let j = 0; j < height; j++) {
    const sj = Math.min(Math.max(j - dy, 0), height - 1);
    for (let i = 0; i < width; i++) {
      const si = Math.min(Math.max(i - dx, 0), width - 1), from = (sj * width + si) * 3, to = (j * width + i) * 3;
      moved[to] = redrawn[from]; moved[to + 1] = redrawn[from + 1]; moved[to + 2] = redrawn[from + 2];
    }
  }
  const { cols, rows, gain } = colourGains(real, moved, width, height);
  const photo = new Float32Array(moved.length), mean = [0, 0, 0];
  for (let j = 0; j < height; j++) {
    const gy = Math.min(Math.max((j + 0.5) / height * rows - 0.5, 0), rows - 1), r0 = Math.floor(gy), r1 = Math.min(r0 + 1, rows - 1), fy = gy - r0;
    for (let i = 0; i < width; i++) {
      const gx = Math.min(Math.max((i + 0.5) / width * cols - 0.5, 0), cols - 1), c0 = Math.floor(gx), c1 = Math.min(c0 + 1, cols - 1), fx = gx - c0;
      const p = (j * width + i) * 3;
      for (let k = 0; k < 3; k++) {
        const g = (gain[(r0 * cols + c0) * 3 + k] * (1 - fx) + gain[(r0 * cols + c1) * 3 + k] * fx) * (1 - fy)
          + (gain[(r1 * cols + c0) * 3 + k] * (1 - fx) + gain[(r1 * cols + c1) * 3 + k] * fx) * fy;
        photo[p + k] = moved[p + k] * g;
      }
    }
  }
  for (let at = 0; at < cols * rows; at++) for (let k = 0; k < 3; k++) mean[k] += gain[at * 3 + k] / (cols * rows);
  return { photo, shift: [dx, dy], gain: mean.map((value) => Math.round(value * 1000) / 1000) };
}

/**
 * Where the redrawn photo really differs from the real one (the furniture and its shadows), grown and softened.
 * Only those parts are taken from the redrawn photo; everything the model merely redrew stays the real scan, so
 * the room keeps its sharpness and a chain of edits does not slowly repaint it. Returns { cols, rows, mask } with
 * mask 0 (keep the real panorama) to 1 (take the redrawn photo), one value per `cell` x `cell` pixels.
 */
export function changeMask(real, photo, width, height, cell = 4, threshold = 15, grow = 14, shrink = 6, soften = 4) {
  const cols = Math.floor(width / cell), rows = Math.floor(height / cell), n = cols * rows;
  let mask = new Float32Array(n);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = [0, 0, 0], b = [0, 0, 0];
    for (let j = r * cell; j < (r + 1) * cell; j++) for (let i = c * cell; i < (c + 1) * cell; i++) {
      const p = (j * width + i) * 3;
      for (let k = 0; k < 3; k++) { a[k] += real[p + k]; b[k] += photo[p + k]; }
    }
    mask[r * cols + c] = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) / (cell * cell);
  }
  // A filter along rows then columns: `pick` is Math.min (shrink), Math.max (grow) or null (average).
  const sweep = (source, radius, pick) => {
    let from = source;
    for (const [count, other, stride, line] of [[cols, rows, 1, cols], [rows, cols, cols, 1]]) {
      const to = new Float32Array(n);
      for (let o = 0; o < other; o++) for (let i = 0; i < count; i++) {
        let value = pick ? from[o * line + i * stride] : 0, used = 0;
        for (let t = Math.max(0, i - radius); t <= Math.min(count - 1, i + radius); t++) {
          const sample = from[o * line + t * stride];
          if (pick) value = pick(value, sample); else { value += sample; used++; }
        }
        to[o * line + i * stride] = pick ? value : value / used;
      }
      from = to;
    }
    return from;
  };
  mask = sweep(mask, 1, null).map((difference) => (difference > threshold ? 1 : 0));   // averaging first ignores redrawn texture
  mask = sweep(sweep(mask, grow, Math.max), shrink, Math.min);  // growing then shrinking closes holes (a rug the floor's colour)
  mask = sweep(sweep(mask, soften, null), soften, null);
  return { cols, rows, mask };
}

/**
 * Puts a (staged) wide photo back onto the panorama. The panorama takes the photo's pixels where `change` (from
 * changeMask) says the photo differs, fading to the real panorama over the photo's outer edge; everywhere else the
 * panorama is left exactly as it was. Returns new RGB bytes.
 */
export function layBack(pano, photo, change, yawDeg, pitchDeg, width, height, focal, feather = FEATHER) {
  const { cols, rows, mask } = change;
  const { right, up, forward } = cameraAxes(yawDeg, pitchDeg);
  const { data, width: W, height: H } = pano;
  const out = Buffer.from(data);
  const sinYaw = new Float64Array(W), cosYaw = new Float64Array(W);
  for (let u = 0; u < W; u++) { const yaw = (u + 0.5) / W * 2 * Math.PI - Math.PI; sinYaw[u] = Math.sin(yaw); cosYaw[u] = Math.cos(yaw); }
  for (let v = 0; v < H; v++) {
    const pitch = Math.PI / 2 - (v + 0.5) / H * Math.PI, sp = Math.sin(pitch), cp = Math.cos(pitch);
    for (let u = 0; u < W; u++) {
      const dx = sinYaw[u] * cp, dz = cosYaw[u] * cp;
      const z = dx * forward[0] + sp * forward[1] + dz * forward[2];
      if (z < 0.05) continue;
      const x = (dx * right[0] + dz * right[2]) / z * focal + width / 2 - 0.5;
      const y = height / 2 - (dx * up[0] + sp * up[1] + dz * up[2]) / z * focal - 0.5;
      if (x < 0 || x > width - 1 || y < 0 || y > height - 1) continue;
      let weight = Math.min(Math.min(x, width - 1 - x) / (width * feather), Math.min(y, height - 1 - y) / (height * feather), 1);
      if (weight <= 0) continue;
      const mx = Math.min(Math.max((x + 0.5) / width * cols - 0.5, 0), cols - 1), my = Math.min(Math.max((y + 0.5) / height * rows - 0.5, 0), rows - 1);
      const c0 = Math.floor(mx), r0 = Math.floor(my), c1 = Math.min(c0 + 1, cols - 1), r1 = Math.min(r0 + 1, rows - 1), tx = mx - c0, ty = my - r0;
      const changed = (mask[r0 * cols + c0] * (1 - tx) + mask[r0 * cols + c1] * tx) * (1 - ty) + (mask[r1 * cols + c0] * (1 - tx) + mask[r1 * cols + c1] * tx) * ty;
      weight = weight * weight * (3 - 2 * weight) * changed;
      if (weight < 0.004) continue;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
      const a = (y0 * width + x0) * 3, b = (y0 * width + x1) * 3, c = (y1 * width + x0) * 3, d = (y1 * width + x1) * 3, o = (v * W + u) * 3;
      for (let k = 0; k < 3; k++) {
        const staged = (photo[a + k] * (1 - fx) + photo[b + k] * fx) * (1 - fy) + (photo[c + k] * (1 - fx) + photo[d + k] * fx) * fy;
        out[o + k] = Math.min(Math.max(data[o + k] * (1 - weight) + staged * weight + 0.5, 0), 255);
      }
    }
  }
  return out;
}

/** The whole way back: the redrawn photo settled onto the real one, and the parts that changed laid onto the panorama. */
export function compose(pano, real, redrawn, yawDeg, pitchDeg) {
  const { width, height, hfov } = VIEW, focal = (width / 2) / Math.tan(hfov * Math.PI / 360);
  const settled = settle(real, redrawn, width, height);
  const change = changeMask(real, settled.photo, width, height);
  return { staged: layBack(pano, settled.photo, change, yawDeg, pitchDeg, width, height, focal), settled, change };
}

// ---- the image service ------------------------------------------------------------------------------------------

/** One paid call: the photo (JPEG bytes) and the instruction in, the edited photo's bytes out. */
async function editPhoto(jpeg, prompt, timeoutMs) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Staging needs OPENAI_API_KEY in the environment');
  const body = {
    model: MODEL, prompt, n: 1, size: `${VIEW.width}x${VIEW.height}`, quality: QUALITY, output_format: 'jpeg', output_compression: 92,
    images: [{ image_url: `data:image/jpeg;base64,${jpeg.toString('base64')}` }],
  };
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {                                    // never echo the request, it carries the key
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error(`Staging timed out after ${timeoutMs / 1000} s`);
    throw new Error(`Staging could not reach the image service (${error.cause?.code || error.name})`);
  }
  let payload;
  try { payload = await response.json(); }
  catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error(`Staging timed out after ${timeoutMs / 1000} s`);
    payload = {};
  }
  if (!response.ok) {
    const { code, type, message } = payload.error || {};
    const why = response.status === 401 ? 'the API key was not accepted' : String(message || '').slice(0, 300);   // a 401 message quotes part of the key
    throw new Error(`The image service refused the staging request (HTTP ${response.status}${code || type ? `, ${code || type}` : ''}): ${why}`);
  }
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded) throw new Error('The image service returned no image');
  return { image: Buffer.from(encoded, 'base64'), usage: payload.usage };
}

// ---- the two things the guide uses ---------------------------------------------------------------------------------

const underway = new Map();                             // cache file -> promise, so a repeated request waits for the first

/**
 * Edits what the camera faces at one standpoint and lays the result back onto the panorama.
 * @param {object} o
 * @param {string} o.source   absolute path of the equirect panorama to start from (the real scan, or an earlier staged result, so edits can chain: "now remove the rug")
 * @param {number} o.yaw      panorama yaw in degrees the camera faces (centre of the edit)
 * @param {number} o.pitch    degrees
 * @param {string} o.request  what the caller asked for, in plain words
 * @param {string} o.name     short slug for the cache file
 * @param {string} [o.outDir] folder the result is written to and looked up in (default media/staged)
 * @param {number} [o.timeoutMs]  how long to wait for the image service (default 90 s)
 * @returns {Promise<{ file: string, cached: boolean, seconds: number }>}  file = absolute path of the staged equirect panorama (webp, same size as source)
 */
export async function stagePano({ source, yaw, pitch, request, name, outDir = stagedDir, timeoutMs = TIMEOUT_MS }) {
  const started = performance.now();
  const seconds = () => Math.round((performance.now() - started) / 100) / 10;
  if (!request?.trim()) throw new Error('Staging needs a request');
  const bytes = await readFile(source);
  // The edit camera stays near level, so the photo always has floor to stand furniture on.
  const aim = { yaw: Math.round((((yaw % 360) + 540) % 360 - 180) * 10) / 10, pitch: Math.min(Math.max(Math.round(pitch), -25), 5) };
  // One photo in, one out. Giving the model a second, already furnished photo to copy from made it redraw the walls.
  const prompt = stagingPrompt(request);
  const sha = (data) => createHash('sha256').update(data).digest('hex');
  const key = sha(JSON.stringify([
    sha(bytes), aim.yaw, aim.pitch, prompt.toLowerCase().replace(/\s+/g, ' '), MODEL, QUALITY, VIEW,
  ])).slice(0, 10);
  const slug = String(name || 'staged').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'staged';
  // The same request under another name is still the same picture.
  const made = (await readdir(outDir).catch(() => [])).find((entry) => entry.endsWith(`-${key}.webp`));
  if (made) return { file: path.join(outDir, made), cached: true, seconds: seconds() };
  const file = path.join(outDir, `${slug}-${key}.webp`);
  if (underway.has(file)) return { ...(await underway.get(file)), seconds: seconds() };

  const work = (async () => {
    const pano = await readPano(bytes);
    const { width, height, hfov } = VIEW, focal = (width / 2) / Math.tan(hfov * Math.PI / 360);
    const real = cutView(pano, aim.yaw, aim.pitch, width, height, focal);
    const sent = await sharp(Buffer.from(real), { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
    // With STAGE_PHOTO_DIR set, the photo the image model returned is kept there, so the lay-back can be redone
    // without paying for it again. Off by default: the photos are only for working on this file.
    const kept = process.env.STAGE_PHOTO_DIR && path.join(process.env.STAGE_PHOTO_DIR, `${key}.jpg`);
    let image = kept ? await readFile(kept).catch(() => null) : null, usage, service = 0;
    const paid = !image;
    if (paid) {
      const asked = performance.now();
      ({ image, usage } = await editPhoto(sent, prompt, timeoutMs));
      service = Math.round((performance.now() - asked) / 100) / 10;
      if (kept) await writeFile(kept, image);
    }
    const redrawn = await sharp(image).removeAlpha().toColourspace('srgb').resize(width, height, { fit: 'fill' }).raw().toBuffer();
    const { staged, settled } = compose(pano, real, redrawn, aim.yaw, aim.pitch);
    await mkdir(outDir, { recursive: true });
    const draft = `${file}.${process.pid}.tmp`;
    await sharp(staged, { raw: { width: pano.width, height: pano.height, channels: 3 } }).webp({ quality: 88, effort: 2 }).toFile(draft);
    await rename(draft, file);
    if (paid) await appendFile(path.join(outDir, 'generations.jsonl'), `${JSON.stringify({
      at: new Date().toISOString(), file: path.basename(file), request, ...aim, model: MODEL, quality: QUALITY,
      serviceSeconds: service, seconds: seconds(), shift: settled.shift, gain: settled.gain, usage,
    })}\n`).catch(() => {});
    return { file, cached: !paid };
  })();
  underway.set(file, work);
  try { return { ...(await work), seconds: seconds() }; }
  finally { underway.delete(file); }
}

/**
 * Pre-generated results: { [stopKey]: [{ id, label, request, file, yaw, pitch }] } read from index.json in `dir`
 * (default media/staged; another property passes its own folder). Empty object when there is none.
 */
export async function loadPresets(dir = stagedDir) {
  let index;
  try { index = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  const presets = {};
  for (const [stop, list] of Object.entries(index)) {
    presets[stop] = list.map((preset) => ({ ...preset, file: path.join(dir, preset.file) }));
  }
  return presets;
}
