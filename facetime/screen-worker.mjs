// Draws the tour picture the caller sees on FaceTime, off the agent's main thread so the voice never stutters.
// One frame is WIDTH x HEIGHT RGBA. The picture follows the shared tour view (shared/tour.mjs):
//   interior  a slow pan inside the Matterport panorama of the current stop, with the chosen wall finish
//   site      the Vexcel aerial with the scan location and the parking row marked
//   plan      the floor plan measured from the Matterport scan
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';
import { finishes } from '../shared/tour.mjs';

const { width: W, height: H, fps, mediaDir } = workerData;
const N = W * H;
const S = W / 1280;                       // every size below is drawn for 1280 x 720 and scaled
const FOV = 60 * Math.PI / 180;           // vertical field of view, the same as the posters
const tour = JSON.parse(await readFile(join(mediaDir, 'tour.json'), 'utf8'));

// ---- images ---------------------------------------------------------------------------------------------------------

async function pixels(input, resize) {
  let image = sharp(input);
  if (resize) image = image.resize(resize);
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return { data: new Uint32Array(copy.buffer), width: info.width, height: info.height };
}

const esc = text => String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const svg = body => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 1280 720">${body}</svg>`);
const SANS = 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif"';
const SERIF = 'font-family="Georgia, Times New Roman, serif"';

/** The lower third: where we are, what it is, and which data layer the picture comes from. */
function caption({ title, detail, source, chip }) {
  const chipWidth = chip ? 64 + chip.label.length * 11.5 : 0;
  return `
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.72"/>
    </linearGradient></defs>
    <rect x="0" y="470" width="1280" height="250" fill="url(#shade)"/>
    <g ${SANS} text-anchor="middle">
      <rect x="${640 - 235}" y="26" width="470" height="40" rx="20" fill="#0d1413" fill-opacity="0.62"/>
      <circle cx="${640 - 207}" cy="46" r="6" fill="#ff5a4e"/>
      <text x="648" y="53" font-size="19" font-weight="500" fill="#fff" letter-spacing="0.4">The Parker at Ellington · A5 · 1 bed 1 bath</text>
      ${chip ? `<rect x="${640 - chipWidth / 2}" y="528" width="${chipWidth}" height="42" rx="21" fill="#fff" fill-opacity="0.94"/>
      <circle cx="${640 - chipWidth / 2 + 24}" cy="549" r="11" fill="${chip.color}" stroke="#0d1413" stroke-opacity="0.25"/>
      <text x="${640 + 14}" y="556" font-size="20" font-weight="600" fill="#0d1413">${esc(chip.label)}</text>` : ''}
      <text x="640" y="628" ${SERIF} font-size="54" fill="#fff">${esc(title)}</text>
      <text x="640" y="662" font-size="22" fill="#fff" fill-opacity="0.9">${esc(detail)}</text>
      <text x="640" y="694" font-size="14" font-weight="600" fill="#fff" fill-opacity="0.7" letter-spacing="2.4">${esc(source.toUpperCase())}</text>
    </g>`;
}

const overlays = new Map();
async function overlay(key, body) {
  if (!overlays.has(key)) overlays.set(key, (await pixels(svg(body))).data);
  return overlays.get(key);
}

const panos = new Map();
async function pano(name) {
  if (!panos.has(name)) panos.set(name, await pixels(join(mediaDir, `${name}.webp`)));
  return panos.get(name);
}

/** The aerial, enlarged to fill the frame, with the scan location, the parking row and the line between them. */
let sitePicture = null;
const siteImage = () => sitePicture ??= drawSite();
async function drawSite() {
  const { site, property } = tour;
  const scale = Math.max(W / site.size[0], H / site.size[1]);
  const width = Math.round(site.size[0] * scale), height = Math.round(site.size[1] * scale);
  const middle = (site.anchor[1] + site.parking[1]) / 2 * height;
  const top = Math.round(Math.min(Math.max(middle - H * 0.45, 0), height - H));
  const left = Math.round((width - W) / 2);
  const base = await sharp(join(mediaDir, 'site.webp')).resize(width, height, { kernel: 'lanczos3' })
    .extract({ left, top, width: W, height: H }).toBuffer();
  const point = ([x, y]) => [(x * width - left) / S, (y * height - top) / S];
  const [ax, ay] = point(site.anchor), [px, py] = point(site.parking);
  const covered = property.covered_parking ? ' · covered parking on site' : '';
  const marks = `
    <g ${SANS}>
      <line x1="${ax}" y1="${ay}" x2="${px}" y2="${py}" stroke="#fff" stroke-width="4" stroke-dasharray="3 9" stroke-linecap="round"/>
      <circle cx="${ax}" cy="${ay}" r="26" fill="#ff5a4e" fill-opacity="0.25"/>
      <circle cx="${ax}" cy="${ay}" r="11" fill="#ff5a4e" stroke="#fff" stroke-width="4"/>
      <circle cx="${px}" cy="${py}" r="11" fill="#2f6bff" stroke="#fff" stroke-width="4"/>
      <g text-anchor="end"><rect x="${ax - 222}" y="${ay - 64}" width="204" height="38" rx="19" fill="#0d1413" fill-opacity="0.82"/>
        <text x="${ax - 40}" y="${ay - 38}" font-size="20" font-weight="600" fill="#fff">A5 · scanned unit</text></g>
      <g text-anchor="end"><rect x="${px - 240}" y="${py + 24}" width="262" height="38" rx="19" fill="#0d1413" fill-opacity="0.82"/>
        <text x="${px + 2}" y="${py + 50}" font-size="20" font-weight="600" fill="#fff">Parking row · about ${site.distanceFt} ft</text></g>
    </g>`;
  const image = await pixels(await sharp(base).composite([{ input: svg(marks) }]).toBuffer());
  const layer = await overlay('site', caption({
    title: 'Parking and arrival',
    detail: `${property.parking_spaces} spaces community-wide${covered}`,
    source: 'Vexcel aerial · CoStar record · Matterport geolocation',
  }));
  return { ...image, layer, focus: [(ax + px) / 2 * S, (ay + py) / 2 * S] };
}

