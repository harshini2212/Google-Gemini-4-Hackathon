// Pre-generates the staged panoramas the guide can show at once, and writes media/staged/index.json.
//
//   node --env-file=.env.local scripts/make_staging.mjs                       all presets (cached ones cost nothing)
//   node --env-file=.env.local scripts/make_staging.mjs living:modern         only these presets
//   node --env-file=.env.local scripts/make_staging.mjs --previews <folder>   also render what the call would show
//   node --env-file=.env.local scripts/make_staging.mjs --try <stop|pano.webp> "<request>" [--name slug] [--yaw d] [--pitch d] [--previews <folder>]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPresets, renderView, stagePano } from '../stage.mjs';

const demoDir = fileURLToPath(new URL('../../data/demo/', import.meta.url));
const stagedDir = fileURLToPath(new URL('../media/staged/', import.meta.url));

const PRESETS = [
  { stop: 'living', id: 'modern', label: 'Modern living room', request: 'Furnish this as a simple modern living room: a sofa, a coffee table, a rug, a floor lamp and a plant' },
  { stop: 'living', id: 'vintage', label: '1920s vintage living room', request: 'Furnish this living room with 1920s vintage style furniture: a sofa, an armchair, a coffee table, a rug and a floor lamp' },
  { stop: 'bedroom', id: 'bedroom', label: 'Furnished bedroom', request: 'Furnish this as a bedroom: a queen bed with nightstands and a lamp' },
  { stop: 'desk', id: 'office', label: 'Work-from-home nook', request: 'Add a work-from-home desk with a chair and a monitor by the window' },
];

const args = process.argv.slice(2);
const option = (flag) => { const at = args.indexOf(flag); return at < 0 ? undefined : args.splice(at, 2)[1]; };
const previews = option('--previews'), attempt = option('--try'), name = option('--name'), yawArg = option('--yaw'), pitchArg = option('--pitch');
const tour = JSON.parse(await readFile(path.join(demoDir, 'tour.json'), 'utf8'));

/** The default view and the views 50 degrees either side, where the edit meets the untouched panorama. */
async function preview(file, yaw, pitch, label) {
  if (!previews) return;
  await mkdir(previews, { recursive: true });
  for (const [suffix, turn] of [['', 0], ['-left50', -50], ['-right50', 50]]) {
    await renderView(file, yaw + turn, pitch, path.join(previews, `${label}${suffix}.jpg`));
  }
}

if (attempt) {
  const request = args[0];
  if (!request) throw new Error('--try needs a request in quotes');
  const stop = tour.stops[attempt], presets = await loadPresets();
  const preset = Object.values(presets).flat().find((p) => path.basename(p.file) === path.basename(attempt));
  const source = stop ? path.join(demoDir, `${attempt}.webp`) : path.resolve(attempt);
  const yaw = Number(yawArg ?? stop?.yaw ?? preset?.yaw ?? 0), pitch = Number(pitchArg ?? stop?.pitch ?? preset?.pitch ?? -8);
  const result = await stagePano({ source, yaw, pitch, request, name: name || 'try' });
  console.log(JSON.stringify(result));
  await preview(result.file, yaw, pitch, name || 'try');
} else {
  const wanted = PRESETS.filter((p) => !args.length || args.includes(`${p.stop}:${p.id}`));
  const results = await Promise.allSettled(wanted.map(async (p) => {
    const { yaw, pitch } = tour.stops[p.stop];
    const result = await stagePano({ source: path.join(demoDir, `${p.stop}.webp`), yaw, pitch, request: p.request, name: `${p.stop}-${p.id}` });
    console.log(`${p.stop}:${p.id}  ${result.cached ? 'cached' : `${result.seconds} s`}  ${result.file}`);
    await preview(result.file, yaw, pitch, `${p.stop}-${p.id}`);
    return { stop: p.stop, entry: { id: p.id, label: p.label, request: p.request, file: path.basename(result.file), yaw, pitch } };
  }));
  // Keep what is already in the index for presets not made this time.
  let index = {};
  try { index = JSON.parse(await readFile(path.join(stagedDir, 'index.json'), 'utf8')); } catch {}
  for (const [at, outcome] of results.entries()) {
    if (outcome.status === 'rejected') { console.error(`${wanted[at].stop}:${wanted[at].id} failed: ${outcome.reason.message}`); process.exitCode = 1; continue; }
    const { stop, entry } = outcome.value;
    index[stop] = [...(index[stop] || []).filter((e) => e.id !== entry.id), entry];
  }
  const ordered = {};
  for (const p of PRESETS) {
    const entry = index[p.stop]?.find((e) => e.id === p.id);
    if (entry) (ordered[p.stop] ||= []).push(entry);
  }
  await mkdir(stagedDir, { recursive: true });
  await writeFile(path.join(stagedDir, 'index.json'), `${JSON.stringify(ordered, null, 1)}\n`);
  console.log(`index.json lists ${Object.values(ordered).flat().length} presets`);
}
