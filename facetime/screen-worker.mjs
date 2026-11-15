// Draws the tour picture the caller sees on FaceTime, off the agent's main thread so the voice never stutters.
// One frame is WIDTH x HEIGHT RGBA. The picture follows the shared tour view (shared/tour.mjs):
//   interior  a phone camera held by a person standing at a scan position: it drifts, shakes a little, turns to
//             what `view.look` points at, and walks through the scan positions to the next place
//   site      the aerial with the property marked and, where the bundle gives one, a second spot such as the parking
//   plan      the floor plan measured from the Matterport scan
// Beyond the shared view it honours, all optional:
//   view.place    { sweep, yaw, pitch, label, detail }  where to stand, instead of tour.stops[view.stop]
//   view.look     { yaw, pitch, zoom }                   yaw relative to the place's yaw, pitch absolute, zoom 1 to 2.5
//   view.paints   { [stop]: { rgb, label } }             the stop's wall (the bundle's walls/) painted this colour
//   view.sources  { [sweepId]: { file, label } }         another panorama (a staged room) in place of the scan
//   view.spin     { id, arc: 'full' | [from, to], seconds }   one slow turn to show the whole room, once per id
//
// Everything about a property comes from one folder, its bundle (`mediaDir`):
//   tour.json          { property: { name, address, caption }, stops: { [key]: { label, detail, sweep, yaw, pitch } },
//                        rooms: [{ id, type, area_sqft, polygon }], sweeps: [{ id, x, y, neighbors, yawOffset }],
//                        site: { image, size, anchor, anchorLabel, parking?, parkingLabel?, title, detail, source },
//                        plan: { title, detail, source } }
//   <stop key>.webp    the stop's panorama, equirectangular, 2 : 1
//   walk.json          optional (scripts/prepare_walk.py): the sweeps a person can walk between, in place of tour.sweeps,
//                      and panoramas of sweeps that are not stops
//   walls/             optional: index.json and the wall masks for view.paints
//   depth/             optional (scripts/make_depth.py): how far the room is from each sweep, for walking for real
//                      (only with OPEN_HOUSE_DEPTH=1)
//   <stop>-<finish>.webp   optional: the stop repainted, for view.finish
import { spawn } from 'node:child_process';
import { access, open, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';
import { finishes } from '../shared/tour.mjs';
import { loadWalls, tintPano } from './paint.mjs';

const { width: W, height: H, fps } = workerData;
const N = W * H;
const S = W / 1280;                       // every size below is drawn for 1280 x 720 and scaled
const DEG = Math.PI / 180, TAU = 2 * Math.PI;
const TAN = Math.tan(30 * DEG);           // half of the 60 degree vertical field of view, the same as the posters
const here = dirname(fileURLToPath(import.meta.url));
const mediaDir = resolve(workerData.mediaDir);
const tour = JSON.parse(await readFile(join(mediaDir, 'tour.json'), 'utf8'));

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const number = (value, otherwise) => Number.isFinite(value) ? value : otherwise;
const report = error => parentPort.postMessage({ type: 'error', message: String(error?.stack ?? error) });
const exists = file => access(file).then(() => true, () => false);

// The first bundle, the A5 in data/demo, was made before a bundle could say what its captions read, and its walk
// and wall masks are in media/ beside this file. What it leaves unsaid is kept here; any other bundle speaks for itself.
const legacy = mediaDir === resolve(here, '../data/demo');
const { property = {}, floor = {}, site = {} } = tour;
const unsaid = legacy ? {
  caption: 'The Parker at Ellington · A5 · 1 bed 1 bath',
  site: {
    anchorLabel: 'A5 · scanned unit', parkingLabel: `Parking row · about ${site.distanceFt} ft`, title: 'Parking and arrival',
    detail: `${property.parking_spaces} spaces community-wide${property.covered_parking ? ' · covered parking on site' : ''}`,
    source: 'Vexcel aerial · CoStar record · Matterport geolocation',
  },
  plan: {
    title: 'Floor plan', detail: `${floor.minSquareFeet} sq ft listed · ${Math.round(floor.scanAreaSqft)} sq ft measured indoors`,
    source: 'Matterport scan · CoStar A5 listing',
  },
} : {
  caption: property.name ?? '',
  site: { anchorLabel: property.name ?? 'The property', parkingLabel: 'Parking', title: property.name ?? 'From above', detail: property.address ?? '', source: 'Aerial' },
  plan: { title: 'Floor plan', detail: '', source: 'Matterport scan' },
};
const header = String(property.caption ?? unsaid.caption);
const siteWords = { ...unsaid.site, ...site }, planWords = { ...unsaid.plan, ...tour.plan };

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
      if (filled < bytes.length) bytes.set(chunk.subarray(0, bytes.length - filled), filled);
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

/** About how wide a line of the sans face is, as a multiple of its font size: there is nothing here to measure text with. */
const NARROW = new Set(" ·.,:;'|!()-iltfrjI");
const span = text => [...String(text)].reduce((sum, letter) => sum + (NARROW.has(letter) ? 0.295 : 0.5665), 0);

/** The lower third: where we are, what it is, and which data layer the picture comes from. Above, which property this is. */
function caption({ title = '', detail = '', source = '', chip }) {
  const swatch = chip?.color ? 28 : 0;      // a chip without a colour is words only
  const chipWidth = chip ? 36 + swatch + chip.label.length * 11.5 : 0;
  const pill = Math.min(Math.round(93 + 19 * span(header) + 0.4 * header.length), 1200);
  return `
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/>
    </linearGradient></defs>
    <rect x="0" y="520" width="1280" height="200" fill="url(#shade)"/>
    <g ${SANS} text-anchor="middle">
      ${header ? `<rect x="${640 - pill / 2}" y="26" width="${pill}" height="40" rx="20" fill="#0d1413" fill-opacity="0.62"/>
      <circle cx="${640 - pill / 2 + 28}" cy="46" r="6" fill="#ff5a4e"/>
      <text x="648" y="53" font-size="19" font-weight="500" fill="#fff" letter-spacing="0.4">${esc(header)}</text>` : ''}
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

/**
 * The aerial, enlarged to fill the frame, with the property marked: `site.anchor`, a share of the picture's width
 * and height. Where the bundle gives a second spot, `site.parking`, that is marked too, with a line between them.
 */
let sitePicture = null;
const siteImage = () => sitePicture ??= drawSite();
async function drawSite() {
  const { size, anchor, parking } = site;
  if (!size || !anchor) throw new Error('The bundle has no aerial: tour.json needs site.size and site.anchor');
  const scale = Math.max(W / size[0], H / size[1]);
  const width = Math.round(size[0] * scale), height = Math.round(size[1] * scale);
  const centre = parking ? [(anchor[0] + parking[0]) / 2, (anchor[1] + parking[1]) / 2] : anchor;
  const top = Math.round(clamp(centre[1] * height - H * 0.45, 0, height - H));
  const left = Math.round(clamp(centre[0] * width - W / 2, 0, width - W));
  const base = await sharp(join(mediaDir, basename(site.image ?? 'site.webp'))).resize(width, height, { kernel: 'lanczos3' })
    .extract({ left, top, width: W, height: H }).toBuffer();
  const point = ([x, y]) => [(x * width - left) / S, (y * height - top) / S];
  const [ax, ay] = point(anchor), [px, py] = parking ? point(parking) : [ax, ay];
  // A label is a box that ends `right` of its spot, above or below it, and stays inside the picture.
  const label = (words, x, y, right, pad) => {
    const wide = Math.round(44 + 20 * span(words)), from = clamp(x + right - wide, 16, 1264 - wide);
    return `<rect x="${from}" y="${y}" width="${wide}" height="38" rx="19" fill="#0d1413" fill-opacity="0.82"/>
        <text x="${from + wide - pad}" y="${y + 26}" font-size="20" font-weight="600" fill="#fff">${esc(words)}</text>`;
  };
  const marks = `
    <g ${SANS}>
      ${parking ? `<line x1="${ax}" y1="${ay}" x2="${px}" y2="${py}" stroke="#fff" stroke-width="4" stroke-dasharray="3 9" stroke-linecap="round"/>` : ''}
      <circle cx="${ax}" cy="${ay}" r="26" fill="#ff5a4e" fill-opacity="0.25"/>
      <circle cx="${ax}" cy="${ay}" r="11" fill="#ff5a4e" stroke="#fff" stroke-width="4"/>
      ${parking ? `<circle cx="${px}" cy="${py}" r="11" fill="#2f6bff" stroke="#fff" stroke-width="4"/>` : ''}
      <g text-anchor="end">${label(siteWords.anchorLabel, ax, ay - 64, -18, 22)}</g>
      ${parking ? `<g text-anchor="end">${label(siteWords.parkingLabel, px, py + 24, 22, 20)}</g>` : ''}
    </g>`;
  const image = await pixels(await sharp(base).composite([{ input: svg(marks) }]).toBuffer());
  const layer = await overlay({ title: siteWords.title, detail: siteWords.detail, source: siteWords.source });
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
/** Words broken into lines of about `width` letters, for a card: there is nothing here that wraps text. */
function lines(text, width) {
  const out = [''];
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if ((out.at(-1) + ' ' + word).trim().length > width) out.push(word);
    else out[out.length - 1] = (out.at(-1) + ' ' + word).trim();
  }
  return out;
}

/** A card of words in place of the camera: the recap of a visit. view.card = { title, rows: [{ label, text }], footer }. */
async function cardImage(card) {
  let y = 212;
  const rows = (card.rows ?? []).slice(0, 6).map(row => {
    const text = lines(row.text, 74).slice(0, 2);
    const block = `<text x="190" y="${y}" font-size="14" font-weight="600" fill="#fff" fill-opacity="0.55" letter-spacing="2.4">${esc(String(row.label).toUpperCase())}</text>`
      + text.map((line, index) => `<text x="190" y="${y + 32 + index * 32}" font-size="25" fill="#fff">${esc(line)}</text>`).join('');
    y += 44 + text.length * 32;
    return block;
  }).join('');
  const pill = Math.min(Math.round(93 + 19 * span(header) + 0.4 * header.length), 1200);
  return pixels(svg(`<rect width="1280" height="720" fill="#18211f"/>
    <g ${SANS}>
      <g text-anchor="middle">
        <rect x="${640 - pill / 2}" y="26" width="${pill}" height="40" rx="20" fill="#0d1413" fill-opacity="0.62"/>
        <circle cx="${640 - pill / 2 + 28}" cy="46" r="6" fill="#ff5a4e"/>
        <text x="648" y="53" font-size="19" font-weight="500" fill="#fff" letter-spacing="0.4">${esc(header)}</text>
        <text x="640" y="148" ${SERIF} font-size="52" fill="#fff">${esc(card.title ?? 'Visit recap')}</text>
        <text x="640" y="694" font-size="14" font-weight="600" fill="#fff" fill-opacity="0.7" letter-spacing="2.4">${esc(String(card.footer ?? '').toUpperCase())}</text>
      </g>
      <rect x="150" y="176" width="980" height="1" fill="#fff" fill-opacity="0.18"/>
      ${rows}
    </g>`));
}

async function planImage(view, place) {
  const rooms = tour.rooms ?? [];
  if (!rooms.length) throw new Error('The bundle has no floor plan: tour.json needs rooms');
  const all = rooms.flatMap(room => room.polygon);
  const minX = Math.min(...all.map(p => p[0])), maxX = Math.max(...all.map(p => p[0]));
  const minY = Math.min(...all.map(p => p[1])), maxY = Math.max(...all.map(p => p[1]));
  const scale = Math.min(1000 / (maxX - minX), 470 / (maxY - minY));
  const ox = 640 - (maxX + minX) / 2 * scale, oy = 322 + (maxY + minY) / 2 * scale;
  const at = ([x, y]) => [ox + x * scale, oy - y * scale];
  const here = place.roomId ?? rooms.find(room => inside([place.sweep.x, place.sweep.y], room.polygon))?.id;
  const marks = new Map([...sweeps.values()].map(sweep => [sweep.id, at([sweep.x, sweep.y])]));
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
  return pixels(svg(`<rect width="1280" height="720" fill="#18211f"/>
    <g ${SANS} text-anchor="middle">${shapes}${route}
      ${stop ? `<circle cx="${stop[0]}" cy="${stop[1]}" r="20" fill="#ff5a4e" fill-opacity="0.25"/>
      <circle cx="${stop[0]}" cy="${stop[1]}" r="9" fill="#ff5a4e" stroke="#fff" stroke-width="3"/>` : ''}
    </g>` + caption({ title: planWords.title, detail: planWords.detail, source: planWords.source })));
}

// ---- the scan positions ---------------------------------------------------------------------------------------------

// Every scan position, the ones a person can walk between, and which way each panorama faces: world direction `a`
// (degrees, atan2 in model x, y) is at panorama yaw `yawOffset - a`. A walk.json (scripts/prepare_walk.py) says all
// of it: the bundle's own or, for the first bundle, the one in media/. Without one it is the tour's sweeps as the
// scan gives them. Where those have no yawOffset, a walk does not turn to face the way it goes.
const json = file => readFile(file, 'utf8').then(JSON.parse, () => null);
let walkDir = mediaDir, walkFile = await json(join(mediaDir, 'walk.json'));
if (!walkFile && legacy) { walkDir = join(here, 'media'); walkFile = await json(join(walkDir, 'walk.json')); }
const scanned = walkFile?.sweeps ?? tour.sweeps;
if (!tour.stops || !Array.isArray(scanned)) throw new Error(`${join(mediaDir, 'tour.json')} needs stops and sweeps`);
const aligned = scanned.every(sweep => Number.isFinite(sweep.yawOffset));
const stopAt = new Map(Object.entries(tour.stops).map(([key, stop]) => [stop.sweep, key]));
const sweeps = new Map(scanned.map(sweep => [sweep.id, {
  ...sweep, neighbors: [...sweep.neighbors ?? []], offset: sweep.yawOffset ?? 0, stop: stopAt.get(sweep.id) ?? null, bytes: 0,
  file: stopAt.has(sweep.id) ? join(mediaDir, `${stopAt.get(sweep.id)}.webp`) : sweep.pano ? join(walkDir, sweep.pano) : null,
}]));
// The scan lists what can be seen from where. A way that can be walked can be walked back.
if (!walkFile) for (const sweep of sweeps.values()) for (const id of sweep.neighbors) {
  const other = sweeps.get(id);
  if (other && !other.neighbors.includes(sweep.id)) other.neighbors.push(sweep.id);
}

/** A WebP picture's width and height, from its first bytes: asking libvips would cost this process memory it keeps. */
async function sizeOf(file) {
  const handle = await open(file);
  try {
    const { buffer: head } = await handle.read(Buffer.alloc(30), 0, 30, 0), kind = head.toString('latin1', 12, 16);
    if (kind === 'VP8X') return [1 + head.readUIntLE(24, 3), 1 + head.readUIntLE(27, 3)];
    if (kind === 'VP8 ') return [head.readUInt16LE(26) & 0x3fff, head.readUInt16LE(28) & 0x3fff];
    if (kind === 'VP8L') return [1 + (head.readUInt32LE(21) & 0x3fff), 1 + ((head.readUInt32LE(21) >>> 14) & 0x3fff)];
    throw new Error('not a WebP picture');
  } finally { await handle.close(); }
}

// A sweep can be stood in when its panorama is there. One is 17 to 30 MB in memory, and its file says how much.
const WIDEST = 3840;
await Promise.all([...sweeps.values()].filter(sweep => sweep.file).map(async sweep => {
  try {
    const [width, height] = await sizeOf(sweep.file), shrink = Math.min(1, WIDEST / width);
    sweep.bytes = Math.round(width * shrink) * Math.round(height * shrink) * 4;
  } catch (error) {
    report(`Cannot read the panorama ${sweep.file}: ${error?.message ?? error}`);
    sweep.file = null;
  }
}));

// The panoramas of a small unit all stay in memory. Of a house, the ones last stood in or walked past do, and
// always those around the camera, so that a walk does not wait on a file.
const ROOM = 330e6;                        // bytes of scan panoramas to keep
const scans = new Map();                   // sweep id -> a promise of its panorama, the one last asked for last
function scan(sweep) {
  let held = scans.get(sweep.id);
  if (!held) {
    held = decode(sweep.file, WIDEST).then(image => ({ ...image, key: sweep.file }));
    held.catch(() => { if (scans.get(sweep.id) === held) scans.delete(sweep.id); });    // so that the next time tries again
  }
  scans.delete(sweep.id);
  scans.set(sweep.id, held);
  return held;
}

/** Have these sweeps' panoramas in memory, three at a time: each is decoded in a process of its own. */
async function load(ids) {
  for (let i = 0; i < ids.length; i += 3) await Promise.all(ids.slice(i, i + 3).map(id => scan(sweeps.get(id))));
}

/**
 * Let go of the panoramas longest unused, beyond what fits once those `coming` are in memory too. None on the walk
 * under way, next to the camera or coming is let go of.
 */
function tidy(coming = []) {
  let bytes = 0;
  for (const id of new Set([...scans.keys(), ...coming])) bytes += sweeps.get(id).bytes;
  if (bytes <= ROOM) return;
  const spot = walk ? walk.to.place.sweep : stand?.sweep;
  const near = new Set(spot ? [spot.id, ...spot.neighbors, ...coming] : coming);
  for (const hop of walk?.hops ?? []) near.add(hop.from.id).add(hop.to.id);
  for (const id of scans.keys()) {
    if (near.has(id)) continue;
    scans.delete(id);
    if ((bytes -= sweeps.get(id).bytes) <= ROOM) break;
  }
}

/** Have the panoramas around a sweep in memory before they are asked for. */
function warm(sweep) {
  const around = sweep.neighbors.filter(id => sweeps.get(id)?.file);
  tidy(around);
  load(around).catch(() => {});
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
      if (!b?.file || !open.has(id)) continue;
      const length = Math.hypot(a.x - b.x, a.y - b.y), next = cost.get(near) + length + length * length / 4;
      if (next < (cost.get(id) ?? Infinity)) { cost.set(id, next); back.set(id, near); }
    }
  }
  return null;
}

const bearing = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) / DEG;
const turn = angle => ((angle % 360) + 540) % 360 - 180;             // the short way round, -180 to 180

const LONG = 5.1;                          // metres: the longest step taken at the usual pace

/**
 * Five steps where that can be done: on a longer way, pass by the positions where the walk turns least, but never so
 * that a step becomes a long one. Across a house the way has more steps instead, and the walk takes longer.
 */
function shorten(path) {
  while (path.length > 6) {
    let drop = 0, least = Infinity;
    for (let i = 1; i < path.length - 1; i++) {
      const [a, b, c] = [path[i - 1], path[i], path[i + 1]].map(id => sweeps.get(id));
      const bend = Math.abs(turn(bearing(b, c) - bearing(a, b)));
      if (bend < least && Math.hypot(c.x - a.x, c.y - a.y) <= LONG) { least = bend; drop = i; }
    }
    if (!drop) break;
    path.splice(drop, 1);
  }
  return path;
}

// ---- what a place looks like: the scan, a staged room, a painted wall -----------------------------------------------

// The wall masks are the bundle's own. The first bundle's are in media/walls, and fit its panoramas only.
const wallsIn = await exists(join(mediaDir, 'walls/index.json')) ? [join(mediaDir, 'walls')] : legacy ? [] : null;
const walls = wallsIn ? await loadWalls(...wallsIn).catch(error => { report(error); return {}; }) : {};
// The stops the bundle has repainted pictures of, for view.finish: <stop>-<finish>.webp.
const repainted = new Set();
for (const stop of Object.keys(tour.stops)) for (const finish of Object.keys(finishes)) {
  if (await exists(join(mediaDir, `${stop}-${finish}.webp`))) repainted.add(`${stop}-${finish}`);
}
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
      data.set(tintPano(source.data.subarray(from, to), mask.data.subarray(from, to), rgb, walls[stop].level), from);
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
  let source = await scan(sweep), chip = null, credit = 'Matterport scan';
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
  const finish = !rgb && !room && repainted.has(`${sweep.stop}-${view.finish}`) ? finishes[view.finish] : null;
  const finished = finish ? await staged(join(mediaDir, `${sweep.stop}-${view.finish}.webp`)) : null;
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

/** Where the view stands: its own place, or the tour stop, or the bundle's first stop. Null for a sweep there is no panorama of. */
function placeOf(view) {
  const given = view.place;
  if (given) {
    const sweep = sweeps.get(given.sweep);
    if (!sweep?.file) return null;
    return { sweep, yaw: number(given.yaw, 0), pitch: clamp(number(given.pitch, -5), -45, 45),
      label: given.label ?? sweep.room ?? tour.stops[sweep.stop]?.label ?? '', detail: given.detail ?? '' };
  }
  const stop = tour.stops[Object.hasOwn(tour.stops, view.stop) ? view.stop : Object.keys(tour.stops)[0]];
  const sweep = sweeps.get(stop?.sweep);
  if (!sweep?.file) return null;
  return { sweep, yaw: number(stop.yaw, 0), pitch: number(stop.pitch, -5), label: stop.label ?? '', detail: stop.detail ?? '', roomId: stop.roomId };
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
function hopsAlong(path, first, looks, rooms) {
  return path.slice(1).map((id, index) => {
    const from = sweeps.get(path[index]), to = sweeps.get(id), length = Math.hypot(to.x - from.x, to.y - from.y);
    const real = walkable(from, to) && rooms.get(from.id) && rooms.get(id) && !(index === 0 && first.before);
    return {
      from, to, heading: bearing(from, to),
      a: index === 0 ? first : { source: looks.get(from.id).source },
      b: { source: looks.get(id).source },
      // How far the picture pushes in over the step: more for a long step, so the far wall arrives.
      push: clamp(1 + length / 2.6, 1.25, 1.8),
      // A long step, across a yard or down a drive, takes longer in proportion to its length.
      slow: Math.max(1, length / LONG),
      // The rooms at both ends, where the step is walked for real. Not from a picture that is still rolling in.
      deep: real ? [rooms.get(from.id), rooms.get(id)] : null,
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
  // No step takes much more than 1.6 s, however long it is.
  walk.at += walk.speed * dt / Math.min(hops[index].slow, Math.max(1, 1.6 * walk.pace));
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

// ---- walking for real -------------------------------------------------------------------------------------------------

// Where the bundle has the depth of its rooms (depth/, or media/depth for the first bundle), a step between two
// scan positions can be the camera really going from one to the other: both panoramas are redrawn from where the
// camera is (depthwalk.mjs), so the floor and the walls slide past as they would.
// It is off unless OPEN_HOUSE_DEPTH=1. Across an open room it reads as walking; past a door leaf, a counter or
// anything else close by, the picture tears and smears for a second, which looks worse than the dissolve.
// Off, or when anything goes wrong with it, a step is the push-in and dissolve it always was.
const depthDir = process.env.OPEN_HOUSE_DEPTH !== '1' ? null
  : await exists(join(mediaDir, 'depth/index.json')) ? join(mediaDir, 'depth') : legacy ? join(here, 'media/depth') : null;
const depthIndex = depthDir ? await json(join(depthDir, 'index.json')) : null;
let walker = depthIndex?.sweeps ? await import('./depthwalk.mjs').catch(error => { report(error); return null; }) : null;

/**
 * Whether a step between two sweeps is walked for real: a way the scan says can be walked (not two joined into
 * one), no longer than the depth is good for, between rooms whose depth is worth walking with.
 */
function walkable(from, to) {
  if (!walker) return false;
  const a = depthIndex.sweeps[from.id], b = depthIndex.sweeps[to.id];
  return Boolean(a && b) && !a.flat && !b.flat && !shapeless.has(from.id) && !shapeless.has(to.id) && !from.levelOnly && !to.levelOnly
    && from.neighbors.includes(to.id) && Math.hypot(to.x - from.x, to.y - from.y) <= (depthIndex.reach ?? Infinity);
}

/** The sweeps along a way whose rooms a walk needs: both ends of every step walked for real. */
const roomsAlong = path => [...new Set((path ?? []).slice(1).flatMap((id, index) => walkable(sweeps.get(path[index]), sweeps.get(id)) ? [path[index], id] : []))];

const SHAPES = 4;                          // rooms kept ready after a walk, 5 MB each: the next walk mostly starts among them
const shapes = new Map();                  // sweep id -> its room as depthwalk reads it, the one last asked for last
const shapeless = new Set();               // sweeps whose depth could not be read
const speck = new Float32Array(8);

/**
 * A sweep's room, ready to walk in, or null where its depth cannot be read. Making it quick to ask takes 25 ms,
 * so it is done here, one room at a time between frames, and not on the first frame of a step.
 */
async function shape(id) {
  let room = shapes.get(id);
  if (!room) {
    try {
      const { file, x, y, z, bearing0, lean } = depthIndex.sweeps[id], { width, height } = depthIndex;
      const bytes = await readFile(join(depthDir, file));
      if (bytes.length !== width * height * 4) throw new Error(`${file} is not ${width} x ${height} distances`);
      room = { depth: new Float32Array(bytes.buffer, bytes.byteOffset, width * height), width, height, x, y, z, bearing0, lean: lean ?? null, flat: false };
      await breath();
      walker.warpGrid(room, { x, y, z, yaw: 0 }, G, G, G, speck);
    } catch (error) {
      report(`No depth for the sweep ${id}: ${error?.message ?? error}`);
      shapeless.add(id);
      return null;
    }
  }
  shapes.delete(id);
  shapes.set(id, room);
  while (shapes.size > SHAPES) shapes.delete(shapes.keys().next().value);
  return room;
}

// Where each frame pixel lands in the panorama behind and in the one ahead, how far each is to be trusted there,
// and how much of the one ahead to lay over the one behind: all at the corners of the same 8 px cells.
const warp = walker && { a: new Float32Array(2 * GW * GH), b: new Float32Array(2 * GW * GH),
  trustA: new Float32Array(GW * GH), trustB: new Float32Array(GW * GH), amounts: new Float32Array(GW * GH) };
const feet = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 60, lean: null };

/**
 * A frame of a step walked for real, `p` of the way: the camera is that far between the two sweeps, turned and
 * held as on any other frame, and sees both panoramas from there. Each is the plain view at its own end.
 */
function drawStep(out, hop, p) {
  const [A, B] = hop.deep;
  feet.x = A.x + (B.x - A.x) * p; feet.y = A.y + (B.y - A.y) * p; feet.z = A.z + (B.z - A.z) * p;
  feet.pitch = pose.pitch; feet.roll = pose.roll; feet.fov = 2 * Math.atan(TAN / pose.zoom) / DEG;
  feet.lean = walker.leanBetween(A, B, p);
  feet.yaw = turn(hop.from.offset - pose.dir);
  walker.warpGrid(A, feet, W, H, G, warp.a, warp.trustA);
  feet.yaw = turn(hop.to.offset - pose.dir);
  walker.warpGrid(B, feet, W, H, G, warp.b, warp.trustB);
  walker.drawWarped(out, hop.a.source, warp.a, W, H, G);
  walker.drawWarped(out, hop.b.source, warp.b, W, H, G, walker.mixWarped(warp.trustA, warp.trustB, p, warp.amounts));
}

/**
 * A real step drawn to nowhere before the first call: the first time through, before the engine has made it
 * quick, a frame takes several frames' time. This takes most of that out of the first walk, not all: a frame
 * or two early in a call can still take 70 ms.
 */
async function limber() {
  for (const from of sweeps.values()) {
    const to = scans.has(from.id) && from.neighbors.map(id => sweeps.get(id)).find(to => to && scans.has(to.id) && walkable(from, to));
    if (!to) continue;
    const A = await shape(from.id), B = await shape(to.id);
    if (!A || !B) return;
    const hop = { from, to, deep: [A, B], a: { source: await scan(from) }, b: { source: await scan(to) } };
    pose.dir = bearing(from, to);
    for (const p of [0.02, 0.2, 0.5, 0.8, 0.98, 0.03, 0.5]) drawStep(spare, hop, p);
    return;
  }
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
    // A step: walked for real where it can be. Otherwise push in on the picture behind while the picture ahead, a
    // little wide at first, comes through it.
    const index = Math.min(Math.floor(walk.at), walk.hops.length - 1), hop = walk.hops[index], p = walk.at - index;
    if (hop.deep) {
      try { drawStep(out, hop, p); }
      catch (error) {                         // never at the cost of the picture: every step from here on is the dissolve
        report(error);
        walker = null;
        for (const other of walk.hops) other.deep = null;
      }
    }
    if (!hop.deep) {
      const through = Math.round(smooth((p - 0.2) / 0.55) * 256);
      if (through < 256) drawLayer(out, hop.a, lensAt(hop.from, hop.push ** p), 256, now);
      if (through > 0) drawLayer(out, hop.b, lensAt(hop.to, hop.push ** ((p - 1) * 0.7)), through, now);
    }
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
  if (!place) throw new Error(view.place ? `No panorama for the sweep ${view.place.sweep}` : `No panorama for the stop ${view.stop}`);
  if (view.mode === 'site' || view.mode === 'plan' || view.mode === 'card') {
    const next = view.mode === 'site' ? { place: 'site', image: await siteImage(), push: 0.08 }
      : view.mode === 'card' ? { place: `card:${JSON.stringify(view.card ?? {})}`, image: await cardImage(view.card ?? {}) }
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
  const way = () => {
    const path = !still && from() && from() !== place.sweep ? route(from().id, place.sweep.id) : null;
    return path && shorten(path);
  };
  const looks = new Map(), rooms = new Map();
  let path = way(), dressed, captionLayer, blank;
  do {
    const ids = [...new Set([place.sweep.id, ...(path ?? [])])];
    tidy(ids);
    await load(ids);
    for (const id of ids) if (!looks.has(id)) looks.set(id, await dress(view, id));
    for (const id of roomsAlong(path)) if (!rooms.has(id)) rooms.set(id, await shape(id));
    dressed = looks.get(place.sweep.id);
    captionLayer = await overlay({ title: place.label, detail: place.detail, source: dressed.credit, chip: dressed.chip });
    blank = await overlay({});
    path = way();                             // a walk under way has moved on meanwhile: the way from where it is now
  } while (path?.some(id => !looks.has(id)) || roomsAlong(path).some(id => !rooms.has(id)));

  const now = performance.now();
  const start = from();
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
      walk.hops.push(...hopsAlong(path, walk.hops[index].b, looks, rooms));
      Object.assign(walk, { to, titled: false, pace: Math.max(walk.pace, paceFor(walk.hops.slice(index + 1), walk.hops[index].heading)) });
    } else {
      const hops = hopsAlong(path, stand.layer, looks, rooms);
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
  warm(place.sweep);
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

// Have the pictures in memory before the first call, so that no change on a call waits on a file: every panorama
// of a small unit; of a house as many as are kept, in the order the scan was walked, which starts at the way in.
let total = 0;
const first = [...sweeps.values()].filter(sweep => sweep.file && (total += sweep.bytes) <= ROOM).map(sweep => sweep.id);
await load(first).catch(report);
if (walker) await limber().catch(report);
if (tour.site) await siteImage().catch(report);
parentPort.postMessage({ type: 'ready' });
