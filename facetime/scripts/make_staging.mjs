// Pre-generates the staged panoramas the guide can show at once, and writes index.json beside them.
//
//   node --env-file=.env.local scripts/make_staging.mjs                          the A5 apartment's presets (cached ones cost nothing)
//   node --env-file=.env.local scripts/make_staging.mjs --property alex-springs  the house's presets, into media/alex-springs/staged/
//   ... living:modern                                                            only these presets (<stop>:<id>)
//   ... --previews <folder>                                                      also render what the call would show (small JPEGs)
//   ... --try <stop|pano.webp> "<request>" [--name slug] [--yaw d] [--pitch d]   one request that is not a preset
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPresets, renderView, stagePano } from '../stage.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));

// Where each property keeps its panoramas (<stop>.webp and tour.json) and its staged results, and what to make.
// `like` names an earlier preset of the same room seen from another spot, whose furniture this one should repeat.
const PROPERTIES = {
  a5: {
    panos: here('../../data/demo/'), staged: here('../media/staged/'),
    presets: [
      { stop: 'living', id: 'modern', label: 'Modern living room', request: 'Furnish this as a simple modern living room: a sofa, a coffee table, a rug, a floor lamp and a plant' },
      { stop: 'living', id: 'vintage', label: '1920s vintage living room', request: 'Furnish this living room with 1920s vintage style furniture: a sofa, an armchair, a coffee table, a rug and a floor lamp' },
      { stop: 'bedroom', id: 'bedroom', label: 'Furnished bedroom', request: 'Furnish this as a bedroom: a queen bed with nightstands and a lamp' },
      { stop: 'desk', id: 'office', label: 'Work-from-home nook', request: 'Add a work-from-home desk with a chair and a monitor by the window' },
    ],
  },
  'alex-springs': {
    panos: here('../media/alex-springs/'), staged: here('../media/alex-springs/staged/'),
    presets: [
      { stop: 'living_room_front', id: 'modern', label: 'Modern living room', request: 'Furnish this large living room in a simple modern style, as one seating group in the middle of the wood floor: a grey three-seat sofa, a wooden coffee table, a large rug, a floor lamp and a tall plant. Keep the hallway arch and the way to the kitchen clear' },
      { stop: 'living_room_front', id: 'vintage', label: '1920s vintage living room', request: 'Furnish this large living room with 1920s vintage style furniture, as one seating group in the middle of the wood floor: a carved-wood sofa, an armchair, a dark wood coffee table, a patterned rug and a floor lamp. Keep the hallway arch and the way to the kitchen clear' },
      { stop: 'primary_bedroom', id: 'bedroom', label: 'Furnished primary bedroom', request: 'Furnish this as the primary bedroom: a king bed with a dark wood headboard against the far wall, a nightstand with a lamp on each side, and a bench at the foot of the bed. Leave the window completely clear' },
      { stop: 'dining_area', id: 'dining', label: 'Dining set', request: 'Add a wooden dining table for six with six chairs, centred under the chandelier, and a low sideboard against the far wall if it fits without blocking the door' },
      { stop: 'bedroom_2', id: 'office', label: 'Home office', request: 'Furnish this as a home office: a wooden desk with a monitor, an office chair and a tall dark bookshelf against a wall. Leave the window clear' },
      { stop: 'living_room', id: 'modern', label: 'Modern living room', like: { stop: 'living_room_front', id: 'modern' }, request: 'Furnish this living room in the same simple modern style: the grey three-seat sofa, the wooden coffee table, the large rug, the floor lamp and the tall plant' },
    ],
  },
};

const args = process.argv.slice(2);
const option = (flag) => { const at = args.indexOf(flag); return at < 0 ? undefined : args.splice(at, 2)[1]; };
const previews = option('--previews'), attempt = option('--try'), name = option('--name'), yawArg = option('--yaw'), pitchArg = option('--pitch');
const property = PROPERTIES[option('--property') || 'a5'];
if (!property) throw new Error(`--property must be one of ${Object.keys(PROPERTIES).join(', ')}`);
const tour = JSON.parse(await readFile(path.join(property.panos, 'tour.json'), 'utf8'));

/** The default view and the views 50 degrees either side, where the edit meets the untouched panorama. */
async function preview(file, yaw, pitch, label) {
  if (!previews) return;
  await mkdir(previews, { recursive: true });
  for (const [suffix, turn] of [['', 0], ['-left50', -50], ['-right50', 50]]) {
    await renderView(file, yaw + turn, pitch, path.join(previews, `${label}${suffix}.jpg`), 896, 504, 60, 70);
  }
}

if (attempt) {
  const request = args[0];
  if (!request) throw new Error('--try needs a request in quotes');
  const stop = tour.stops[attempt];
  const preset = Object.values(await loadPresets(property.staged)).flat().find((p) => path.basename(p.file) === path.basename(attempt));
  const source = stop ? path.join(property.panos, `${attempt}.webp`) : path.resolve(attempt);
  const yaw = Number(yawArg ?? stop?.yaw ?? preset?.yaw ?? 0), pitch = Number(pitchArg ?? stop?.pitch ?? preset?.pitch ?? -8);
  const result = await stagePano({ source, yaw, pitch, request, name: name || 'try', outDir: property.staged });
  console.log(JSON.stringify(result));
  await preview(result.file, yaw, pitch, name || 'try');
} else {
  const wanted = property.presets.filter((p) => !args.length || args.includes(`${p.stop}:${p.id}`));
  let index = {};                                         // what is already listed stays, for presets not made this time
  try { index = JSON.parse(await readFile(path.join(property.staged, 'index.json'), 'utf8')); } catch {}
  const make = async (p) => {
    try {
      const { yaw, pitch } = tour.stops[p.stop];
      let like;
      if (p.like) {
        const model = index[p.like.stop]?.find((e) => e.id === p.like.id);
        if (!model) throw new Error(`make ${p.like.stop}:${p.like.id} first`);
        like = { file: path.join(property.staged, model.file), yaw: model.yaw, pitch: model.pitch };
      }
      const result = await stagePano({ source: path.join(property.panos, `${p.stop}.webp`), yaw, pitch, request: p.request, name: `${p.stop}-${p.id}`, outDir: property.staged, like });
      console.log(`${p.stop}:${p.id}  ${result.cached ? 'cached' : `${result.seconds} s`}  ${result.file}`);
      await preview(result.file, yaw, pitch, `${p.stop}-${p.id}`);
      index[p.stop] = [...(index[p.stop] || []).filter((e) => e.id !== p.id), { id: p.id, label: p.label, request: p.request, file: path.basename(result.file), yaw, pitch }];
    } catch (error) { console.error(`${p.stop}:${p.id} failed: ${error.message}`); process.exitCode = 1; }
  };
  await Promise.all(wanted.filter((p) => !p.like).map(make));
  for (const p of wanted.filter((p) => p.like)) await make(p);   // these copy the furniture of one made above
  const ordered = {};
  for (const p of property.presets) {
    const entry = index[p.stop]?.find((e) => e.id === p.id);
    if (entry) (ordered[p.stop] ||= []).push(entry);
  }
  await mkdir(property.staged, { recursive: true });
  await writeFile(path.join(property.staged, 'index.json'), `${JSON.stringify(ordered, null, 1)}\n`);
  console.log(`index.json lists ${Object.values(ordered).flat().length} presets`);
}
