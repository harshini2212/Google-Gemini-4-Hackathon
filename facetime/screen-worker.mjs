// Draws the tour picture the caller sees on FaceTime, off the agent's main thread so the voice never stutters.
// One frame is WIDTH x HEIGHT RGBA. The picture follows the shared tour view (shared/tour.mjs):
//   interior  a phone camera held by a person standing at a scan position: it drifts, shakes a little, turns to
//             what `view.look` points at, and walks through the scan positions to the next place
//   site      the Vexcel aerial with the scan location and the parking row marked
//   plan      the floor plan measured from the Matterport scan
// Beyond the shared view it honours, all optional:
//   view.place    { sweep, yaw, pitch, label, detail }  where to stand, instead of tour.stops[view.stop]
//   view.look     { yaw, pitch, zoom }                   yaw relative to the place's yaw, pitch absolute, zoom 1 to 2.5
//   view.paints   { [stop]: { rgb, label } }             the stop's wall (media/walls) painted this colour
//   view.sources  { [sweepId]: { file, label } }         another panorama (a staged room) in place of the scan
//   view.spin     { id, arc: 'full' | [from, to], seconds }   one slow turn to show the whole room, once per id
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';
import { finishes } from '../shared/tour.mjs';
import { loadWalls, tintPano } from './paint.mjs';

const { width: W, height: H, fps, mediaDir } = workerData;
const N = W * H;
const S = W / 1280;                       // every size below is drawn for 1280 x 720 and scaled
const DEG = Math.PI / 180, TAU = 2 * Math.PI;
const TAN = Math.tan(30 * DEG);           // half of the 60 degree vertical field of view, the same as the posters
const here = dirname(fileURLToPath(import.meta.url));
const tour = JSON.parse(await readFile(join(mediaDir, 'tour.json'), 'utf8'));

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const number = (value, otherwise) => Number.isFinite(value) ? value : otherwise;
const report = error => parentPort.postMessage({ type: 'error', message: String(error?.stack ?? error) });

// ---- images ---------------------------------------------------------------------------------------------------------

async function pixels(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return { data: new Uint32Array(copy.buffer), width: info.width, height: info.height };
}

/**
 * A panorama's pixels, decoded in a process of its own. Every thread that libvips decodes a panorama on holds on
 * to 50 to 100 MB of working memory for good; a process that ends gives it all back. `widest` shrinks a larger picture.
 */
const DECODER = `import sharp from 'sharp';
try {
  const [file, widest] = process.argv.slice(1);
  let image = sharp(file);
  if (Number(widest)) image = image.resize({ width: Number(widest), withoutEnlargement: true });
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  process.stdout.write(Buffer.from(new Uint32Array([info.width, info.height]).buffer));
  process.stdout.write(data);
} catch (error) { process.stderr.write(String(error?.message ?? error)); process.exitCode = 1; }`;
function decode(file, widest = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', DECODER, file, String(widest)], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] });
    let head = Buffer.alloc(0), bytes = null, filled = 0, complaint = '';
    child.stdout.on('data', chunk => {
      if (!bytes) {                           // the first eight bytes are the width and height
        head = Buffer.concat([head, chunk]);
        if (head.length < 8) return;
        bytes = new Uint8Array(head.readUInt32LE(0) * head.readUInt32LE(4) * 4);
        chunk = head.subarray(8);
      }
      bytes.set(chunk.subarray(0, bytes.length - filled), filled);
      filled += chunk.length;
    });
    child.stderr.on('data', text => { complaint += text; });
    child.on('error', reject);
    child.on('close', code => code === 0 && bytes && filled === bytes.length
      ? resolve({ data: new Uint32Array(bytes.buffer), width: head.readUInt32LE(0), height: head.readUInt32LE(4) })
      : reject(new Error(complaint.trim() || `Could not decode ${file}`)));
  });
}

/** Keeps the newest few entries of a cache whose values are large. */
function keep(cache, key, value, most) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > most) cache.delete(cache.keys().next().value);
  return value;
}

const esc = text => String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const svg = body => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 1280 720">${body}</svg>`);
const SANS = 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif"';
const SERIF = 'font-family="Georgia, Times New Roman, serif"';

/** The lower third: where we are, what it is, and which data layer the picture comes from. */
function caption({ title = '', detail = '', source = '', chip }) {
  const swatch = chip?.color ? 28 : 0;      // a chip without a colour is words only
  const chipWidth = chip ? 36 + swatch + chip.label.length * 11.5 : 0;
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
      ${swatch ? `<circle cx="${640 - chipWidth / 2 + 24}" cy="549" r="11" fill="${chip.color}" stroke="#0d1413" stroke-opacity="0.25"/>` : ''}
      <text x="${640 + swatch / 2}" y="556" font-size="20" font-weight="600" fill="#0d1413">${esc(chip.label)}</text>` : ''}
      <text x="640" y="628" ${SERIF} font-size="54" fill="#fff">${esc(title)}</text>
      <text x="640" y="662" font-size="22" fill="#fff" fill-opacity="0.9">${esc(detail)}</text>
      <text x="640" y="694" font-size="14" font-weight="600" fill="#fff" fill-opacity="0.7" letter-spacing="2.4">${esc(source.toUpperCase())}</text>
    </g>`;
}

