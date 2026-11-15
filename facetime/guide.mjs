// Ellie, the open-house guide: who she is, what she knows, where she can stand, and what she can do on a call.
// There is no LiveKit in this file, so the guide can be exercised without a call.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = new URL('./', import.meta.url);
const optional = async (file, fallback) => {
  try { return await import(new URL(file, here)); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') return fallback; throw error; }
};
const json = async (file, fallback) => {
  try { return JSON.parse(await readFile(new URL(file, here), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
};

// Which way "look right" and friends point, relative to the way she presents the spot.
const DIRECTIONS = {
  ahead: { yaw: 0 }, right: { yaw: 90, pitch: -5 }, behind: { yaw: 180, pitch: -5 }, left: { yaw: -90, pitch: -5 },
  up: { yaw: 0, pitch: 40 }, down: { yaw: 0, pitch: -42 },
};

function shortestPath(sweeps, start, goal) {
  const distance = new Map([[start, 0]]), previous = new Map(), pending = new Set(sweeps.keys());
  while (pending.size) {
    const current = [...pending].reduce((best, id) => (distance.get(id) ?? Infinity) < (distance.get(best) ?? Infinity) ? id : best);
    if (!distance.has(current)) return null;
    if (current === goal) {
      const path = [current];
      while (previous.has(path[0])) path.unshift(previous.get(path[0]));
      return path;
    }
    pending.delete(current);
    const from = sweeps.get(current);
    for (const id of from.neighbors) {
      const to = sweeps.get(id);
      if (!to || !pending.has(id)) continue;
      const next = distance.get(current) + Math.hypot(from.x - to.x, from.y - to.y);
      if (next < (distance.get(id) ?? Infinity)) { distance.set(id, next); previous.set(id, current); }
    }
  }
  return null;
}

/** The five scan positions the web tour already names, for when the full catalogue (places.mjs) is not there. */
function stopsAsPlaces(tour) {
  const keys = { living: 'living_room', desk: 'dining_nook', kitchen: 'kitchen', bedroom: 'bedroom', patio: 'patio' };
  const places = {};
  for (const [stop, s] of Object.entries(tour.stops)) {
    places[keys[stop]] = { sweep: s.sweep, room: s.label, label: s.label, detail: s.detail, yaw: s.yaw, pitch: s.pitch, stop,
      see: {}, leadsTo: Object.values(keys).filter(key => key !== keys[stop]), notes: '' };
  }
  return { places, entrance: 'living_room' };
}

/**
 * How much of the room each spot can turn through, read from its depth map (media/depth): a full circle where the
 * room is open all around, or the arc facing the room where she stands by a wall or in a corner.
 * Returns { [placeKey]: 'full' | [from, to] } in degrees relative to the place's own facing.
 */
async function roomTurns(places, folder) {
  const index = await json(`${folder}index.json`, null);
  if (!index) return Object.fromEntries(Object.keys(places).map(key => [key, 'full']));
  const { width: W, height: H } = index, turns = {};
  const row = pitch => Math.round((90 - pitch) / 180 * H - 0.5) * W;
  for (const [key, place] of Object.entries(places)) {
    const entry = index.sweeps[place.sweep];
    if (!entry) { turns[key] = 'full'; continue; }
    const bytes = await readFile(new URL(`${folder}${entry.file}`, here));
    const depth = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const near = Float32Array.from({ length: W }, (_, u) => Math.min(depth[row(8) + u], depth[row(-8) + u]));
    // A wall counts as "in her face" when it is much nearer than the room is deep.
    const limit = Math.max(0.9, 0.45 * [...near].sort((a, b) => a - b)[Math.floor(W * 0.75)]);
    // The longest stretch of open room and the longest stretch of wall in her face, going round the circle.
    const longest = isOpen => {
      let best = { length: 0, start: 0 }, run = 0;
      for (let i = 0; i < 2 * W; i++) {
        run = (near[i % W] > limit) === isOpen ? run + 1 : 0;
        if (run > best.length) best = { length: Math.min(run, W), start: i - run + 1 };
      }
      return { degrees: best.length / W * 360, start: best.start % W };
    };
    const open = longest(true), wall = longest(false), margin = 15;
    // By a wall or in a corner of a larger room: pan across the open side. Anywhere else: the whole circle.
    if (wall.degrees >= 100 && open.degrees >= 120 && open.degrees < 300) {
      const startYaw = (open.start + 0.5) / W * 360 - 180 + margin;
      const from = ((startYaw - place.yaw) % 360 + 540) % 360 - 180;
      turns[key] = [Math.round(from), Math.round(from + open.degrees - 2 * margin)];
    } else turns[key] = 'full';
  }
  return turns;
}

// Which knowledge-pack talking points belong to a room, by the room type the scan gives it.
const POINTS = { 'living room': 'living', 'dining room': 'desk', kitchen: 'kitchen', bedroom: 'bedroom', patio: 'patio',
  closet: 'closet', bathroom: 'bathroom', laundry: 'laundry' };

// The apartment the project started with. Another property is a folder under properties/ and media/, chosen with
// OPEN_HOUSE_PROPERTY (see scripts/prepare_property.py).
const A5 = {
  who: 'the A5 one-bedroom at The Parker at Ellington in Houston', short: 'the A5 at The Parker at Ellington',
  caller: 'renter', office: 'the leasing office', start: 'at the front door',
  care: 'Asking rents are a snapshot. Parking totals are community-wide. Never state availability dates, an exact floor or door, or fees and rules that are not in the brief.',
};

export async function loadGuide(slug = process.env.OPEN_HOUSE_PROPERTY || '') {
  const media = slug ? `./media/${slug}/` : './media/';                // walls, staged, depth
  const tourDir = slug ? media : '../data/demo/';                      // tour.json and the 360 photo of each stop
  const tour = await json(`${tourDir}tour.json`);
  const { places, entrance } = slug ? await import(new URL(`./properties/${slug}/places.mjs`, here)) : await optional('./places.mjs', stopsAsPlaces(tour));
  const { propertyBrief = '', talkingPoints = {} } = slug ? await import(new URL(`./properties/${slug}/knowledge.mjs`, here)) : await optional('./knowledge.mjs', {});
  const persona = slug ? (await json(`./properties/${slug}/site.json`)).guide : A5;
  const walls = await json(`${media}walls/index.json`, {});            // { stop: { file, label, yaw?, pitch? } }
  const staging = await optional('./stage.mjs', {});
  const stagedDir = fileURLToPath(new URL(`${media}staged`, here));
  const presets = staging.loadPresets ? await staging.loadPresets(slug ? stagedDir : undefined) : {};
  const sweeps = new Map(tour.sweeps.map(sweep => [sweep.id, sweep]));
  const turns = await roomTurns(places, `${media}depth/`);
  const keys = Object.keys(places);
  const label = key => places[key]?.label ?? key;
  const outdoors = key => ['street', 'porch', 'yard'].includes(places[key].kind);
  const scanFile = place => fileURLToPath(new URL(place.stop ? `${tourDir}${place.stop}.webp` : `./media/sweeps/${place.sweep}.webp`, here));
  const pointsFor = key => talkingPoints[places[key].kind] ?? (key === entrance ? talkingPoints.entry
    : talkingPoints[places[key].stop] ?? talkingPoints[POINTS[String(places[key].room).toLowerCase()]]);

  /** The view the screen draws: where she stands, which way she looks, and what she has changed. */
  const standAt = (view, key) => {
    const place = places[key];
    return { ...view, mode: 'interior', look: null, at: key, stop: place.stop ?? view.stop,
      place: { sweep: place.sweep, yaw: place.yaw, pitch: place.pitch, label: place.label, detail: place.detail } };
  };
  const initialView = () => standAt({ mode: 'interior', stop: 'living', finish: 'original', route: [], path: [], paints: {}, sources: {} }, entrance);

  /** Start one slow turn through the room where she stands: the whole circle, or the arc that faces the room. */
  const turnThrough = view => {
    const arc = turns[view.at];
    if (!arc) return view;
    const seconds = arc === 'full' ? 16 : Math.round(7 + (arc[1] - arc[0]) / 30);
    return { ...view, look: null, spin: { id: (view.spin?.id ?? 0) + 1, arc, seconds } };
  };
  /** Arriving in a room she has not shown yet starts that turn, so the caller sees the whole room first. */
  const enter = (view, key) => {
    const next = standAt(view, key), room = places[key].room;
    if (key === entrance || outdoors(key) || view.seen?.[room]) return next;
    return turnThrough({ ...next, seen: { ...view.seen, [room]: true } });
  };
  const turning = (view, key) => {
    if (!view.spin || view.spin.id === (view.spinBefore ?? 0)) return {};
    const see = places[key].see, arc = view.spin.arc;
    return { cameraIsTurning: arc === 'full'
      ? `one slow full circle to the right, ${view.spin.seconds} seconds: narrate what passes, in this order`
      : `a slow pan across the room, ${view.spin.seconds} seconds: narrate what passes`,
      passing: arc === 'full' ? [see.ahead, see.right, see.behind, see.left].filter(Boolean) : [see.left, see.ahead, see.right].filter(Boolean) };
  };

  /** What she should know the moment she arrives somewhere: what is in frame, what to say, where she can go, what she can change. */
  const arrival = key => {
    const place = places[key], stop = place.stop;
    return {
      nowAt: place.label, room: place.room, cameraShows: place.see.ahead ?? place.detail,
      presentThisRoom: pointsFor(key),
      thingsToPointAt: Object.entries(place.features ?? {}).map(([feature, item]) => `${feature}: ${item.label}`),
      nextTo: place.leadsTo.map(label),
      canPaintHere: stop && walls[stop] ? walls[stop].label : 'no mapped wall at this spot',
      furniturePresetsHere: (presets[stop] ?? []).map(preset => `${preset.id}: ${preset.label}`),
    };
  };

  const pick = (values, description) => ({ type: 'string', enum: values, description });
  const tool = (name, description, properties, run) =>
    ({ name, description, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, run });

  const tools = [
    tool('walk_to', 'Walk to a spot in the apartment. The caller watches you walk there. Use it whenever they ask to see, go to, or go back to a room. The result tells you what is in frame and what to present about the room.',
      { place: pick(keys, 'Where to walk.') }, (view, { place }) => {
        if (!places[place]) return { view, result: { error: 'Unknown place.' } };
        const next = enter({ ...view, spinBefore: view.spin?.id ?? 0 }, place);
        return { view: next, result: { ...arrival(place), ...turning(next, place) } };
      }),
    tool('plan_route', 'Plan a tour for this caller: an ordered list of spots chosen for what they told you matters to them. Walks to the first one and draws the route on the floor plan. Then use walk_to for each next spot.',
      { places: { type: 'array', items: pick(keys, 'A spot.'), minItems: 2, maxItems: 6 } }, (view, { places: wanted }) => {
        const route = [...new Set(Array.isArray(wanted) ? wanted : [])].filter(key => places[key]);
        if (route.length < 2) return { view, result: { error: 'Choose at least two different spots.' } };
        const path = route.slice(1).map((key, index) => shortestPath(sweeps, places[route[index]].sweep, places[key].sweep)).filter(Boolean);
        const next = { ...enter({ ...view, spinBefore: view.spin?.id ?? 0 }, route[0]), route, path };
        return { view: next, result: { route: route.map(label), ...arrival(route[0]), ...turning(next, route[0]) } };
      }),
    tool('look_around', 'Show the whole room from where you stand: one slow full turn of the camera (or a pan across the room when you are by a wall). It happens by itself the first time you arrive in a room; use this to do it again, or when the caller asks to see the whole room.',
      {}, view => {
        if (view.mode !== 'interior') return { view, result: { error: 'You are showing the outside or the floor plan. Walk to a room first.' } };
        const next = turnThrough({ ...view, spinBefore: view.spin?.id ?? 0 });
        if (next === view || !next.spin || next.spin.id === (view.spin?.id ?? 0)) return { view, result: { error: 'There is no room to turn through at this spot. Use look instead.' } };
        return { view: next, result: turning(next, view.at) };
      }),
    tool('look', 'Turn the camera where you stand, like turning your phone: left, right, behind you, up at the ceiling, down at the floor, back ahead, or closer (zoom in) and wider (zoom back out). The result says what is now in frame.',
      { direction: pick([...Object.keys(DIRECTIONS), 'closer', 'wider'], 'Which way to turn.') }, (view, { direction }) => {
        if (view.mode !== 'interior') return { view, result: { error: 'You are showing the outside or the floor plan. Walk to a room first.' } };
        const place = places[view.at], now = view.look ?? { direction: 'ahead', yaw: 0, pitch: place.pitch, zoom: 1 };
        let look;
        if (direction === 'closer') look = { ...now, zoom: 1.9 };
        else if (direction === 'wider') look = { ...now, zoom: 1 };
        else if (DIRECTIONS[direction]) look = { direction, yaw: DIRECTIONS[direction].yaw, pitch: DIRECTIONS[direction].pitch ?? place.pitch, zoom: 1 };
        else return { view, result: { error: 'Unknown direction.' } };
        const resting = look.direction === 'ahead' && look.zoom === 1;
        return { view: { ...view, look: resting ? null : look },
          result: { facing: look.direction, zoomedIn: look.zoom > 1, cameraShows: place.see[look.direction] ?? 'No notes for this direction. Describe only what the property brief says about this room.' } };
      }),
    tool('point_at', 'Aim the camera at one specific thing at this spot and zoom in on it, so the caller gets a close look while you talk about it (the fireplace, a window, the sink, the closet shelves). The things you can point at here are listed in thingsToPointAt when you arrive. Pull back afterwards with look ahead.',
      { feature: { type: 'string', description: 'The key of a thing listed in thingsToPointAt at this spot.' } }, (view, { feature }) => {
        if (view.mode !== 'interior') return { view, result: { error: 'You are showing the outside or the floor plan. Walk to a room first.' } };
        const features = places[view.at].features ?? {}, wanted = String(feature ?? '').toLowerCase();
        const key = Object.keys(features).find(k => k === wanted) ?? Object.keys(features).find(k => features[k].label.toLowerCase().includes(wanted) || wanted.includes(k));
        if (!key) return { view, result: { error: `Nothing by that name to point at here. You can point at: ${Object.keys(features).join(', ') || 'nothing mapped at this spot'}.` } };
        const item = features[key];
        return { view: { ...view, look: { direction: `feature:${key}`, yaw: item.yaw, pitch: item.pitch, zoom: item.zoom } },
          result: { pointingAt: item.label, cameraShows: item.say, note: 'Talk about exactly this now. Pull back with look ahead when you move on.' } };
      }),
    tool('paint_wall', 'Repaint the wall in this room any colour the caller names, live on camera. You choose the hex code for the colour they said. Use color "original" to put the wall back.',
      { color: { type: 'string', description: 'Hex colour like #b3202a, or "original".' }, name: { type: 'string', description: 'The colour as you would say it, e.g. "Deep red".' } },
      (view, { color, name }) => {
        if (view.mode !== 'interior') return { view, result: { error: 'You are not in a room. Walk to one first.' } };
        // Paint is mapped from one spot in each room: step over to it if she is elsewhere in that room.
        const room = places[view.at].room;
        const key = [view.at, ...keys].find(k => places[k].room === room && places[k].stop && walls[places[k].stop]);
        if (!key) return { view, result: { error: `No wall is mapped for paint in this room. Rooms you can paint in: ${[...new Set(keys.filter(k => places[k].stop && walls[places[k].stop]).map(label))].join(', ') || 'none yet'}.` } };
        const stop = places[key].stop, paints = { ...view.paints };
        if (color === 'original') delete paints[stop];
        else {
          const hex = /^#?([0-9a-f]{6})$/i.exec(color ?? '')?.[1];
          if (!hex) return { view, result: { error: 'Give the colour as a six-digit hex code, or "original".' } };
          paints[stop] = { rgb: [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)), label: name || `#${hex}` };
        }
        // Face the wall being painted, when it is not straight ahead of where she presents the room from.
        const wall = walls[stop], facing = wall.yaw ? { direction: 'wall', yaw: wall.yaw, pitch: wall.pitch ?? places[key].pitch, zoom: 1 } : null;
        return { view: { ...standAt(view, key), look: facing, paints },
          result: color === 'original' ? { wall: walls[stop].label, restored: 'the scanned wall' }
            : { wall: walls[stop].label, painted: name, note: 'This is a paint preview on the Matterport scan. Say so.' } };
      }),
    tool('stage_room', 'Add, remove or change furniture and finishes in the room on camera (a sofa, a desk by the window, a bed, a style like 1920s vintage, darker floors, take the rug out). A preset appears at once. Any other request takes about twelve seconds to appear: say you are setting it up and keep talking; you are told when it is on screen.',
      { request: { type: 'string', description: 'What to change, in plain words, as the caller wants it.' },
        preset: { type: 'string', description: 'The id of a furniture preset offered at this spot, when one fits the request. Otherwise an empty string.' } },
      (view, { request, preset }, call) => {
        if (view.mode !== 'interior') return { view, result: { error: 'You are not in a room. Walk to one first.' } };
        const place = places[view.at], ready = (presets[place.stop] ?? []).find(item => item.id === preset);
        if (ready) return { view: { ...standAt(view, view.at), sources: { ...view.sources, [place.sweep]: { file: ready.file, label: ready.label } } },
          result: { onScreen: ready.label, note: 'This is an AI staging preview. Say so.' } };
        if (!staging.stagePano) return { view, result: { error: 'Furniture staging is not available right now. Offer a paint colour instead.' } };
        const source = view.sources[place.sweep]?.file ?? scanFile(place), title = String(request).slice(0, 34);
        staging.stagePano({ source, yaw: place.yaw, pitch: place.pitch, request, name: `${view.at}-${Date.now().toString(36)}`, ...(slug ? { outDir: stagedDir } : {}) })
          .then(({ file }) => call.later(current => ({ ...current, sources: { ...current.sources, [place.sweep]: { file, label: title } } }),
            `The staging preview you started is now on screen in the ${place.label}: "${request}". Tell the caller in one short sentence and ask what they think.`))
          .catch(error => {
            console.error('[guide] staging failed:', error?.message ?? error);
            call.later(current => current, `The staging preview for "${request}" did not work. Say so in one short sentence and offer a preset or a paint colour instead.`);
          });
        return { view: standAt(view, view.at), result: { started: request, appearsIn: 'about twelve seconds', note: 'Keep talking about the room meanwhile. Do not say it is on screen yet.' } };
      }),
    tool('clear_changes', 'Put the room on camera back to how it was scanned: remove the furniture preview, the paint, or both.',
      { what: pick(['furniture', 'paint', 'both'], 'What to remove.') }, (view, { what }) => {
        if (!places[view.at]) return { view, result: { error: 'Nothing to restore here.' } };
        const place = places[view.at], paints = { ...view.paints }, sources = { ...view.sources };
        if (what !== 'furniture' && place.stop) delete paints[place.stop];
        if (what !== 'paint') delete sources[place.sweep];
        return { view: { ...view, paints, sources }, result: { restored: what, nowShowing: 'the Matterport scan as captured' } };
      }),
    tool('show_outside', 'Show the home from above: the aerial view with it marked. Use it for parking, the lot, arrival and anything about the grounds or the street. Call walk_to to come back in.',
      {}, view => ({ view: { ...view, mode: 'site', look: null },
        result: { onScreen: `Vexcel aerial: ${tour.site?.title ?? 'the scanned unit and the nearest parking row marked'}`, presentThis: talkingPoints.outside ?? talkingPoints.parking } })),
    tool('show_floor_plan', 'Show the measured floor plan with where you are standing and any planned route. Call walk_to to return to the camera.',
      {}, view => ({ view: { ...view, mode: 'plan', look: null },
        result: { onScreen: 'Floor plan drawn from the Matterport scan', presentThis: talkingPoints.floorplan } })),
  ];

  const instructions = `You are Ellie, the open-house guide for ${persona.who}.
You are an AI guide on a live FaceTime video call. The caller is touring from far away and sees through your
phone's rear camera as you walk the apartment, so do everything a good human open-house guide does on a video tour.

HOW YOU TALK
- Two or three short spoken sentences per turn. Warm, plain, confident. Never read out a list.
- Present each room when you arrive, the way a guide does: what the room is, its size from the scan, the features
  on camera, and one thing about its story or use (the community was built in 1983 and renovated in 2013, for
  example). Use presentThisRoom from the tool result. Then offer the next spot or ask one question.
- Lead. Early on, learn what matters to this ${persona.caller}, then plan a short route for them (plan_route, three or four
  spots, not the whole unit) and say the plan in one sentence that ties each spot to what they told you: "a spot
  for your desk, the living room, then where you'd park". Take them along it without waiting to be told each
  step. If they drive, finish outside with show_outside.
- Say numbers the way people say them. Name the source when it builds trust: "the CoStar record", "the Matterport
  scan", "the Vexcel aerial".
- If asked, you are an AI guide. Never claim to be a person or to be physically in the apartment.

YOUR CAMERA
- You cannot see the picture. Each tool result tells you what is now in frame (cameraShows) and what is next to
  you (nextTo). Talk only about what those and the property brief say. Never invent a fixture, view or finish.
- Move first, then talk: when a room is mentioned ("let's go to the living room"), call walk_to, then present it.
- The first time you arrive in a room the camera turns slowly through the whole room by itself (the result says
  cameraIsTurning and lists what passes, in order). Give a one-sentence intro, narrate those things as they come
  round, then ask if there is anything they would like a closer look at. look_around repeats the turn.
- "Turn around", "what's behind you", "look up", "get closer": use look. The call starts ${persona.start}.
- Point at things. When you talk about one specific thing, or the caller asks about one (the fireplace, the
  windows, the sink, the closet shelves), aim and zoom the camera at it with point_at first, then describe what
  cameraShows says. Whatever the camera is on is what you talk about. Pull back with look ahead before moving on.

CHANGING THE PLACE
- Any wall colour: paint_wall, at once. Furniture and finishes: stage_room. Call every change a preview out loud
  ("here's a paint preview", "this is a staging preview"). A change stays at the spot where you made it.
- After a change, ask what they think or offer one alternative. To undo, clear_changes.

HONESTY
- Use only the property brief below and tool results. For anything the brief lists as not in the data, say you
  will confirm with ${persona.office}. ${persona.care}
- When a tool returns an error, say plainly what happened and offer what you can do instead.

PLACES YOU CAN STAND (the keys for walk_to and plan_route)
${keys.map(key => `- ${key}: ${places[key].label} (${places[key].room})${key === entrance ? ', where the call starts' : ''}`).join('\n')}

${propertyBrief}`;

  const greeting = `Say hello in two short sentences: you are Ellie, the AI guide for ${persona.short},
you are ${persona.start}, and invite them in. Then ask what matters most to them in a home.`;

  // Where the camera finds this property's pictures; undefined means the web tour's own folder.
  const mediaDir = slug ? fileURLToPath(new URL(tourDir, here)) : undefined;
  return { instructions, greeting, tools, initialView, places, entrance, mediaDir };
}