/** The floor plan from the scan's room boundaries, with the current room and the planned route marked. */
async function planImage(view) {
  const rooms = tour.rooms;
  const all = rooms.flatMap(room => room.polygon);
  const minX = Math.min(...all.map(p => p[0])), maxX = Math.max(...all.map(p => p[0]));
  const minY = Math.min(...all.map(p => p[1])), maxY = Math.max(...all.map(p => p[1]));
  const scale = Math.min(1000 / (maxX - minX), 470 / (maxY - minY));
  const ox = 640 - (maxX + minX) / 2 * scale, oy = 322 + (maxY + minY) / 2 * scale;
  const at = ([x, y]) => [ox + x * scale, oy - y * scale];
  const here = tour.stops[view.stop]?.roomId;
  const sweeps = new Map(tour.sweeps.map(sweep => [sweep.id, at([sweep.x, sweep.y])]));
  const shapes = rooms.map(room => {
    const points = room.polygon.map(at);
    const cx = (Math.min(...points.map(p => p[0])) + Math.max(...points.map(p => p[0]))) / 2;
    const cy = (Math.min(...points.map(p => p[1])) + Math.max(...points.map(p => p[1]))) / 2;
    const current = room.id === here;
    const small = room.area_sqft < 40;
    return `<polygon points="${points.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}"
        fill="${current ? '#dfe8d6' : '#f6f5ef'}" stroke="#0d1413" stroke-width="5" stroke-linejoin="round"/>
      <text x="${cx}" y="${cy - (small ? -5 : 2)}" font-size="${small ? 13 : 19}" font-weight="600" fill="#0d1413">${esc(room.type)}</text>
      ${small ? '' : `<text x="${cx}" y="${cy + 22}" font-size="16" fill="#0d1413" fill-opacity="0.62">${Math.round(room.area_sqft)} sq ft</text>`}`;
  }).join('');
  const route = (view.path ?? []).map(leg => `<polyline points="${leg.map(id => sweeps.get(id)).filter(Boolean)
    .map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#ff5a4e" stroke-width="6"
    stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 13"/>`).join('');
  const stop = sweeps.get(tour.stops[view.stop]?.sweep);
  const { floor } = tour;
  return pixels(svg(`<rect width="1280" height="720" fill="#18211f"/>
    <g ${SANS} text-anchor="middle">${shapes}${route}
      ${stop ? `<circle cx="${stop[0]}" cy="${stop[1]}" r="20" fill="#ff5a4e" fill-opacity="0.25"/>
      <circle cx="${stop[0]}" cy="${stop[1]}" r="9" fill="#ff5a4e" stroke="#fff" stroke-width="3"/>` : ''}
    </g>` + caption({
    title: 'Floor plan',
    detail: `${floor.minSquareFeet} sq ft listed · ${Math.round(floor.scanAreaSqft)} sq ft measured indoors`,
    source: 'Matterport scan · CoStar A5 listing',
  })));
}

// ---- panorama camera -------------------------------------------------------------------------------------------------