/** A caption as frame pixels, with the rows that have anything in them so a frame only visits those. */
const overlays = new Map();
async function overlay(words) {
  const key = JSON.stringify(words);
  if (overlays.has(key)) return keep(overlays, key, overlays.get(key), 5);
  const { data } = await pixels(svg(caption(words)));
  const rows = [];
  for (let y = 0, open = false; y <= H; y++) {
    let any = false;
    for (let i = y * W, end = y < H ? i + W : i; i < end && !any; i++) any = data[i] >>> 24 !== 0;
    if (any !== open) { rows.push(y); open = any; }
  }
  return keep(overlays, key, { data, rows }, 5);
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
  const layer = await overlay({
    title: 'Parking and arrival',
    detail: `${property.parking_spaces} spaces community-wide${covered}`,
    source: 'Vexcel aerial · CoStar record · Matterport geolocation',
  });
  return { ...image, layer, focus: [(ax + px) / 2 * S, (ay + py) / 2 * S] };
}

function inside([x, y], polygon) {
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i], [bx, by] = polygon[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) within = !within;
  }
  return within;
}

/** The floor plan from the scan's room boundaries, with the room and spot the camera stands in and the planned route marked. */
async function planImage(view, place) {
  const rooms = tour.rooms;
  const all = rooms.flatMap(room => room.polygon);
  const minX = Math.min(...all.map(p => p[0])), maxX = Math.max(...all.map(p => p[0]));
  const minY = Math.min(...all.map(p => p[1])), maxY = Math.max(...all.map(p => p[1]));
  const scale = Math.min(1000 / (maxX - minX), 470 / (maxY - minY));
  const ox = 640 - (maxX + minX) / 2 * scale, oy = 322 + (maxY + minY) / 2 * scale;
  const at = ([x, y]) => [ox + x * scale, oy - y * scale];
  const here = place.roomId ?? rooms.find(room => inside([place.sweep.x, place.sweep.y], room.polygon))?.id;
  const marks = new Map(tour.sweeps.map(sweep => [sweep.id, at([sweep.x, sweep.y])]));
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
  const route = (view.path ?? []).map(leg => `<polyline points="${leg.map(id => marks.get(id)).filter(Boolean)
    .map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#ff5a4e" stroke-width="6"
    stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 13"/>`).join('');
  const stop = marks.get(place.sweep.id);
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

// ---- the scan positions ---------------------------------------------------------------------------------------------

// media/walk.json (scripts/prepare_walk.py) has every scan position, the ones a person can walk between, and
// which way each panorama faces: world direction `a` (degrees, atan2 in model x, y) is at panorama yaw `offset - a`.
// Without it only the tour stops can be stood in, and a walk between them does not turn to face the way it goes.
const walkFile = await readFile(join(here, 'media/walk.json'), 'utf8').then(JSON.parse, () => null);
const aligned = Boolean(walkFile);
const stopAt = new Map(Object.entries(tour.stops).map(([key, stop]) => [stop.sweep, key]));
const sweeps = new Map((walkFile?.sweeps ?? tour.sweeps).map(sweep => [sweep.id, {
  ...sweep, offset: sweep.yawOffset ?? 0, stop: stopAt.get(sweep.id) ?? null, source: null,
  file: stopAt.has(sweep.id) ? join(mediaDir, `${stopAt.get(sweep.id)}.webp`) : sweep.pano ? join(here, 'media', sweep.pano) : null,
}]));

const panos = new Map();
function pano(file) {
  if (!panos.has(file)) panos.set(file, decode(file).then(image => ({ ...image, key: file })));
  return panos.get(file);
}

/** The sweeps to walk through from one to another. A long step costs more than its length, so the walk takes the rooms in between. */
function route(from, to) {
  const cost = new Map([[from, 0]]), back = new Map(), open = new Set(sweeps.keys());
  while (open.size) {
    let near = null;
    for (const id of open) if (cost.has(id) && (near === null || cost.get(id) < cost.get(near))) near = id;
    if (near === null) return null;
    if (near === to) {
      const path = [to];
      while (back.has(path[0])) path.unshift(back.get(path[0]));
      return path;
    }
    open.delete(near);
    const a = sweeps.get(near);
    for (const id of a.neighbors) {
      const b = sweeps.get(id);
      if (!b?.source || !open.has(id)) continue;
      const length = Math.hypot(a.x - b.x, a.y - b.y), next = cost.get(near) + length + length * length / 4;
      if (next < (cost.get(id) ?? Infinity)) { cost.set(id, next); back.set(id, near); }
    }
  }
  return null;
}

const bearing = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) / DEG;
const turn = angle => ((angle % 360) + 540) % 360 - 180;             // the short way round, -180 to 180

/** At most five steps: on a longer way, pass by the positions where the walk turns least. */
function shorten(path) {
  while (path.length > 6) {
    let drop = 1, least = Infinity;
    for (let i = 1; i < path.length - 1; i++) {
      const [a, b, c] = [path[i - 1], path[i], path[i + 1]].map(id => sweeps.get(id));
      const bend = Math.abs(turn(bearing(b, c) - bearing(a, b)));
      if (bend < least) { least = bend; drop = i; }
    }
    path.splice(drop, 1);
  }
  return path;
}

// ---- what a place looks like: the scan, a staged room, a painted wall -----------------------------------------------

const walls = await loadWalls().catch(error => { report(error); return {}; });
const breath = () => new Promise(resolve => setImmediate(resolve));

/** A picture that is on screen or on the way there, by its key, so that it is not loaded or painted a second time. */
function showing(key) {
  const layers = walk ? walk.hops.flatMap(hop => [hop.a, hop.b]) : stand ? [stand.layer] : [];
  for (const layer of layers) for (const source of [layer.source, layer.before]) if (source?.key === key) return source;
  return null;
}

