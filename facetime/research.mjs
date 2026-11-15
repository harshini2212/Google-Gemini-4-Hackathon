// The research desk behind the guide: a Deep Agent (LangChain's deepagents) with a plan, a workspace and two
// specialists, working over the CoStar listings data while Ellie keeps the caller company.
//
//   research(question)   a question from a live call: comparable homes, how this one compares, what the records
//                        disagree on, a monthly payment from the caller's own numbers. Returns what Ellie should say
//                        and a card for the screen, in about twenty seconds.
//   followUp(note)       after a visit: writes a follow-up for the visitor and a brief for the listing agent as files.
//
// It answers only from its tools. The voice call never waits on it: guide.mjs starts it and is told when it is done.
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeepAgent, FilesystemBackend } from 'deepagents';
import { todoListMiddleware, tool } from 'langchain';
import { z } from 'zod';

const here = new URL('./', import.meta.url);
const LEAD = process.env.OPEN_HOUSE_RESEARCH_MODEL || 'anthropic:claude-sonnet-5-5';
const HELPER = process.env.OPEN_HOUSE_RESEARCH_HELPER || 'anthropic:claude-haiku-5-5';
const KIT = process.env.OPEN_HOUSE_KIT || join(homedir(), 'brace/data/kit/data');

// ---- the data -------------------------------------------------------------------------------------------------------

const STATUS = { 1: 'for sale', 2: 'pending', 4: 'closed', 8: 'withdrawn', 16: 'expired' };
const day = text => text ? String(text).slice(0, 10) : null;

/** One listing as the few facts a comparison needs. Prices are list prices: the data has no sale prices. */
function brief(row, home) {
  const p = row.property ?? {}, a = p.address ?? {}, reso = row.resoValues ?? {};
  const price = row.currentPrice ?? reso.listPrice ?? row.originalPrice ?? null, sqft = p.sqftMin ?? null;
  const end = row.closeDate ?? row.offMarketDate, days = row.listDate ? Math.round((new Date(end ?? Date.now()) - new Date(row.listDate)) / 864e5) : null;
  const miles = home && a.latitude != null ? Math.hypot((a.latitude - home.lat) * 69, (a.longitude - home.lon) * 69 * Math.cos(home.lat * Math.PI / 180)) : null;
  return {
    id: row.id, address: a.fullStreetAddress, zip: a.zip, type: p.mlsPropertyType, beds: p.bedsMin ?? null, baths: p.bathsMin ?? null,
    sqft, lotAcres: p.lotSizeAcresMin ?? null, yearBuilt: p.yearBuilt ?? null, status: STATUS[row.listingStatus] ?? 'unknown',
    listPrice: price, originalListPrice: row.originalPrice ?? null, pricePerSqft: price && sqft ? Math.round(price / sqft) : null,
    listed: day(row.listDate), closed: day(row.closeDate), daysOnMarket: days,
    hoaPerMonth: reso.hoa?.totalFeesPerMonth ?? null, taxesPerYear: p.taxes ?? null, garageSpaces: reso.structure?.garageSpaces ?? null,
    pool: Boolean(reso.poolType), subdivision: p.subdivision ?? null, milesAway: miles == null ? null : Math.round(miles * 10) / 10,
  };
}

let loaded = null;
async function listings() {
  loaded ??= readFile(join(KIT, 'residential-listings.jsonl'), 'utf8').then(text => text.split('\n').filter(Boolean).map(line => JSON.parse(line)));
  return loaded;
}

/** The home being shown: its listing, where it is, and the guide's own brief about it. */
async function subject(slug) {
  const site = JSON.parse(await readFile(new URL(`./properties/${slug}/site.json`, here), 'utf8'));
  if (!site.listing?.propertyId) throw new Error(`The property ${slug} has no listing to research from`);
  const row = (await listings()).find(item => item.propertyId === site.listing.propertyId);
  if (!row) throw new Error('The home\'s listing is not in the listings data');
  const { propertyBrief } = await import(new URL(`./properties/${slug}/knowledge.mjs`, here));
  const a = row.property.address;
  return { row, name: site.guide?.short ?? a.fullStreetAddress, lat: a.latitude, lon: a.longitude, propertyBrief };
}