/** For a camera pitched by `pitch`, where each frame pixel lands in the panorama when the camera faces yaw 0. */
const lookups = new Map();
function lookup(pitch, pw, ph) {
  const key = `${pitch}:${pw}:${ph}`;
  if (lookups.has(key)) return lookups.get(key);
  const u = new Float32Array(N), row0 = new Int32Array(N), row1 = new Int32Array(N), fy = new Uint16Array(N);
  const tan = Math.tan(FOV / 2), sin = Math.sin(pitch), cos = Math.cos(pitch);
  for (let y = 0, i = 0; y < H; y++) {
    const ny = (H / 2 - y - 0.5) / (H / 2) * tan;
    const up = ny * cos + sin, forward = cos - ny * sin;
    for (let x = 0; x < W; x++, i++) {
      const nx = (x + 0.5 - W / 2) / (H / 2) * tan;
      const lon = Math.atan2(nx, forward), lat = Math.atan2(up, Math.hypot(nx, forward));
      u[i] = (lon + Math.PI) / (2 * Math.PI) * pw;
      const v = Math.min(Math.max((Math.PI / 2 - lat) / Math.PI * ph - 0.5, 0), ph - 1.001);
      const top = Math.floor(v);
      row0[i] = top * pw; row1[i] = (top + 1) * pw; fy[i] = Math.round((v - top) * 256);
    }
  }
  const table = { u, row0, row1, fy };
  lookups.set(key, table);
  return table;
}

/** One camera frame from a panorama, smoothed between neighbouring pixels so a slow pan does not shimmer. */
function drawPano(out, source, table, yaw) {
  const { data, width: pw } = source, { u, row0, row1, fy } = table;
  let shift = (yaw / (2 * Math.PI) * pw - 0.5) % pw;
  if (shift < 0) shift += pw;
  for (let i = 0; i < N; i++) {
    let x = u[i] + shift;
    if (x >= pw) x -= pw;
    const x0 = x | 0, fx = ((x - x0) * 256) | 0, x1 = x0 + 1 === pw ? 0 : x0 + 1;
    const a = data[row0[i] + x0], b = data[row0[i] + x1], c = data[row1[i] + x0], d = data[row1[i] + x1];
    const gx = 256 - fx, f = fy[i], g = 256 - f;
    const topRB = (((a & 0xff00ff) * gx + (b & 0xff00ff) * fx) >>> 8) & 0xff00ff;
    const topG = (((a & 0x00ff00) * gx + (b & 0x00ff00) * fx) >>> 8) & 0x00ff00;
    const lowRB = (((c & 0xff00ff) * gx + (d & 0xff00ff) * fx) >>> 8) & 0xff00ff;
    const lowG = (((c & 0x00ff00) * gx + (d & 0x00ff00) * fx) >>> 8) & 0x00ff00;
    out[i] = 0xff000000 | (((topRB * g + lowRB * f) >>> 8) & 0xff00ff) | (((topG * g + lowG * f) >>> 8) & 0x00ff00);
  }
}

/** A still image with a slow push-in, so the picture stays alive. */
function drawStill(out, image, zoom, cx, cy) {
  if (zoom <= 1.0005) { out.set(image.data); return; }
  const data = image.data, step = 1 / zoom;
  const left = Math.min(Math.max(cx - W / 2 * step, 0), W - W * step), top = Math.min(Math.max(cy - H / 2 * step, 0), H - H * step);
  for (let y = 0, i = 0; y < H; y++) {
    const v = Math.min(top + y * step, H - 1.001), y0 = v | 0, f = ((v - y0) * 256) | 0, g = 256 - f;
    const r0 = y0 * W, r1 = r0 + W;
    for (let x = 0; x < W; x++, i++) {
      const h = Math.min(left + x * step, W - 1.001), x0 = h | 0, fx = ((h - x0) * 256) | 0, gx = 256 - fx;
      const a = data[r0 + x0], b = data[r0 + x0 + 1], c = data[r1 + x0], d = data[r1 + x0 + 1];
      const topRB = (((a & 0xff00ff) * gx + (b & 0xff00ff) * fx) >>> 8) & 0xff00ff;
      const topG = (((a & 0x00ff00) * gx + (b & 0x00ff00) * fx) >>> 8) & 0x00ff00;
      const lowRB = (((c & 0xff00ff) * gx + (d & 0xff00ff) * fx) >>> 8) & 0xff00ff;
      const lowG = (((c & 0x00ff00) * gx + (d & 0x00ff00) * fx) >>> 8) & 0x00ff00;
      out[i] = 0xff000000 | (((topRB * g + lowRB * f) >>> 8) & 0xff00ff) | (((topG * g + lowG * f) >>> 8) & 0x00ff00);
    }
  }
}

function mix(under, over, amount) {         // amount 0..256 of `over`
  const rest = 256 - amount;
  return 0xff000000 | ((((under & 0xff00ff) * rest + (over & 0xff00ff) * amount) >>> 8) & 0xff00ff)
    | ((((under & 0x00ff00) * rest + (over & 0x00ff00) * amount) >>> 8) & 0x00ff00);
}