/** The wall mask at a panorama's size, and the rows it covers. */
function maskFor(wall, width, height) {
  const key = `${width}x${height}`;
  wall.sized ??= new Map();
  if (wall.sized.has(key)) return wall.sized.get(key);
  let data = wall.mask;
  if (wall.width !== width || wall.height !== height) {
    data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const row = Math.min(Math.floor(y * wall.height / height), wall.height - 1) * wall.width;
      for (let x = 0; x < width; x++) data[y * width + x] = wall.mask[row + Math.floor(x * wall.width / width)];
    }
  }
  let top = height, bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let i = y * width, end = i + width; i < end; i++) if (data[i]) { top = Math.min(top, y); bottom = y + 1; break; }
  }
  wall.sized.set(key, { data, top, bottom });
  return wall.sized.get(key);
}

/**
 * A panorama with the stop's wall painted. Done a few rows at a time between frames, so the picture keeps moving.
 * Each is 30 MB and quick to make again, so none is kept beyond its time on screen.
 */
async function painted(source, stop, rgb) {
  const key = `${source.key}|${stop}|${rgb.join(',')}`;
  return showing(key) ?? (async () => {
    const mask = maskFor(walls[stop], source.width, source.height);
    const data = new Uint32Array(source.data);
    let since = performance.now();
    for (let y = mask.top; y < mask.bottom; y += 24) {
      const from = y * source.width, to = Math.min(y + 24, mask.bottom) * source.width;
      data.set(tintPano(source.data.subarray(from, to), mask.data.subarray(from, to), rgb), from);
      if (performance.now() - since > 6) { await breath(); since = performance.now(); }
    }
    return { data, width: source.width, height: source.height, key };
  })();
}

/** Another panorama for a sweep, such as a staged room. Null, with the error reported, when it cannot be read. */
async function staged(file) {
  return showing(file) ?? decode(file, 3840).then(image => ({ ...image, key: file }), error => {
    report(`Cannot load the panorama ${file}: ${error?.message ?? error}`);
    return null;
  });
}

/** The picture and caption words for a sweep under this view: the scan, or its staged room, with the paint on top. */
async function dress(view, id) {
  const sweep = sweeps.get(id);
  let source = sweep.source, chip = null, credit = 'Matterport scan';
  const staging = view.sources?.[id];
  const room = typeof staging?.file === 'string' ? await staged(staging.file) : null;
  if (staging && !room && stand?.sweep === sweep) return stand.dress;       // keep showing what was on screen
  if (room) {
    source = room;
    chip = { label: `Staging preview · ${staging.label ?? 'Staged'}` };
    credit = 'AI staging preview on the Matterport scan';
  }
  const paint = sweep.stop && walls[sweep.stop] ? view.paints?.[sweep.stop] : null;
  const rgb = Array.isArray(paint?.rgb) && paint.rgb.length === 3 ? paint.rgb.map(value => clamp(Math.round(number(value, 0)), 0, 255)) : null;
  const finish = !rgb && !room && sweep.stop === 'living' && Object.hasOwn(finishes, view.finish) && view.finish !== 'original' ? finishes[view.finish] : null;
  const finished = finish ? await staged(join(mediaDir, `living-${view.finish}.webp`)) : null;
  if (rgb) {
    source = await painted(source, sweep.stop, rgb);
    chip = { label: `Paint preview · ${paint.label ?? 'Custom'}`, color: `rgb(${rgb.join(',')})` };
    credit = room ? 'AI staging and paint preview on the Matterport scan' : 'Paint preview on the Matterport scan';
  } else if (finished) {
    source = finished;
    chip = { label: `Paint preview · ${finish.label}`, color: finish.color };
    credit = 'Blender paint preview on the Matterport scan';
  }
  return { source, chip, credit };
}

/** Where the view stands: its own place, or the tour stop. Null for a sweep there is no panorama of. */
function placeOf(view) {
  const given = view.place;
  if (given) {
    const sweep = sweeps.get(given.sweep);
    if (!sweep?.source) return null;
    return { sweep, yaw: number(given.yaw, 0), pitch: clamp(number(given.pitch, -5), -45, 45),
      label: given.label ?? sweep.room ?? '', detail: given.detail ?? '' };
  }
  const stop = tour.stops[Object.hasOwn(tour.stops, view.stop) ? view.stop : 'living'];
  return { sweep: sweeps.get(stop.sweep), yaw: stop.yaw, pitch: stop.pitch, label: stop.label, detail: stop.detail, roomId: stop.roomId };
}

function lookOf(view, place) {
  const look = view.look;
  if (!look || typeof look !== 'object') return null;
  return { yaw: turn(number(look.yaw, 0)), pitch: clamp(number(look.pitch, place.pitch), -45, 45), zoom: clamp(number(look.zoom, 1), 1, 2.5) };
}

// ---- drawing --------------------------------------------------------------------------------------------------------

// The camera can point anywhere, tilt and zoom on every frame. Where a frame pixel lands in the panorama is worked
// out exactly at the corners of 8 px cells and is a straight line between them, which no eye can tell from the real thing.
const G = 8, GW = Math.ceil(W / G) + 1, GH = Math.ceil(H / G) + 1;
const gridU = new Float64Array(GW * GH), gridV = new Float64Array(GW * GH);
const lens = { yaw: 0, pitch: 0, roll: 0, tan: TAN };          // radians; yaw in the panorama's own frame