// ---- the tools ------------------------------------------------------------------------------------------------------

function tools(home) {
  const searchListings = tool(async ({ withinMiles = 5, zip, minBeds, maxBeds, minPrice, maxPrice, minSqft, maxSqft, status = 'any', sortBy = 'distance', limit = 8 }) => {
    const all = (await listings()).filter(row => row.transactionType === 1 && row.id !== home.row.id).map(row => brief(row, home));
    const found = all.filter(item => item.listPrice && item.sqft && item.milesAway != null && item.milesAway <= withinMiles
      && (!zip || item.zip === zip) && (minBeds == null || item.beds >= minBeds) && (maxBeds == null || item.beds <= maxBeds)
      && (minPrice == null || item.listPrice >= minPrice) && (maxPrice == null || item.listPrice <= maxPrice)
      && (minSqft == null || item.sqft >= minSqft) && (maxSqft == null || item.sqft <= maxSqft)
      && (status === 'any' || item.status === status));
    const order = { distance: (a, b) => a.milesAway - b.milesAway, price: (a, b) => a.listPrice - b.listPrice, price_per_sqft: (a, b) => a.pricePerSqft - b.pricePerSqft };
    return JSON.stringify({ matches: found.length, listings: found.sort(order[sortBy]).slice(0, Math.min(limit, 12)),
      note: 'Prices are list prices from the CoStar residential listings. The data has no sale prices.' });
  }, {
    name: 'search_listings',
    description: 'Search the CoStar residential for-sale listings around the home being shown (Houston). Returns compact rows with list price, size, price per square foot, status, dates and distance. The home itself is left out.',
    schema: z.object({
      withinMiles: z.number().optional().describe('Radius around the home in miles. Default 5. There are few listings within 3 miles.'),
      zip: z.string().optional(), minBeds: z.number().optional(), maxBeds: z.number().optional(),
      minPrice: z.number().optional(), maxPrice: z.number().optional(), minSqft: z.number().optional(), maxSqft: z.number().optional(),
      status: z.enum(['any', 'for sale', 'closed', 'pending']).optional(),
      sortBy: z.enum(['distance', 'price', 'price_per_sqft']).optional(), limit: z.number().optional(),
    }),
  });

  const getListing = tool(async ({ id }) => {
    const row = (await listings()).find(item => item.id === id);
    if (!row) return JSON.stringify({ error: 'No listing with that id.' });
    const reso = row.resoValues ?? {};
    return JSON.stringify({ ...brief(row, home), remarks: String(row.remarks ?? '').slice(0, 700),
      features: Object.fromEntries(Object.entries({ ...row.costarFeatureValues, ...reso }).filter(([key, value]) => /^has[A-Z]/.test(key) && typeof value === 'boolean')),
      stories: reso.structure?.stories ?? null, style: reso.structure?.architecturalStyle ?? null,
      priceHistory: (row.history ?? []).filter(step => step.currentPrice).map(step => ({ date: day(step.date), price: step.currentPrice })) });
  }, { name: 'get_listing', description: 'The fuller record of one listing by id: remarks, features, stories and price history.', schema: z.object({ id: z.number() }) });

  const thisHome = tool(async () => JSON.stringify({ listing: JSON.parse(await getListing.invoke({ id: home.row.id })), guideBrief: home.propertyBrief }),
    { name: 'this_home', description: 'The home being shown: its listing record and the guide\'s sourced brief (CoStar record, Matterport scan measurements, Vexcel aerial notes).', schema: z.object({}) });

  const monthlyPayment = tool(async ({ price, downPaymentPercent, annualRatePercent, years = 30, taxesPerYear = 0, hoaPerMonth = 0 }) => {
    const loan = price * (1 - downPaymentPercent / 100), rate = annualRatePercent / 100 / 12, n = years * 12;
    const principalAndInterest = rate ? loan * rate / (1 - (1 + rate) ** -n) : loan / n;
    return JSON.stringify({ loan: Math.round(loan), principalAndInterest: Math.round(principalAndInterest), taxes: Math.round(taxesPerYear / 12), hoa: Math.round(hoaPerMonth),
      total: Math.round(principalAndInterest + taxesPerYear / 12 + hoaPerMonth), note: 'Arithmetic from the numbers given. Insurance and other costs are not included. Not a loan offer.' });
  }, {
    name: 'monthly_payment',
    description: 'Monthly payment arithmetic. Use only with a down payment and an interest rate the caller gave; never pick a rate for them.',
    schema: z.object({ price: z.number(), downPaymentPercent: z.number(), annualRatePercent: z.number(), years: z.number().optional(), taxesPerYear: z.number().optional(), hoaPerMonth: z.number().optional() }),
  });
  return { searchListings, getListing, thisHome, monthlyPayment };
}