function drawOverlay(out, layer) {
  for (let i = 0; i < N; i++) {
    const pixel = layer[i], alpha = pixel >>> 24;
    if (alpha === 0) continue;
    out[i] = alpha === 255 ? pixel : mix(out[i], pixel, alpha + (alpha >> 7));
  }
}

// ---- scenes ----------------------------------------------------------------------------------------------------------

const ease = t => 1 - (1 - t) ** 3;
const DEG = Math.PI / 180;

/** What to draw for a tour view. Scenes with the same `place` are the same camera, so a change between them wipes. */
async function sceneFor(view) {
  if (view.mode === 'site') return { place: 'site', kind: 'still', image: await siteImage(), push: 0.08 };
  if (view.mode === 'plan') return { place: `plan:${view.stop}:${view.route.join('>')}`, kind: 'still', image: await planImage(view) };
  const stop = tour.stops[view.stop];
  const painted = view.stop === 'living' && view.finish !== 'original';
  const source = await pano(painted ? `living-${view.finish}` : view.stop);
  const finish = finishes[view.finish];
  return {
    place: `stop:${view.stop}`, kind: 'pano', source, yaw: stop.yaw * DEG,
    sway: (view.stop === 'living' ? 5 : 8) * DEG,
    table: lookup(stop.pitch * DEG, source.width, source.height),
    layer: await overlay(`stop:${view.stop}:${painted ? view.finish : ''}`, caption({
      title: stop.label, detail: stop.detail,
      source: painted ? 'Blender paint preview on the Matterport scan' : 'Matterport scan',
      chip: painted ? { label: `Paint preview · ${finish.label}`, color: finish.color } : null,
    })),
  };
}

let scene = null, since = 0;                  // the scene on screen and when its camera started
let previous = null, change = null;           // the last frame of the scene before, and how it gives way
let last = null;

function drawScene(out, now) {
  const t = (now - since) / 1000;
  if (scene.kind === 'pano') {
    const arrive = t < 2.6 ? (1 - ease(t / 2.6)) * -11 * DEG : 0;
    drawPano(out, scene.source, scene.table, scene.yaw + arrive + Math.sin(t / 19 * 2 * Math.PI) * scene.sway);
    drawOverlay(out, scene.layer);
  } else if (scene.push) {
    drawStill(out, scene.image, 1 + scene.push * ease(Math.min(t / 14, 1)), W / 2, scene.image.focus[1]);
    drawOverlay(out, scene.image.layer);
  } else {
    drawStill(out, scene.image, 1, 0, 0);
  }
}

const canvas = new Uint32Array(N);
function render(now) {
  const out = canvas;
  drawScene(out, now);
  if (change) {
    const p = (now - change.start) / change.length;
    if (p >= 1) change = null;
    else if (change.kind === 'fade') {
      const amount = Math.round(ease(p) * 256);
      for (let i = 0; i < N; i++) out[i] = mix(previous[i], out[i], amount);
    } else {
      // A soft-edged wipe from left to right: the new finish rolls across the wall.
      const soft = 90 * S, edge = ease(p) * (W + soft) - soft;
      for (let x = 0; x < W; x++) {
        const amount = Math.round(Math.min(Math.max((edge + soft - x) / soft, 0), 1) * 256);
        if (amount === 256) continue;
        for (let i = x; i < N; i += W) out[i] = amount === 0 ? previous[i] : mix(previous[i], out[i], amount);
      }
    }
  }
  last = out;
}

async function show(view) {
  const next = await sceneFor(view);
  const now = performance.now();
  if (scene && last) {
    previous = (previous?.length === N ? previous : new Uint32Array(N));
    previous.set(last);
    const samePlace = next.place === scene.place;
    change = { kind: samePlace ? 'wipe' : 'fade', start: now, length: samePlace ? 1500 : 700 };
    if (!samePlace || next.kind !== 'pano') since = now;
  } else {
    since = now;
  }
  scene = next;
}

// ---- the loop --------------------------------------------------------------------------------------------------------

let timer = null, pending = Promise.resolve();
function tick() {
  if (!scene) return;
  render(performance.now());
  const copy = new Uint8Array(N * 4);
  copy.set(new Uint8Array(canvas.buffer));
  parentPort.postMessage({ type: 'frame', data: copy.buffer }, [copy.buffer]);
}

parentPort.on('message', message => {
  if (message.type === 'view') pending = pending.then(() => show(message.view)).catch(error => parentPort.postMessage({ type: 'error', message: String(error?.stack ?? error) }));
  if (message.type === 'play' && !timer) timer = setInterval(tick, 1000 / fps);
  if (message.type === 'pause' && timer) { clearInterval(timer); timer = null; }
});

// Load every picture before the first call, so no change on a call waits on a file.
await Promise.all([...Object.keys(tour.stops), 'living-sage', 'living-clay'].map(pano));
await siteImage();
parentPort.postMessage({ type: 'ready' });