function aim(source, cam) {
  const { width: pw, height: ph } = source;
  const sinP = Math.sin(cam.pitch), cosP = Math.cos(cam.pitch), sinR = Math.sin(cam.roll), cosR = Math.cos(cam.roll);
  const toU = pw / TAU, toV = ph / Math.PI, lowest = ph - 1.001;
  for (let gy = 0, n = 0; gy < GH; gy++) {
    const sy = (H / 2 - gy * G - 0.5) / (H / 2) * cam.tan;
    for (let gx = 0; gx < GW; gx++, n++) {
      const sx = (gx * G + 0.5 - W / 2) / (H / 2) * cam.tan;
      const nx = sx * cosR - sy * sinR, ny = sx * sinR + sy * cosR;
      const up = ny * cosP + sinP, forward = cosP - ny * sinP;
      gridU[n] = (Math.atan2(nx, forward) + cam.yaw + Math.PI) * toU - 0.5;
      gridV[n] = clamp((Math.PI / 2 - Math.atan2(up, Math.hypot(nx, forward))) * toV - 0.5, 0, lowest);
    }
  }
}

/**
 * One camera frame from a panorama, smoothed between neighbouring pixels so slow motion does not shimmer.
 * Draws columns x0 to x1 (multiples of 8); `amount` under 256 lays the picture over what is already there.
 */
