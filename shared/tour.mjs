export const initialView = { mode: "interior", stop: "living", finish: "original", route: [], path: [] };

export const finishes = {
  original: { label: "Original", color: "#adb0af" },
  sage: { label: "Soft sage", color: "#819576" },
  clay: { label: "Warm clay", color: "#bc826e" },
};

export const destinations = {
  living: "Living room",
  desk: "Dining nook",
  kitchen: "Kitchen",
  bedroom: "Bedroom",
  patio: "Patio",
  parking: "Parking",
  floorplan: "Floor plan",
};

function choice(values, description) {
  return { type: "string", enum: values, description };
}

function tool(name, description, properties = {}) {
  return {
    name, description,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
  };
}

const stop = choice(Object.keys(destinations), "A tour destination. Use desk for the window-facing work spot.");

export const tourTools = [
  tool("inspect_tour", "Find the current view, finish, saved route and next stop."),
  tool("show_view", "Move the shared tour to a room, the site parking view or the measured floor plan.", { stop }),
  tool("plan_tour", "Make an ordered route tailored to the visitor and open its first stop. Include parking when the visitor asks about driving or arrivals.", {
    stops: { type: "array", items: stop, minItems: 2, maxItems: 5 },
  }),
  tool("next_stop", "Advance the shared tour to the next stop in the saved route."),
  tool("preview_finish", "Move to the fireplace wall and switch its Blender paint preview, or restore the original Matterport scan.", {
    finish: choice(Object.keys(finishes), "The wall finish."),
  }),
  tool("read_property", "Read source facts for a question about a desk, the unit layout, rent or parking. Use this before stating numbers.", {
    topic: choice(["desk", "layout", "parking", "rent"], "The question's topic."),
  }),
];

export const guideInstructions = `You are the live open-house guide for the A5 at The Parker at Ellington.
Speak directly to a renter in one to three brief sentences. Use the tour tools to move the shared view
when the renter wants to see something. For multiple stops, call plan_tour, start at the first stop, and
invite the visitor to continue. If they say next or continue, call next_stop. For a work-from-home spot,
show the dining nook or include desk in the route and get the desk facts. For parking or car arrival,
show the site or include parking in the route and get the parking facts. Tie what the visitor can see
to the property record or the scan as appropriate. Source facts by saying "the CoStar record,"
"the Matterport scan," or "the Vexcel aerial" when relevant. Cite no unavailable facts. For a wall
finish, call preview_finish and say it is a paint preview. You can change soft sage, warm clay or restore
the original. Unknown finishes can be offered these two choices. Treat asking rent as a dataset
snapshot, parking totals as community-wide, and the aerial line as an estimate between two points.
Never infer availability, assigned parking, accessible routes, desk clearance, rules, or live rents
from a visual. Describe the registered scan point and parking row, and keep exact doors unverified.
When a tool returns an error, say what happened without claiming the view changed.`;

export function normalizeView(tour, value = {}) {
  const stop = Object.hasOwn(tour.stops, value?.stop) ? value.stop : initialView.stop;
  const mode = ["interior", "site", "plan"].includes(value?.mode) ? value.mode : initialView.mode;
  const finish = Object.hasOwn(finishes, value?.finish) ? value.finish : initialView.finish;
  const route = Array.isArray(value?.route) ? [...new Set(value.route.filter(key => Object.hasOwn(destinations, key)))].slice(0, 5) : [];
  return { mode, stop, finish, route, path: routePath(tour, route) };
}

export function currentDestination(view) {
  if (view.mode === "site") return "parking";
  if (view.mode === "plan") return "floorplan";
  return view.stop;
}

function navigate(state, stop) {
  if (stop === "parking") return { ...state, mode: "site" };
  if (stop === "floorplan") return { ...state, mode: "plan" };
  return { ...state, mode: "interior", stop };
}

function shortestPath(tour, start, goal) {
  const sweeps = new Map(tour.sweeps.map(sweep => [sweep.id, sweep]));
  const distance = new Map([[start, 0]]);
  const previous = new Map();
  const pending = new Set(sweeps.keys());
  while (pending.size) {
    const current = [...pending].reduce((closest, id) =>
      (distance.get(id) ?? Infinity) < (distance.get(closest) ?? Infinity) ? id : closest);
    const cost = distance.get(current);
    if (cost === undefined) break;
    if (current === goal) {
      const path = [current];
      while (previous.has(path[0])) path.unshift(previous.get(path[0]));
      return { path, cost };
    }
    pending.delete(current);
    const from = sweeps.get(current);
    for (const id of from.neighbors) {
      if (!pending.has(id)) continue;
      const to = sweeps.get(id);
      const next = cost + Math.hypot(from.x - to.x, from.y - to.y);
      if (next >= (distance.get(id) ?? Infinity)) continue;
      distance.set(id, next);
      previous.set(id, current);
    }
  }
  return null;
}