const RULES = `Answer only from tool results. Every number comes with where it is from. The listings data has list prices,
never sale prices: say "listed at", not "sold for". If the data cannot answer, say what is missing. Never comment on
safety, schools' quality or who lives in an area. Be quick: one round of tool calls is usually enough.`;

function specialists(kit) {
  return [
    { name: 'comps-analyst', model: HELPER, tools: [kit.searchListings, kit.getListing, kit.thisHome],
      description: 'Finds the most comparable listings near the home and works out how the home compares on price, size and price per square foot.',
      systemPrompt: `You find comparable homes for a for-sale listing. Call this_home once, then search_listings (start within 5 miles,
similar beds and within about 25% of the size; include both for-sale and closed listings; widen once if fewer than three).
Return the three or four closest matches as a small table (address, beds/baths, sq ft, list price, $/sq ft, status, miles away)
and two sentences on how the home compares. ${RULES}` },
    { name: 'listing-auditor', model: HELPER, tools: [kit.thisHome, kit.getListing],
      description: 'Checks the home\'s own listing record, remarks and scan measurements against each other and lists what disagrees and what a buyer should confirm.',
      systemPrompt: `You audit one listing. Call this_home and compare the record, the written remarks and the scan notes in the
guide's brief. Return a short list of points where they disagree (what each source says) and what to confirm with the listing
agent. ${RULES}` },
  ];
}

// ---- a question from a live call ------------------------------------------------------------------------------------

const Answer = z.object({
  spoken: z.string().describe('What the guide says aloud: two or three short spoken sentences, numbers said the way people say them, with the source named once.'),
  title: z.string().describe('A title for the card on screen, five words at most.'),
  rows: z.array(z.object({ label: z.string().describe('Up to five words'), text: z.string().describe('One line, at most 130 characters') })).max(5)
    .describe('The card: one row per comparable home or finding, most useful first.'),
  sources: z.array(z.string()).describe('Where the figures came from, e.g. "CoStar residential listings".'),
});

