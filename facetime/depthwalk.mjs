// Real walking between scan positions: a 360 photo redrawn from a camera that has stepped away from the spot it
// was taken at, using how far the room is in every direction (media/depth, scripts/make_depth.py). The floor and
// the walls slide past with the right parallax, the way they do in Matterport's own viewer.
//
// The convention, the same as the panoramas and the depth files:
//   column u of W    yaw   = (u + 0.5) / W * 360 - 180      degrees
//   row v of H       pitch = 90 - (v + 0.5) / H * 180       degrees, up is positive
//   in the panorama's own frame (y up) that ray is (sin yaw cos pitch, sin pitch, cos yaw cos pitch)
//   in the world (model.json x, y, z in metres, z up) it points along
//       bearing = bearing0 - yaw                             degrees counter-clockwise from +x
//       (cos bearing cos pitch, sin bearing cos pitch, sin pitch)
//   bearing0 is in media/depth/index.json for each sweep: the world bearing of its panorama's yaw 0
//   (the same number as yawOffset in media/walk.json). So a camera facing world bearing `b` has
//   camera.yaw = sweep.bearing0 - b in that sweep's panorama, and a different yaw in the next sweep's.
//
// Use, for a walk from sweep A to sweep B with the camera at `at` facing world bearing `b`, `p` of the way (0 to 1):
//   const depth = await loadDepth(), A = depth.sweeps[idA], B = depth.sweeps[idB];
//   const [columns, rows] = gridSize(W, H, 8), count = columns * rows;
//   const gridA = new Float32Array(2 * count), gridB = new Float32Array(2 * count);
//   const trustA = new Float32Array(count), trustB = new Float32Array(count), amounts = new Float32Array(count);
//   warpGrid(A, { ...at, yaw: A.bearing0 - b, pitch, roll, fov: 60 }, W, H, 8, gridA, trustA);
//   warpGrid(B, { ...at, yaw: B.bearing0 - b, pitch, roll, fov: 60 }, W, H, 8, gridB, trustB);
//   drawWarped(frame, panoA, gridA, W, H, 8);                                        // A, whole
//   drawWarped(frame, panoB, gridB, W, H, 8, mixWarped(trustA, trustB, p, amounts)); // B over it, where B knows better
// (or drawWarped(frame, panoB, gridB, W, H, 8, Math.round(p * 256)) for a plain cross-dissolve, without the trusts).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEG = Math.PI / 180, TAU = 2 * Math.PI;
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Loads media/depth/index.json and the .bin files: { width, height, sweeps: { [id]: { depth: Float32Array, x, y, z, bearing0 } } }
 * (each sweep also carries the depth panorama's width and height, and `cube`, what warpGrid() reads the room from).
 */
export async function loadDepth(folder = join(here, 'media/depth')) {
  const index = JSON.parse(await readFile(join(folder, 'index.json'), 'utf8'));
  const sweeps = {};
  await Promise.all(Object.entries(index.sweeps).map(async ([id, { file, x, y, z, bearing0 }]) => {
    const bytes = await readFile(join(folder, file));
    const depth = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    sweeps[id] = { depth, width: index.width, height: index.height, x, y, z, bearing0 };
    cubeOf(sweeps[id]);                                           // now, so the first step of a walk does not stall
  }));
  return { width: index.width, height: index.height, sweeps };
}

// ---- the room around a sweep, in a form that is quick to ask -----------------------------------------------------------

// The depth panorama again as six square pictures, one for each way along each axis of the panorama's frame. A
// point (x, y, z) reads the picture of its largest part, at the other two divided by it: no trigonometry. What
// is kept is one over the depth along that axis, which is a straight line across any flat floor, wall or ceiling,
// so smoothing between pixels is exact on them and "how far past the surface is this point" is a straight line
// along any ray that meets one.
const FACE = 256, HALF = (FACE - 1) / 2, AREA = FACE * FACE;
// Four smaller cubes say how far it is certain to be open around each direction: the nearest surface within a
// step of 1.5, 5, 15 and 40 degrees of it. A camera ray is followed in steps of angle as seen from the sweep, as
// long as the room allows: a step that stays inside that open distance cannot have touched anything. Only the
// shortest steps that come close to a surface are walked in paces (a depth pixel or two), which is what finds
// the edge of a door where it is.
const ROOM = 128, STEPS = [1.5, 5, 15, 40], POOLS = [2, 4, 8, 16], PACE = 0.75;
const SLACK = 1.5;                        // degrees: a ROOM pixel from corner to centre, and the smoothing between depth pixels
const TANS = STEPS.map(step => Math.tan(step * DEG)), FINE = Math.tan(PACE * DEG);

/** The depth panorama at 1 / pool of its size: in each pixel the nearest surface within `reach` degrees of any direction in it. */
function openAround(depth, width, height, pool, reach) {
  // Each pixel the nearest of its block, then of the blocks `reach` around it (sideways that is more of them
  // toward the poles, where a degree of yaw is a short way).
  const lw = Math.ceil(width / pool), lh = Math.ceil(height / pool), each = 180 / lh, span = Math.ceil(reach / each);
  const block = new Float32Array(lw * lh).fill(Infinity), across = new Float32Array(lw * lh), open = new Float32Array(lw * lh);
  for (let v = 0, n = 0; v < height; v++) {
    for (let u = 0; u < width; u++, n++) {
      const m = ((v / pool) | 0) * lw + ((u / pool) | 0);
      if (depth[n] < block[m]) block[m] = depth[n];
    }
  }
  for (let r = 0; r < lh; r++) {
    const steepest = Math.abs(90 - (r + 0.5) * each) + (span + 0.5) * each;
    const sides = steepest < 88 ? Math.min(Math.ceil(reach / (each * Math.cos(steepest * DEG))), lw >> 1) : lw >> 1;
    for (let c = 0; c < lw; c++) {
      let least = Infinity;
      for (let k = c - sides + lw; k <= c + sides + lw; k++) least = Math.min(least, block[r * lw + k % lw]);
      across[r * lw + c] = least;
    }
  }
  for (let r = 0; r < lh; r++) {
    for (let c = 0; c < lw; c++) {
      let least = Infinity;
      for (let k = Math.max(r - span, 0); k <= Math.min(r + span, lh - 1); k++) least = Math.min(least, across[k * lw + c]);
      open[r * lw + c] = least;
    }
  }
  return { open, lw, lh };
}

function cubeOf(sweep) {
  if (sweep.cube) return sweep.cube;
  const { depth } = sweep;
  const width = sweep.width ?? Math.round(Math.sqrt(depth.length * 2)), height = depth.length / width;
  const near = new Float32Array(6 * AREA);
  let closest = Infinity, thinnest = Infinity;
  for (let face = 0, n = 0; face < 6; face++) {
    const sign = face & 1 ? -1 : 1;
    for (let j = 0; j < FACE; j++) {
      for (let i = 0; i < FACE; i++, n++) {
        const s = i / HALF - 1, t = j / HALF - 1;
        const x = face < 2 ? sign : s, y = face < 2 ? s : face < 4 ? sign : t, z = face < 4 ? t : sign;
        const length = Math.sqrt(x * x + y * y + z * z);
        const u = (Math.atan2(x, z) + Math.PI) / TAU * width - 0.5 + width;
        const v = Math.min(Math.max((Math.PI / 2 - Math.asin(y / length)) / Math.PI * height - 0.5, 0), height - 1.001);
        const u0 = Math.floor(u), v0 = v | 0, fu = u - u0, fv = v - v0;
        const a = v0 * width + u0 % width, b = v0 * width + (u0 + 1) % width;
        const top = 1 / depth[a] + (1 / depth[b] - 1 / depth[a]) * fu;
        const low = 1 / depth[a + width] + (1 / depth[b + width] - 1 / depth[a + width]) * fu;
        const inverse = top + (low - top) * fv;                 // one over the distance along this ray
        near[n] = inverse * length;
        closest = Math.min(closest, 1 / inverse);
        thinnest = Math.min(thinnest, near[n]);
      }
    }
  }

  const around = STEPS.map((step, level) => openAround(depth, width, height, POOLS[level], step + SLACK));
  const rooms = STEPS.map(() => new Float32Array(6 * ROOM * ROOM));
  for (let face = 0, n = 0; face < 6; face++) {
    const sign = face & 1 ? -1 : 1;
    for (let j = 0; j < ROOM; j++) {
      for (let i = 0; i < ROOM; i++, n++) {
        const s = (2 * i + 1) / ROOM - 1, t = (2 * j + 1) / ROOM - 1;
        const x = face < 2 ? sign : s, y = face < 2 ? s : face < 4 ? sign : t, z = face < 4 ? t : sign;
        const across = (Math.atan2(x, z) + Math.PI) / TAU, down = (Math.PI / 2 - Math.asin(y / Math.sqrt(x * x + y * y + z * z))) / Math.PI;
        for (let level = 0; level < STEPS.length; level++) {
          const { open, lw, lh } = around[level];
          rooms[level][n] = (open[Math.min((down * lh) | 0, lh - 1) * lw + Math.min((across * lw) | 0, lw - 1)] * 0.98) ** 2;   // squared, to compare with squared distances
        }
      }
    }
  }
  // Nothing is nearer the sweep than `clear`, and nothing is farther than `reach`.
  sweep.cube = { near, rooms, clear: closest * 0.97, reach: 1.74 / thinnest };
  return sweep.cube;
}

/** How far past the room's surface a point is, as seen from the sweep: under 0 in the open, 0 on the surface. */
function past(near, x, y, z) {
  const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y, az = z < 0 ? -z : z;
  let most, s, t, n;
  if (ax >= ay && ax >= az) { most = ax; s = y; t = z; n = x < 0 ? AREA : 0; }
  else if (ay >= az) { most = ay; s = x; t = z; n = y < 0 ? 3 * AREA : 2 * AREA; }
  else { most = az; s = x; t = y; n = z < 0 ? 5 * AREA : 4 * AREA; }
  const scale = HALF / most, fs = s * scale + HALF, ft = t * scale + HALF;
  let i = fs | 0, j = ft | 0;
  if (i > FACE - 2) i = FACE - 2;
  if (j > FACE - 2) j = FACE - 2;
  n += j * FACE + i;
  const a = fs - i, top = near[n] + (near[n + 1] - near[n]) * a, low = near[n + FACE] + (near[n + FACE + 1] - near[n + FACE]) * a;
  return most * (top + (low - top) * (ft - j)) - 1;
}

/** The square of the distance that is certain to be open around the direction of a point. */
function openAt(room, x, y, z) {
  const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y, az = z < 0 ? -z : z;
  let most, s, t, n;
  if (ax >= ay && ax >= az) { most = ax; s = y; t = z; n = x < 0 ? ROOM * ROOM : 0; }
  else if (ay >= az) { most = ay; s = x; t = z; n = y < 0 ? 3 * ROOM * ROOM : 2 * ROOM * ROOM; }
  else { most = az; s = x; t = y; n = z < 0 ? 5 * ROOM * ROOM : 4 * ROOM * ROOM; }
  const scale = ROOM / 2 / most;
  let i = (s * scale + ROOM / 2) | 0, j = (t * scale + ROOM / 2) | 0;
  if (i > ROOM - 1) i = ROOM - 1;
  if (j > ROOM - 1) j = ROOM - 1;
  return room[n + j * ROOM + i];
}

// ---- where a displaced camera sees the panorama ---------------------------------------------------------------------

/** The grid has a vertex at the centre of pixel 0, step, 2 * step ... and one past the far edge: [columns, rows]. */
export const gridSize = (width, height, step) => [Math.ceil(width / step) + 1, Math.ceil(height / step) + 1];

/**
 * Where each pixel of a camera frame lands in a sweep's panorama when the camera is NOT at the sweep's position.
 * @param {object} sweep   one entry of loadDepth().sweeps
 * @param {object} camera  { x, y, z (world metres), yaw (degrees, in THIS sweep's panorama yaw convention:
 *                         bearing0 minus the world bearing it faces), pitch, roll (degrees), fov (vertical, degrees) }
 * @param {number} width   frame size in pixels
 * @param {number} height
 * @param {number} step    grid spacing in pixels (e.g. 8)
 * @param {Float32Array} out   gridSize(width, height, step) vertices, row by row, two numbers each: the panorama
 *                         coordinates u, v as fractions (u = (yaw + 180) / 360, v = (90 - pitch) / 180).
 *
 * The camera is the one in screen-worker.mjs: vertex (gx, gy) is the centre of frame pixel (gx * step, gy * step).
 * With the camera at the sweep's own position the result is the plain turn-only lookup, exactly.
 *
 * Each camera ray is followed from the camera until it meets the room as the sweep saw it (the depth panorama);
 * the panorama coordinate is the direction from the sweep to that meeting point.
 *
 * u is unwrapped: each vertex is within half a turn of the one on its left (the first of a row: of the one above),
 * so it can run below 0 or above 1 and a cell never straddles the seam. The one place this cannot hold is around
 * the point straight under or over the sweep when the camera looks at it from elsewhere, where u goes all the
 * way round: drawWarped() brings each cell's four corners together again itself, and so should any other reader.
 *
 * @param {Float32Array} [trust]   optional, one number per vertex: how well this panorama shows that spot, 0 to 1.
 *                         It is 1 where the photo is seen about as sharp as it was taken, and falls to 0 where it
 *                         is pulled out over something the sweep could not see (round a door edge, behind a
 *                         counter) or is the scan's own blur under the tripod.
 *                         mixWarped() turns two of these into a cross-dissolve that leaves such places to the
 *                         other panorama.
 */
export function warpGrid(sweep, camera, width, height, step, out, trust) {
  const [columns, rows] = gridSize(width, height, step);
  if (level.length < columns * rows) { level = new Float32Array(columns * rows); far = new Float32Array(columns * rows); }
  const { near, rooms, clear, reach } = cubeOf(sweep), top = STEPS.length - 1;
  const yaw = camera.yaw * DEG, pitch = (camera.pitch ?? 0) * DEG, roll = (camera.roll ?? 0) * DEG;
  const tan = Math.tan((camera.fov ?? 60) / 2 * DEG), half = height / 2;
  const sinY = Math.sin(yaw), cosY = Math.cos(yaw), sinP = Math.sin(pitch), cosP = Math.cos(pitch);
  const sinR = Math.sin(roll), cosR = Math.cos(roll);
  // The camera's place in the panorama's own frame, from the sweep.
  const east = camera.x - sweep.x, north = camera.y - sweep.y, sinB = Math.sin(sweep.bearing0 * DEG), cosB = Math.cos(sweep.bearing0 * DEG);
  const ox = sinB * east - cosB * north, oy = camera.z - sweep.z, oz = cosB * east + sinB * north;
  const away2 = ox * ox + oy * oy + oz * oz, moved = away2 > 1e-8;
  const clear2 = clear * clear, reach2 = reach * reach;

  // Two rounds. Every other vertex of every other row is followed all the way from the camera. The ones in between
  // then start just short of where their neighbours ended, when those agree: nothing wider than two grid steps
  // can be in front of them unseen. (Something thinner, a lamp cord, is drawn as what is behind it.)
  for (let round = 0; round < (moved ? 2 : 1); round++) {
    for (let gy = 0; gy < rows; gy++) {
      const sy = (half - gy * step - 0.5) / half * tan;
      for (let gx = 0; gx < columns; gx++) {
        if (moved && ((gx | gy) & 1 ? 1 : 0) !== round) continue;
        const n = 2 * (gy * columns + gx), sx = (gx * step + 0.5 - width / 2) / half * tan;
        const nx = sx * cosR - sy * sinR, ny = sx * sinR + sy * cosR;
        const up = ny * cosP + sinP, forward = cosP - ny * sinP;
        let x = nx * cosY + forward * sinY, y = up, z = forward * cosY - nx * sinY;     // the ray, in the panorama's frame
        let met = true, reached = 0;

        if (moved) {
          const length = 1 / Math.sqrt(x * x + y * y + z * z);
          const dx = x * length, dy = y * length, dz = z * length;
          // The ray is e + t d: e is its closest point to the sweep, and the camera is at t = along.
          const along = ox * dx + oy * dy + oz * dz, ex = ox - along * dx, ey = oy - along * dy, ez = oz - along * dz;
          const e2 = Math.max(away2 - along * along, 0), e = Math.sqrt(e2);
          const end = e2 < reach2 ? Math.sqrt(reach2 - e2) : -Infinity;
          const leave = e2 < clear2 ? Math.sqrt(clear2 - e2) : -1;        // between -leave and leave the ray is in the empty ball round the sweep
          let t0 = along, t1 = 0, g0 = 0, g1 = 0, found = false, stride = top - 1, run = 0, ahead = false;
          if (round) {
            // How far the neighbours followed in the first round went: left and right, above and below, or the four corners.
            const m = n >> 1, last = gx + 1 === columns, lowest = gy + 1 === rows;
            let least = -1, most = -1;
            if (!(gy & 1)) { if (!last) { least = Math.min(far[m - 1], far[m + 1]); most = Math.max(far[m - 1], far[m + 1]); } }
            else if (!(gx & 1)) { if (!lowest) { least = Math.min(far[m - columns], far[m + columns]); most = Math.max(far[m - columns], far[m + columns]); } }
            else if (!last && !lowest) {
              least = Math.min(far[m - columns - 1], far[m - columns + 1], far[m + columns - 1], far[m + columns + 1]);
              most = Math.max(far[m - columns - 1], far[m - columns + 1], far[m + columns - 1], far[m + columns + 1]);
            }
            const from = along + least * 0.94;
            if (least > 0 && most < least * 1.15 && !(from >= -leave && from < leave) && past(near, ex + from * dx, ey + from * dy, ez + from * dz) < 0) {
              t0 = from; stride = 0; ahead = true;
            }
          }
          // Behind something as seen from the sweep (it can happen at the far end of a walk round a door)?
          let hidden = !ahead && !(t0 >= -leave && t0 < leave) && past(near, ex + t0 * dx, ey + t0 * dy, ez + t0 * dz) >= 0;
          while (!found) {
            if (t0 >= -leave && t0 < leave) t0 = leave;
            if (!(t0 < end)) {
              if (!ahead) break;
              // Nothing past where the neighbours ended after all: from the camera, then.
              ahead = false; t0 = along; stride = top - 1; run = 0;
              hidden = !(t0 >= -leave && t0 < leave) && past(near, ex + t0 * dx, ey + t0 * dy, ez + t0 * dz) >= 0;
              continue;
            }
            // One step of angle round the sweep; past a quarter turn that is the far end.
            const size = hidden ? TANS[0] : TANS[stride];
            let left = e - t0 * size, t2 = left > 1e-9 ? e * (t0 + size * e) / left : end;
            if (t2 > end) t2 = end;
            if (t2 > -leave && t2 < leave) t2 = -leave;
            const px = ex + t2 * dx, py = ey + t2 * dy, pz = ez + t2 * dz;
            if (hidden) {                                                 // go on until the ray comes out into the open
              hidden = past(near, px, py, pz) >= 0;
              t0 = t2;
              continue;
            }
            // The room is open that far all round where the step ends: take it, and after two try a longer one.
            if (e2 + (t2 > -t0 ? t2 * t2 : t0 * t0) < openAt(rooms[stride], px, py, pz)) {
              t0 = t2;
              if (++run > 1 && stride < top) { stride++; run = 0; }
              continue;
            }
            run = 0;
            if (stride > 0) { stride--; continue; }
            // Something is close even to the shortest step: walk it.
            g0 = past(near, ex + t0 * dx, ey + t0 * dy, ez + t0 * dz);
            while (t0 < t2) {
              left = e - t0 * FINE;
              t1 = left > 1e-9 ? e * (t0 + FINE * e) / left : t2;
              if (t1 > t2) t1 = t2;
              g1 = past(near, ex + t1 * dx, ey + t1 * dy, ez + t1 * dz);
              if (g0 < 0 && g1 >= 0) { found = true; break; }
              t0 = t1; g0 = g1;
            }
            if (!found && g0 >= 0) hidden = true;
          }
          if (found) {
            // Close in on the crossing. On a flat surface the first guess is already it.
            let t = t1, side = 0;
            for (let k = 0; k < 5; k++) {
              t = t0 - g0 * (t1 - t0) / (g1 - g0);
              const g = past(near, ex + t * dx, ey + t * dy, ez + t * dz);
              if (g > -2e-4 && g < 2e-4) break;
              if (g < 0) { t0 = t; g0 = g; if (side < 0) g1 *= 0.5; side = -1; }
              else { t1 = t; g1 = g; if (side > 0) g0 *= 0.5; side = 1; }
            }
            x = ex + t * dx; y = ey + t * dy; z = ez + t * dz;
            reached = t - along;
          }
          // A ray that never comes into the open keeps its own direction, as if the room were far away.
          met = found;
        }

        const flat = Math.sqrt(x * x + z * z);
        out[n] = Math.atan2(x, z) / TAU + 0.5;
        out[n + 1] = (Math.PI / 2 - Math.atan2(y, flat)) / Math.PI;
        far[n >> 1] = met ? reached : -1;
        level[n >> 1] = met ? flat / Math.sqrt(flat * flat + y * y) : -1;                 // how long a degree of yaw is there
      }
    }
  }
  for (let gy = 0, n = 0; gy < rows; gy++) {                                            // unwrap u along the rows
    for (let gx = 0; gx < columns; gx++, n += 2) {
      if (gx > 0) out[n] += Math.round(out[n - 2] - out[n]);
      else if (gy > 0) out[n] += Math.round(out[n - 2 * columns] - out[n]);
    }
  }
  if (trust) trustOf(out, trust, columns, rows, step * tan / half, (0.5 - width / 2) / half * tan, (half - 0.5) / half * tan);
  return out;
}

// For each vertex of the grid being made: the cosine of its panorama pitch (-1 if its ray met nothing), and how far
// from the camera its ray met the room.
let level = new Float32Array(0), far = new Float32Array(0);

// The panorama is trusted where neighbouring vertices are about as far apart in it as they are in the frame. Under
// SHARP of that it is being magnified, and under SMEAR it is a smear: the photo pulled out over what the sweep
// could not see.
const SMEAR = 0.35, SHARP = 0.9;
const BLUR = [62, 66];                    // degrees below level where the scan's blur under the tripod starts, and is all there is

function trustOf(grid, trust, columns, rows, pixel, left, top) {
  trust.fill(1, 0, columns * rows);
  for (let gy = 0, n = 0; gy < rows; gy++) {
    const sy = top - gy * pixel;
    for (let gx = 0; gx < columns; gx++, n++) {
      const sx = left + gx * pixel, spread = (1 + sx * sx + sy * sy) / pixel, u = grid[2 * n], v = grid[2 * n + 1];
      for (let side = 0; side < 2; side++) {                    // the vertex to the right, then the one below
        const m = side ? n + columns : n + 1;
        if (side ? gy + 1 === rows : gx + 1 === columns) continue;
        let du = grid[2 * m] - u;
        du = (du - Math.round(du)) * TAU * 0.5 * (Math.abs(level[n]) + Math.abs(level[m]));
        const dv = (grid[2 * m + 1] - v) * Math.PI;
        const ratio = Math.sqrt(du * du + dv * dv) * spread / Math.sqrt(1 + (side ? sx * sx : sy * sy));
        const sure = (ratio - SMEAR) / (SHARP - SMEAR);
        if (sure < trust[n]) trust[n] = sure < 0 ? 0 : sure;
        if (sure < trust[m]) trust[m] = sure < 0 ? 0 : sure;
      }
    }
  }
  for (let n = 0; n < columns * rows; n++) {
    const below = 90 - grid[2 * n + 1] * 180;
    if (level[n] < 0) trust[n] = 0;
    else if (below < -BLUR[0]) trust[n] *= Math.max((below + BLUR[1]) / (BLUR[1] - BLUR[0]), 0);
  }
}

/**
 * The cross-dissolve of a walk, vertex by vertex: how much of the panorama walked to (B), 0 to 256, to lay over the
 * one walked from (A). Where both show a spot well it is `progress` of the way, as a plain dissolve; where one of
 * them is smeared the other is used. At progress 0 it is all A and at 1 all B, whatever the trusts.
 * @param {Float32Array} trustA, trustB   from warpGrid() of the two panoramas, same camera and grid
 * @param {number} progress               0 at A to 1 at B
 * @param {Float32Array} out              one amount per vertex, for drawWarped(frame, panoB, gridB, ..., out)
 */
export function mixWarped(trustA, trustB, progress, out) {
  const p = Math.min(Math.max(progress, 0), 1), least = 0.05;      // a little of each always, so nothing pops in on the first step
  for (let n = 0; n < out.length; n++) {
    const a = (1 - p) * (least + (1 - least) * trustA[n]), b = p * (least + (1 - least) * trustB[n]);
    out[n] = 256 * b / (a + b);
  }
  return out;
}

// ---- drawing --------------------------------------------------------------------------------------------------------

/**
 * Fills a frame from a panorama through a grid from warpGrid(): the panorama coordinate is a straight line inside
 * each cell, and the picture is smoothed between neighbouring panorama pixels (as drawPano in screen-worker.mjs).
 * @param {Uint32Array} out   the frame, width x height RGBA, one little-endian word per pixel
 * @param {object} pano       { data: Uint32Array, width, height }
 * @param {Float32Array} grid from warpGrid() with the same width, height and step
 * @param {number|Float32Array} amount   0 to 256: under 256 lays the picture over what is already in `out` (a
 *                            cross-dissolve). One number for the whole frame, or one per grid vertex (mixWarped()).
 */
export function drawWarped(out, pano, grid, width, height, step, amount = 256) {
  const each = typeof amount !== 'number';
  if (!each && amount <= 0) return;
  const { data, width: pw, height: ph } = pano, lowest = ph - 1.001;
  const [columns, rows] = gridSize(width, height, step);
  const tearU = step * pw / 320, tearV = step * ph / 160;       // over a degree of panorama to a frame pixel: an edge, not a surface
  for (let cy = 0; cy < rows - 1; cy++) {
    const top = cy * step, deep = Math.min(step, height - top);
    for (let cx = 0; cx < columns - 1; cx++) {
      const n = 2 * (cy * columns + cx), below = n + 2 * columns, left = cx * step, wide = Math.min(step, width - left);
      // The amount at the four corners, with eight bits of fraction.
      let m00 = amount, m10 = amount, m01 = amount, m11 = amount;
      if (each) { m00 = amount[n >> 1]; m10 = amount[(n >> 1) + 1]; m01 = amount[below >> 1]; m11 = amount[(below >> 1) + 1]; }
      if (m00 <= 0 && m10 <= 0 && m01 <= 0 && m11 <= 0) continue;
      const solid = m00 >= 255.5 && m10 >= 255.5 && m01 >= 255.5 && m11 >= 255.5;
      m00 = (Math.min(Math.max(m00, 0), 256) * 256) | 0; m10 = (Math.min(Math.max(m10, 0), 256) * 256) | 0;
      m01 = (Math.min(Math.max(m01, 0), 256) * 256) | 0; m11 = (Math.min(Math.max(m11, 0), 256) * 256) | 0;
      // The four corners in panorama pixels, the other three brought within half a turn of the first.
      const a = grid[n];
      const p00 = a * pw - 0.5, p10 = (grid[n + 2] - Math.round(grid[n + 2] - a)) * pw - 0.5;
      const p01 = (grid[below] - Math.round(grid[below] - a)) * pw - 0.5, p11 = (grid[below + 2] - Math.round(grid[below + 2] - a)) * pw - 0.5;
      const q00 = Math.min(Math.max(grid[n + 1] * ph - 0.5, 0), lowest), q10 = Math.min(Math.max(grid[n + 3] * ph - 0.5, 0), lowest);
      const q01 = Math.min(Math.max(grid[below + 1] * ph - 0.5, 0), lowest), q11 = Math.min(Math.max(grid[below + 3] * ph - 0.5, 0), lowest);
      // A cell whose corners are far apart in the panorama straddles the edge of something near: one side sees the
      // thing, the other what is behind it. A straight line between them would squeeze everything hidden in between
      // into the cell, so each half takes its own side instead.
      const across = Math.abs(p10 - p00) > tearU || Math.abs(p11 - p01) > tearU || Math.abs(q10 - q00) > tearV || Math.abs(q11 - q01) > tearV;
      const down = Math.abs(p01 - p00) > tearU || Math.abs(p11 - p10) > tearU || Math.abs(q01 - q00) > tearV || Math.abs(q11 - q10) > tearV;
      if (across || down) {
        for (let j = 0; j < deep; j++) {
          const fy = down ? (j < step / 2 ? 0 : 1) : j / step;
          for (let k = 0, i = (top + j) * width + left; k < wide; k++, i++) {
            const fx = across ? (k < step / 2 ? 0 : 1) : k / step;
            const u = p00 + (p10 - p00) * fx + (p01 - p00 + (p11 - p10 - p01 + p00) * fx) * fy;
            const v = q00 + (q10 - q00) * fx + (q01 - q00 + (q11 - q10 - q01 + q00) * fx) * fy;
            const over = (m00 + (m10 - m00) * k / step + (m01 - m00 + (m11 - m10 - m01 + m00) * k / step) * j / step) >> 8;
            const x0 = Math.floor(u), y0 = v | 0, xa = ((x0 % pw) + pw) % pw, xb = xa + 1 === pw ? 0 : xa + 1, r0 = y0 * pw, r1 = r0 + pw;
            const c00 = data[r0 + xa], c10 = data[r0 + xb], c01 = data[r1 + xa], c11 = data[r1 + xb];
            const fx8 = ((u - x0) * 256) | 0, gx = 256 - fx8, f = ((v - y0) * 256) | 0, g = 256 - f;
            const topRB = (((c00 & 0xff00ff) * gx + (c10 & 0xff00ff) * fx8) >>> 8) & 0xff00ff;
            const topG = (((c00 & 0x00ff00) * gx + (c10 & 0x00ff00) * fx8) >>> 8) & 0x00ff00;
            const lowRB = (((c01 & 0xff00ff) * gx + (c11 & 0xff00ff) * fx8) >>> 8) & 0xff00ff;
            const lowG = (((c01 & 0x00ff00) * gx + (c11 & 0x00ff00) * fx8) >>> 8) & 0x00ff00;
            const rb = ((topRB * g + lowRB * f) >>> 8) & 0xff00ff, green = ((topG * g + lowG * f) >>> 8) & 0x00ff00;
            const under = out[i], rest = 256 - over;
            out[i] = 0xff000000 | ((((under & 0xff00ff) * rest + rb * over) >>> 8) & 0xff00ff) | ((((under & 0x00ff00) * rest + green * over) >>> 8) & 0x00ff00);
          }
        }
        continue;
      }
      // Sixteen bits of fraction. The columns are counted from a whole turn below the lowest corner, so they never
      // go negative and stay under two turns; the 16 keeps the rounding of the steps below from landing under zero.
      const turns = Math.floor(Math.min(p00, p10, p01, p11) / pw) * pw;
      const u00 = (((p00 - turns) * 65536) | 0) + 16, u10 = (((p10 - turns) * 65536) | 0) + 16;
      const u01 = (((p01 - turns) * 65536) | 0) + 16, u11 = (((p11 - turns) * 65536) | 0) + 16;
      const v00 = ((q00 * 65536) | 0) + 16, v10 = ((q10 * 65536) | 0) + 16, v01 = ((q01 * 65536) | 0) + 16, v11 = ((q11 * 65536) | 0) + 16;
      for (let j = 0; j < deep; j++) {
        const uLeft = u00 + (((u01 - u00) * j / step) | 0), vLeft = v00 + (((v01 - v00) * j / step) | 0);
        const du = ((u10 + (((u11 - u10) * j / step) | 0) - uLeft) / step) | 0, dv = ((v10 + (((v11 - v10) * j / step) | 0) - vLeft) / step) | 0;
        const mLeft = m00 + (((m01 - m00) * j / step) | 0), dm = ((m10 + (((m11 - m10) * j / step) | 0) - mLeft) / step) | 0;
        for (let k = 0, i = (top + j) * width + left, u = uLeft, v = vLeft, m = mLeft; k < wide; k++, i++, u += du, v += dv, m += dm) {
          let xa = u >> 16;
          if (xa >= pw) xa -= pw;
          const xb = xa + 1 === pw ? 0 : xa + 1, r0 = (v >> 16) * pw, r1 = r0 + pw;
          const c00 = data[r0 + xa], c10 = data[r0 + xb], c01 = data[r1 + xa], c11 = data[r1 + xb];
          const fx = (u >> 8) & 255, gx = 256 - fx, f = (v >> 8) & 255, g = 256 - f;
          const topRB = (((c00 & 0xff00ff) * gx + (c10 & 0xff00ff) * fx) >>> 8) & 0xff00ff;
          const topG = (((c00 & 0x00ff00) * gx + (c10 & 0x00ff00) * fx) >>> 8) & 0x00ff00;
          const lowRB = (((c01 & 0xff00ff) * gx + (c11 & 0xff00ff) * fx) >>> 8) & 0xff00ff;
          const lowG = (((c01 & 0x00ff00) * gx + (c11 & 0x00ff00) * fx) >>> 8) & 0x00ff00;
          const rb = ((topRB * g + lowRB * f) >>> 8) & 0xff00ff, green = ((topG * g + lowG * f) >>> 8) & 0x00ff00;
          if (solid) out[i] = 0xff000000 | rb | green;
          else {
            const under = out[i], over = m >> 8, rest = 256 - over;
            out[i] = 0xff000000 | ((((under & 0xff00ff) * rest + rb * over) >>> 8) & 0xff00ff) | ((((under & 0x00ff00) * rest + green * over) >>> 8) & 0x00ff00);
          }
        }
      }
    }
  }
}