function routePath(tour, stops) {
  return stops.slice(1).flatMap((key, index) => {
    const from = tour.stops[stops[index]];
    const to = tour.stops[key];
    if (!from || !to) return [];
    const segment = shortestPath(tour, from.sweep, to.sweep);
    return segment ? [segment.path] : [];
  });
}

function propertyFacts(tour, topic) {
  const { property, floor, site } = tour;
  switch (topic) {
    case "parking":
      return {
        address: `${property.address}, ${property.city}, ${property.state}`,
        propertySource: "CoStar property record",
        communityParkingSpaces: property.parking_spaces,
        communityHasCoveredParking: property.covered_parking,
        imageSource: "Vexcel aerial, " + site.capture,
        observation: "A parking row is visible along the driveway beside the scanned building.",
        scanSource: "Georeferenced Matterport scan",
        straightLineFeet: site.distanceFt,
        limitation: "Space assignment, availability, exact unit access and the walking route need local confirmation.",
      };
    case "rent":
      return { source: "CoStar A5 listing snapshot", askingRentUsd: [floor.minRent, floor.maxRent],
        limitation: "Confirm current rent and availability with leasing." };
    case "desk": {
      const room = tour.rooms.find(item => item.id === tour.stops.desk.roomId);
      return { source: "Matterport scan and room boundary", room: "Dining nook",
        scannedAreaSqFt: room?.area_sqft,
        observation: "The nook has a window and adjoins the kitchen. The window wall is visible from this view.",
        limitation: "Confirm clearance for the visitor's desk before purchasing furniture." };
    }
    case "layout":
      return { source: "CoStar A5 listing and Matterport scan", bedrooms: floor.numBeds, bathrooms: floor.numBaths,
        advertisedSqFt: floor.minSquareFeet, measuredIndoorSqFt: floor.scanAreaSqft,
        rooms: tour.rooms.map(room => room.type) };
    default:
      return { error: "Unknown property topic." };
  }
}

export function executeTourTool(tour, state, name, args = {}) {
  const current = currentDestination(state);
  const routeIndex = state.route.indexOf(current);
  const next = state.route[routeIndex + 1];
  let view = state;
  switch (name) {
    case "inspect_tour":
      return { view, result: { current, finish: state.finish, route: state.route, next: next ?? null } };
    case "show_view":
      if (!Object.hasOwn(destinations, args?.stop)) return { view, result: { error: "Unknown destination." } };
      view = navigate(state, args.stop);
      return { view, result: { shown: destinations[args.stop], source: args.stop === "parking" ? "Vexcel aerial joined to Matterport scan and CoStar record" : "Matterport scan" } };
    case "plan_tour": {
      if (!Array.isArray(args?.stops)) return { view, result: { error: "A list of destinations is required." } };
      const route = [...new Set(args.stops)];
      if (route.length < 2 || route.length > 5 || route.some(key => !Object.hasOwn(destinations, key))) {
        return { view, result: { error: "Choose two to five distinct destinations." } };
      }
      const path = routePath(tour, route);
      view = navigate({ ...state, route, path }, route[0]);
      return { view, result: { route: route.map(key => destinations[key]), shown: destinations[route[0]],
        mappedIndoorLegs: path.length, next: destinations[route[1]] } };
    }
    case "next_stop":
      if (!next) return { view, result: { error: "There is no next stop in the current route." } };
      view = navigate(state, next);
      return { view, result: { shown: destinations[next] } };
    case "preview_finish":
      if (!Object.hasOwn(finishes, args?.finish)) return { view, result: { error: "Available finishes are original, soft sage and warm clay." } };
      view = { ...navigate(state, "living"), finish: args.finish };
      return { view, result: { shown: destinations.living, finish: finishes[args.finish].label,
        source: args.finish === "original" ? "Original Matterport scan" : "Blender paint preview on the Matterport scan" } };
    case "read_property":
      return { view, result: propertyFacts(tour, args?.topic) };
    default:
      return { view, result: { error: "Unknown tour action." } };
  }
}