/** Answers one question about the home from the listings data. Resolves to { spoken, card, seconds }. */
export async function research(question, slug = process.env.OPEN_HOUSE_PROPERTY || 'alex-springs') {
  const started = Date.now(), home = await subject(slug), kit = tools(home);
  const agent = createDeepAgent({
    model: LEAD, tools: [kit.thisHome, kit.monthlyPayment], subagents: specialists(kit), middleware: [todoListMiddleware()],
    systemPrompt: `You are the research desk behind Ellie, an open-house guide who is on a live video call showing ${home.name}.
A caller asked something she cannot answer from memory, and she is waiting. Decide what is needed, delegate with the task tool
(comps-analyst for comparable homes and price comparisons, listing-auditor for what the records disagree on; call both at once
when the question needs both), use monthly_payment only with the caller's own down payment and rate, then give the answer.
${RULES}
Your final reply must be one JSON object and nothing else, in this shape:
{"spoken": "at most three short sentences the guide says aloud, numbers the way people say them, the source named once",
 "title": "a card title, five words at most",
 "rows": [{"label": "up to five words", "text": "one line, at most 130 characters"}],   // at most five, most useful first
 "sources": ["at most three, a few words each, e.g. CoStar residential listings"]}`,
  });
  const result = await agent.invoke({ messages: [{ role: 'user', content: question }] }, { recursionLimit: 40 });
  // The model's last message is the answer as JSON, sometimes wrapped in a code fence or a sentence.
  const last = result.messages.at(-1).content;
  const text = typeof last === 'string' ? last : last.map(block => block.text ?? '').join('');
  const answer = Answer.parse(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)));
  return { spoken: answer.spoken, seconds: Math.round((Date.now() - started) / 1000),
    card: { title: answer.title, rows: answer.rows, footer: answer.sources.slice(0, 3).map(source => source.slice(0, 34)).join(' · ') || 'CoStar residential listings' } };
}

// ---- after a visit --------------------------------------------------------------------------------------------------

/**
 * Turns the note the guide saves at the end of a visit into a follow-up packet, written as files in `folder`:
 * a message for the visitor, a brief for the listing agent, and the comparable homes. Resolves to the file names.
 */
export async function followUp(note, folder, slug = process.env.OPEN_HOUSE_PROPERTY || 'alex-springs') {
  const home = await subject(slug), kit = tools(home);
  await mkdir(folder, { recursive: true });
  const agent = createDeepAgent({
    model: LEAD, tools: [kit.thisHome, kit.monthlyPayment], subagents: specialists(kit), middleware: [todoListMiddleware()],
    backend: new FilesystemBackend({ rootDir: folder, virtualMode: true }),
    systemPrompt: `You are the back office of an open-house guide. A visitor has just toured ${home.name} by video call. From the
visit note you are given, plan the work with write_todos, delegate to comps-analyst and listing-auditor, and write three files:
/follow-up.md   a short, warm message to the visitor: what they saw and liked, answers to their questions where the data has
                them, the comparable homes in one small table, and the next step they chose. No pressure, no promises.
/listing-agent-brief.md   for the listing agent: who toured, what they liked and previewed, their concerns, each item to
                confirm with what the record does and does not say, and a suggested next action.
/comps.md       the comparable homes table and two sentences on how this home compares.
In the note, "previewed" lists paint colours and furniture the guide showed as previews on the scan during the call: ideas
the visitor tried out, not features of the home. Mention them as such ("you tried a deep red on the long wall").
${RULES} When the three files are written, reply with one line listing them.`,
  });
  await agent.invoke({ messages: [{ role: 'user', content: `Visit note:\n${JSON.stringify(note, null, 2)}` }] }, { recursionLimit: 60 });
  return ['follow-up.md', 'listing-agent-brief.md', 'comps.md'].map(name => join(folder, name));
}

export const available = slug => readFile(new URL(`./properties/${slug}/site.json`, here), 'utf8')
  .then(text => Boolean(JSON.parse(text).listing?.propertyId) && Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPEN_HOUSE_RESEARCH_MODEL), () => false);

// node --env-file=.env.local research.mjs "question"            tries a question from the command line
// node research.mjs --follow-up <visit note.json>                writes the follow-up packet beside the note; the
//                                                                guide starts this as its own process when a call ends
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--follow-up') {
    const file = process.argv[3], note = JSON.parse(await readFile(file, 'utf8'));
    const files = await followUp(note, file.replace(/\.json$/, ''));
    console.log(`[research] follow-up packet written: ${files.join(', ')}`);
  } else {
    const answer = await research(process.argv[2] || 'What similar homes are for sale nearby, and how does this one compare?');
    console.log(JSON.stringify(answer, null, 2));
  }
}