function drawPano(out, source, cam, amount, x0, x1) {
  if (x1 <= x0 || amount <= 0) return;
  aim(source, cam);
  const { data, width: pw } = source, rest = 256 - amount;
  for (let cy = 0, cells = Math.ceil(x1 / G); cy < GH - 1; cy++) {
    const top = cy * G, rows = Math.min(G, H - top);
    for (let cx = x0 / G; cx < cells; cx++) {
      const n = cy * GW + cx, left = cx * G, columns = Math.min(G, W - left);
      // Sixteen bits of fraction. The cell's columns are counted from a whole turn below its lowest, so they never go negative.
      const turns = Math.floor(Math.min(gridU[n], gridU[n + 1], gridU[n + GW], gridU[n + GW + 1]) / pw) * pw;
      // The 16 keeps the rounding of the steps below from ever landing a hair under zero.
      const u00 = (((gridU[n] - turns) * 65536) | 0) + 16, u10 = (((gridU[n + 1] - turns) * 65536) | 0) + 16;
      const u01 = (((gridU[n + GW] - turns) * 65536) | 0) + 16, u11 = (((gridU[n + GW + 1] - turns) * 65536) | 0) + 16;
      const v00 = ((gridV[n] * 65536) | 0) + 16, v10 = ((gridV[n + 1] * 65536) | 0) + 16;
      const v01 = ((gridV[n + GW] * 65536) | 0) + 16, v11 = ((gridV[n + GW + 1] * 65536) | 0) + 16;
      for (let j = 0; j < rows; j++) {
        const uLeft = u00 + (((u01 - u00) * j) >> 3), vLeft = v00 + (((v01 - v00) * j) >> 3);
        const du = (u10 + (((u11 - u10) * j) >> 3) - uLeft) >> 3, dv = (v10 + (((v11 - v10) * j) >> 3) - vLeft) >> 3;
        for (let k = 0, i = (top + j) * W + left, u = uLeft, v = vLeft; k < columns; k++, i++, u += du, v += dv) {
          let xa = u >> 16;
          if (xa >= pw) xa -= pw;
          const xb = xa + 1 === pw ? 0 : xa + 1, r0 = (v >> 16) * pw, r1 = r0 + pw;
          const a = data[r0 + xa], b = data[r0 + xb], c = data[r1 + xa], d = data[r1 + xb];
          const fx = (u >> 8) & 255, gx = 256 - fx, f = (v >> 8) & 255, g = 256 - f;
          const topRB = (((a & 0xff00ff) * gx + (b & 0xff00ff) * fx) >>> 8) & 0xff00ff;
          const topG = (((a & 0x00ff00) * gx + (b & 0x00ff00) * fx) >>> 8) & 0x00ff00;
          const lowRB = (((c & 0xff00ff) * gx + (d & 0xff00ff) * fx) >>> 8) & 0xff00ff;
          const lowG = (((c & 0x00ff00) * gx + (d & 0x00ff00) * fx) >>> 8) & 0x00ff00;
          const rb = ((topRB * g + lowRB * f) >>> 8) & 0xff00ff, green = ((topG * g + lowG * f) >>> 8) & 0x00ff00;
          if (rest === 0) out[i] = 0xff000000 | rb | green;
          else {
            const under = out[i];
            out[i] = 0xff000000 | ((((under & 0xff00ff) * rest + rb * amount) >>> 8) & 0xff00ff) | ((((under & 0x00ff00) * rest + green * amount) >>> 8) & 0x00ff00);
          }
        }
      }
    }
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
  const { data, rows } = layer;
  for (let run = 0; run < rows.length; run += 2) {
    for (let i = rows[run] * W, end = rows[run + 1] * W; i < end; i++) {
      const pixel = data[i], alpha = pixel >>> 24;
      if (alpha === 0) continue;
      out[i] = alpha === 255 ? pixel : mix(out[i], pixel, alpha + (alpha >> 7));
    }
  }
}

/** One caption giving way to the next. What the two share, the shade and the header, stays exactly as it was. */
function drawOverlays(out, before, after, share) {
  const a = before.data, b = after.data;
  for (let i = 0; i < N; i++) {
    const pa = a[i], pb = b[i];
    if ((pa | pb) >>> 24 === 0) continue;
    const alphaA = pa >>> 24, alphaB = pb >>> 24;
    const ka = ((alphaA + (alphaA >> 7)) * (256 - share)) >> 8, kb = ((alphaB + (alphaB >> 7)) * share) >> 8, rest = 256 - ka - kb;
    const under = out[i];
    out[i] = 0xff000000 | ((((under & 0xff00ff) * rest + (pa & 0xff00ff) * ka + (pb & 0xff00ff) * kb) >>> 8) & 0xff00ff)
      | ((((under & 0x00ff00) * rest + (pa & 0x00ff00) * ka + (pb & 0x00ff00) * kb) >>> 8) & 0x00ff00);
  }
}

const ease = t => 1 - (1 - t) ** 3;
const smooth = t => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

/**
 * A place's picture through the camera. While `before` is set the new picture rolls in from the left behind a
 * soft edge, both drawn through the same moving camera: paint going onto a wall, furniture arriving in a room.
 */
const WIPE = 1500;
const spare = new Uint32Array(N), band = new Uint32Array(N);
function drawLayer(out, layer, cam, amount, now) {
  const p = layer.before ? (now - layer.start) / WIPE : 1;
  if (p >= 1) {
    layer.before = null;
    drawPano(out, layer.source, cam, amount, 0, W);
    return;
  }
  const target = amount === 256 ? out : spare;
  const soft = 90 * S, edge = ease(p) * (W + soft) - soft;
  const from = clamp(Math.floor(edge / G) * G, 0, W), to = clamp(Math.ceil((edge + soft) / G) * G, 0, W);
  drawPano(target, layer.source, cam, 256, 0, to);
  drawPano(target, layer.before, cam, 256, to, W);
  drawPano(band, layer.before, cam, 256, from, to);
  for (let x = from; x < to; x++) {
    const share = Math.round(clamp((edge + soft - x) / soft, 0, 1) * 256);
    if (share === 256) continue;
    for (let i = x; i < N; i += W) target[i] = share === 0 ? band[i] : mix(band[i], target[i], share);
  }
  if (target !== out) for (let i = 0; i < N; i++) out[i] = mix(out[i], target[i], amount);
}

// ---- the person holding the camera ----------------------------------------------------------------------------------

/**
 * A value that follows its target the way a hand moves a phone: it sets off gently, never jumps however the target
 * changes, and settles. Two critically damped stages; it is within 5% of a new target after about 7.75 / rate seconds.
 */
const follower = value => ({ a: value, va: 0, b: value, vb: 0 });
function follow(f, target, rate, dt) {
  const decay = Math.exp(-rate * dt);
  let gap = f.a - target, push = (f.va + rate * gap) * dt;
  f.va = (f.va - rate * push) * decay;
  f.a = target + (gap + push) * decay;
  gap = f.b - f.a; push = (f.vb + rate * gap) * dt;
  f.vb = (f.vb - rate * push) * decay;
  f.b = f.a + (gap + push) * decay;
}
const rest = (f, value) => { f.a = f.b = value; f.va = f.vb = 0; };

// Three slow waves that never line up: the small wandering of a held hand, between -1 and 1.
const seed = Math.random() * 100;
const sway = (t, f1, f2, f3, phase) => 0.55 * Math.sin(TAU * f1 * t + seed + phase)
  + 0.3 * Math.sin(TAU * f2 * t + seed * 1.7 + phase * 2.3) + 0.15 * Math.sin(TAU * f3 * t + seed * 2.9 + phase * 4.1);

const TURN = 6.5;                          // a turn to look at something takes about 1.2 s
const SWING = 220, WALK_SWING = 200;       // degrees a second at most: a person turns round, the room does not whip past
const WALK_PITCH = -4;                     // where a person walking holds the phone: just below level
const eye = { dir: follower(0), pitch: follower(0), zoom: follower(0), aim: 0 };   // world direction and pitch in degrees, zoom as a logarithm
const drift = { yaw: follower(0), pitch: follower(0), toYaw: 0, toPitch: 0, next: 0 };   // the presenter re-framing now and then
const pose = { dir: 0, pitch: 0, roll: 0, zoom: 1 };                       // where the camera points on this frame
let gait = 0;                              // 0 standing, 1 walking at full pace
let calm = 0;                              // 1 while turning steadily round the room, when the hand keeps the pan even

let stand = null;                          // where the camera stands: { sweep, place, layer, dress }
let look = null;                           // what the presenter is pointing the camera at, if anything
let walk = null;                           // the way to the next place: { hops, at, speed, pace, to }
let spin = null, spun;                     // a slow turn round the room: { arc, seconds, start }, and the id of the last one asked for

/** The world direction, pitch and zoom the presenter holds at a place. */
function facing(place, look) {
  return { dir: place.sweep.offset - place.yaw - (look?.yaw ?? 0), pitch: look?.pitch ?? place.pitch, zoom: look?.zoom ?? 1 };
}

/** Start at a place with the camera a little off, so the picture arrives rather than appears. */
function arriveAt(now) {
  const goal = facing(stand.place, look);
  rest(eye.dir, goal.dir + 9); rest(eye.pitch, goal.pitch - 1.5); rest(eye.zoom, Math.log(goal.zoom) + 0.04);
  eye.aim = goal.dir + 9;
  rest(drift.yaw, 0); rest(drift.pitch, 0);
  settle(now, 5000);
}

/** Hold the frame for a while before the next small re-framing. */
function settle(now, wait) {
  drift.toYaw = drift.toPitch = 0;
  drift.next = now + wait + Math.random() * 3000;
}

/** 0 to 1 at a steady rate, with `ramp` (a share of the whole) to get up to speed and the same to stop. */
function glide(u, ramp) {
  const top = 1 / (1 - ramp);
  if (u < ramp) return top * u * u / (2 * ramp);
  if (u < 1 - ramp) return top * (u - ramp / 2);
  return 1 - top * (1 - u) * (1 - u) / (2 * ramp);
}

function spinOf(asked) {
  const arc = Array.isArray(asked.arc) && asked.arc.length === 2 && asked.arc.every(Number.isFinite) && asked.arc[0] < asked.arc[1]
    ? asked.arc.map(angle => clamp(angle, -180, 180)) : 'full';
  return { arc, seconds: clamp(number(asked.seconds, 16), 5, 60), start: null };
}

/**
 * A slow turn to show the whole room: how many degrees right of the place's own direction the camera points now.
 * 'full' goes once round; [from, to] goes to `from`, pans to `to` and comes back, for a spot by a wall. Null once over.
 * The pan is a straight line in time, so every frame turns by the same angle and a slow turn does not judder.
 */
function turnRound(now) {
  // It begins half a second after the camera has come to rest on the place's own direction.
  if (spin.start === null && Math.abs(turn(facing(stand.place, null).dir - eye.dir.b)) < 3) spin.start = now + 500;
  const t = spin.start === null ? -1 : (now - spin.start) / 1000;
  if (t < 0) return 0;
  if (spin.arc === 'full') return t < spin.seconds ? 360 * glide(t / spin.seconds, 1.5 / spin.seconds) : null;
  const [from, to] = spin.arc, pan = spin.seconds - 2.6;     // 1.3 s to get to `from` and 1.3 s to come back
  if (t < 1.3) return from;
  return t < 1.3 + pan ? from + (to - from) * glide((t - 1.3) / pan, 1 / pan) : null;
}

/** The steps of a walk along a path of sweeps, each with the pictures at both ends and the way it faces. */
function hopsAlong(path, first, looks) {
  return path.slice(1).map((id, index) => {
    const from = sweeps.get(path[index]), to = sweeps.get(id);
    return {
      from, to, heading: bearing(from, to),
      a: index === 0 ? first : { source: (looks.get(from.id) ?? from).source },
      b: { source: (looks.get(id) ?? to).source },
      // How far the picture pushes in over the step: more for a long step, so the far wall arrives.
      push: clamp(1 + Math.hypot(to.x - from.x, to.y - from.y) / 2.6, 1.25, 1.8),
    };
  });
}

/** Steps per second that bring a whole walk in at about four seconds, turns included. */
function paceFor(hops, from) {
  let turning = 0, heading = from;
  for (const hop of hops) {
    const bend = aligned ? Math.abs(turn(hop.heading - heading)) : 0;
    if (bend > 30) turning += 0.2 + (bend - 30) / WALK_SWING;
    heading = hop.heading;
  }
  return 1 / clamp((3.6 - turning) / hops.length, 0.5, 0.95);
}

/** Move the walk on by one frame and say where the camera should point meanwhile. */
function stride(dt, now) {
  const { hops } = walk, index = Math.min(Math.floor(walk.at), hops.length - 1), p = walk.at - index;
  const last = index === hops.length - 1;
  let goal = { dir: aligned ? hops[index].heading : eye.dir.b, pitch: WALK_PITCH, zoom: 1 }, steering = aligned;
  if (p > 0.5) {
    // Past the middle of a step a person already turns into the next one, or to what they came to show.
    if (!last) goal.dir = aligned ? hops[index + 1].heading : goal.dir;
    else { goal = facing(walk.to.place, look); steering = false; }
  }
  if (last && p > 0.3 && !walk.titled) { walk.titled = true; setCaption(walk.to.caption, now); }
  // Nobody walks sideways: slow down, to a stop if need be, until the camera nearly faces the way it is going.
  const off = Math.abs(turn(goal.dir - eye.dir.b)), ahead = steering ? clamp(1.6 - off / 50, 0, 1) : 1;
  const left = hops.length - walk.at, gain = walk.pace / 0.35;
  const want = Math.min(walk.pace * ahead, Math.sqrt(2 * gain * left));
  walk.speed += clamp(want - walk.speed, -1.5 * gain * dt, gain * dt);
  walk.at += walk.speed * dt;
  if (hops.length - walk.at < 0.004) {
    stand = { sweep: walk.to.place.sweep, place: walk.to.place, layer: hops.at(-1).b, dress: walk.to.dress };
    if (!walk.titled) setCaption(walk.to.caption, now);
    walk = null;
    settle(now, 4000);
  }
  return goal;
}

/** Move the camera on by one frame: toward where it should point, plus the life of the hand that holds it. */
function advance(now, dt) {
  const t = now / 1000;
  const goal = walk ? stride(dt, now) : facing(stand.place, look);
  if (spin && !walk) {
    const round = turnRound(now);
    if (round === null) { spin = null; settle(now, 4000); }
    else goal.dir -= round;
  }
  const rate = walk ? 9 : TURN, swing = (walk ? WALK_SWING : SWING) * dt;
  eye.aim += clamp(turn(goal.dir - eye.aim), -swing, swing);
  follow(eye.dir, eye.aim, rate, dt);
  follow(eye.pitch, goal.pitch, rate, dt);
  follow(eye.zoom, Math.log(goal.zoom), rate, dt);
  gait += ((walk ? walk.speed / walk.pace : 0) - gait) * Math.min(1, dt * 5);
  calm += ((spin && !walk ? 1 : 0) - calm) * Math.min(1, dt * 2);

  // Every six to ten seconds a presenter shifts the frame a few degrees; less when pointing at something.
  const busy = walk || spin;
  if (!busy && now >= drift.next) {
    const reach = look ? 0.4 : 1;
    let yaw;
    do yaw = (Math.random() * 2 - 1) * 5 * reach; while (Math.abs(yaw - drift.toYaw) < 2.5 * reach);
    drift.toYaw = yaw;
    drift.toPitch = (Math.random() * 2 - 1) * 1.4 * reach;
    drift.next = now + 6000 + Math.random() * 4000;
  }
  follow(drift.yaw, busy ? 0 : drift.toYaw, 2.5, dt);
  follow(drift.pitch, busy ? 0 : drift.toPitch, 2.5, dt);

  // The hand: a slow wander, a small shake, and while walking the bob and sway of steps at about 1.8 a second.
  // All of it is scaled down when zoomed in, where the same shake would look twice as big.
  const zoom = Math.exp(eye.zoom.b), steady = 1 / zoom, hand = steady * (1 + 0.6 * gait), steps = TAU * 1.8 * t;
  const yaw = drift.yaw.b * steady + (1 - 0.8 * calm) * (0.8 * steady * Math.sin(TAU * t / 13.7 + seed) + 0.5 * hand * sway(t, 0.23, 0.61, 1.27, 1))
    + 0.45 * gait * Math.sin(steps / 2);
  pose.dir = eye.dir.b - yaw;
  pose.pitch = eye.pitch.b + drift.pitch.b * steady + 0.35 * steady * Math.sin(TAU * t / 9.3 + seed * 2) + 0.45 * hand * sway(t, 0.19, 0.53, 1.13, 2)
    + 0.5 * gait * Math.sin(steps);
  // A phone leans a touch into a turn.
  pose.roll = 0.3 * hand * sway(t, 0.17, 0.43, 0.97, 3) + 0.5 * gait * Math.sin(steps / 2 + 0.6) + 1.1 * Math.tanh(eye.dir.vb * 0.012);
  pose.zoom = zoom * (1 + 0.006 * gait * Math.sin(steps + 1));
}

/** The lens for a sweep's panorama at this frame's pose, pushed in or pulled back by `scale`. */
function lensAt(sweep, scale) {
  let pitch = pose.pitch, zoom = pose.zoom * scale;
  // A panorama whose ceiling and floor were painted in (walk.json levelOnly) is only shown level, so they stay out of frame.
  if (sweep.levelOnly) { pitch = clamp(pitch, -4, 4); zoom = Math.max(zoom, 1.04); }
  lens.yaw = turn(sweep.offset - pose.dir) * DEG;
  lens.pitch = pitch * DEG;
  lens.roll = pose.roll * DEG;
  lens.tan = TAN / zoom;
  return lens;
}

// ---- scenes ---------------------------------------------------------------------------------------------------------

let still = null;                             // the aerial or the plan, when that is on screen instead of the camera
let previous = null, fade = null;             // the last frame before a cut, and how it gives way
let words = null;                             // the caption: { layer, before, start }, and `next` waiting its turn
let lastFrame = 0;

/** Change the caption with a short dissolve; one that arrives during a dissolve waits for it. */
function setCaption(layer, now) {
  if (!words) words = { layer, before: null, start: now };
  else if (words.before) words.next = layer;
  else if (layer !== words.layer) words = { layer, before: words.layer, start: now };
}

function drawCaption(out, now) {
  if (words.before) {
    const p = (now - words.start) / 450;
    if (p < 1) return drawOverlays(out, words.before, words.layer, Math.round(smooth(p) * 256));
    const next = words.next;
    words = { layer: words.layer, before: null, start: now };
    if (next) setCaption(next, now);
  }
  drawOverlay(out, words.layer);
}

function drawInterior(out, now) {
  if (walk) {
    // A step: push in on the picture behind while the picture ahead, a little wide at first, comes through it.
    const index = Math.min(Math.floor(walk.at), walk.hops.length - 1), hop = walk.hops[index], p = walk.at - index;
    const through = Math.round(smooth((p - 0.2) / 0.55) * 256);
    if (through < 256) drawLayer(out, hop.a, lensAt(hop.from, hop.push ** p), 256, now);
    if (through > 0) drawLayer(out, hop.b, lensAt(hop.to, hop.push ** ((p - 1) * 0.7)), through, now);
  } else {
    drawLayer(out, stand.layer, lensAt(stand.sweep, 1), 256, now);
  }
  drawCaption(out, now);
}

const canvas = new Uint32Array(N);
function render(now) {
  const out = canvas, dt = clamp((now - lastFrame) / 1000, 0, 0.2);
  lastFrame = now;
  if (still) {
    const t = (now - still.since) / 1000;
    if (still.push) {
      drawStill(out, still.image, 1 + still.push * ease(Math.min(t / 14, 1)), W / 2, still.image.focus[1]);
      drawOverlay(out, still.image.layer);
    } else {
      drawStill(out, still.image, 1, 0, 0);
    }
  } else {
    advance(now, dt);
    drawInterior(out, now);
  }
  if (fade) {
    const p = (now - fade.start) / fade.length;
    if (p >= 1) fade = null;
    else {
      const amount = Math.round(ease(p) * 256);
      for (let i = 0; i < N; i++) out[i] = mix(previous[i], out[i], amount);
    }
  }
}

/** Keep the frame on screen to fade from: for a change with no camera move between the two pictures. */
function cut(now) {
  if (!still && !stand) return;
  previous ??= new Uint32Array(N);
  previous.set(canvas);
  fade = { start: now, length: 700 };
}

async function show(view) {
  const place = placeOf(view);
  if (!place) throw new Error(`No panorama for the sweep ${view.place?.sweep}`);
  if (view.mode === 'site' || view.mode === 'plan') {
    const next = view.mode === 'site' ? { place: 'site', image: await siteImage(), push: 0.08 }
      : { place: `plan:${place.sweep.id}:${(view.route ?? []).join('>')}`, image: await planImage(view, place) };
    if (still?.place === next.place) return;
    const now = performance.now();
    cut(now);
    if (walk) { stand = { sweep: walk.to.place.sweep, place: walk.to.place, layer: walk.hops.at(-1).b, dress: walk.to.dress }; walk = null; }
    still = { ...next, since: now };
    spin = null;
    return;
  }

  // Everything that takes time first, the pictures along the way and the caption, while the frames keep coming.
  const from = () => walk ? walk.hops[Math.min(Math.floor(walk.at), walk.hops.length - 1)].to : stand?.sweep;
  const looks = new Map();
  const way = !still && from() && from() !== place.sweep ? route(from().id, place.sweep.id) : null;
  for (const id of new Set([place.sweep.id, ...(way ?? [])])) looks.set(id, await dress(view, id));
  const dressed = looks.get(place.sweep.id);
  const captionLayer = await overlay({ title: place.label, detail: place.detail, source: dressed.credit, chip: dressed.chip });
  const blank = await overlay({});

  const now = performance.now();
  const start = from();
  const path = !still && start && start !== place.sweep ? route(start.id, place.sweep.id) : null;
  const pointing = lookOf(view, place), repointed = JSON.stringify(pointing) !== JSON.stringify(look);
  look = pointing;
  // Anything that moves the camera ends a turn round the room; new paint or furniture does not.
  const moved = !stand || place.sweep !== stand.sweep || place.yaw !== stand.place.yaw || place.pitch !== stand.place.pitch;
  if (still || walk || moved || (look && repointed)) spin = null;
  if (view.spin && typeof view.spin === 'object' && view.spin.id !== spun) {
    spun = view.spin.id;
    spin = look ? null : spinOf(view.spin);
  }
  if (still || !stand || (start !== place.sweep && !path)) {
    // From the aerial or the plan, at the start, or to somewhere there is no way to walk to: fade to the place.
    cut(now);
    still = null; walk = null;
    stand = { sweep: place.sweep, place, layer: { source: dressed.source }, dress: dressed };
    words = null;
    setCaption(captionLayer, now);
    arriveAt(now);
  } else if (path) {
    const to = { place, dress: dressed, caption: captionLayer };
    if (walk) {
      // Already walking: finish the step under way, then go on from where it ends.
      const index = Math.min(Math.floor(walk.at), walk.hops.length - 1);
      walk.hops.length = index + 1;
      walk.hops.push(...hopsAlong(shorten(path), walk.hops[index].b, looks));
      Object.assign(walk, { to, titled: false, pace: Math.max(walk.pace, paceFor(walk.hops.slice(index + 1), walk.hops[index].heading)) });
    } else {
      const hops = hopsAlong(shorten(path), stand.layer, looks);
      walk = { hops, at: 0, speed: 0, pace: paceFor(hops, eye.dir.b), to, titled: false };
    }
    setCaption(blank, now);
  } else if (walk) {
    // The step under way already ends here; what is shown there may have changed.
    walk.hops.length = Math.min(Math.floor(walk.at), walk.hops.length - 1) + 1;
    walk.hops.at(-1).b = { source: dressed.source };
    Object.assign(walk, { to: { place, dress: dressed, caption: captionLayer }, titled: false });
  } else {
    // The same spot: new paint or furniture rolls in across the picture, and the camera turns to any new direction.
    const changed = dressed.source !== stand.layer.source;
    if (changed) stand.layer = { source: dressed.source, before: stand.layer.source, start: now };
    if (repointed || moved) settle(now, look ? 5000 : 3000);
    stand = { ...stand, place, dress: dressed };
    setCaption(captionLayer, now);
  }
}

// ---- the loop --------------------------------------------------------------------------------------------------------

let timer = null, pending = Promise.resolve();
function tick() {
  if (!still && !stand) return;
  render(performance.now());
  const copy = new Uint8Array(N * 4);
  copy.set(new Uint8Array(canvas.buffer));
  parentPort.postMessage({ type: 'frame', data: copy.buffer }, [copy.buffer]);
}

parentPort.on('message', message => {
  if (message.type === 'view') pending = pending.then(() => show(message.view)).catch(report);
  if (message.type === 'play' && !timer) timer = setInterval(tick, 1000 / fps);
  if (message.type === 'pause' && timer) { clearInterval(timer); timer = null; }
});

// Load every picture before the first call, so no change on a call waits on a file.
const files = [...sweeps.values()].filter(sweep => sweep.file);
for (let i = 0; i < files.length; i += 3) {
  await Promise.all(files.slice(i, i + 3).map(async sweep => { sweep.source = await pano(sweep.file); }));
}
await siteImage();
parentPort.postMessage({ type: 'ready' });
