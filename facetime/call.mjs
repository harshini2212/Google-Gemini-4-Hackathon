// Has the guide place a FaceTime Video call to a phone, instead of waiting to be called.
//   node --env-file=.env.local call.mjs +15555550123
// Needs in .env.local: CHERT_API_KEY (a project API key from https://app.trychert.com/developer, owners only)
// and CHERT_PROJECT_ID, next to the LiveKit values. The agent must be running (npm start). Call only people who
// agreed to it. This goes through Chert's HTTP API, since `chert dev` does not place outbound calls.
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, AGENT_NAME, CHERT_API_KEY, CHERT_PROJECT_ID } = process.env;
const destination = (process.argv[2] ?? '').replace(/[^\d+]/g, '').replace(/^(\d{10})$/, '+1$1');
if (!/^\+\d{8,15}$/.test(destination)) { console.error('Give the number to call, e.g. +15555550123'); process.exit(2); }
if (!CHERT_API_KEY || !CHERT_PROJECT_ID) { console.error('CHERT_API_KEY and CHERT_PROJECT_ID are missing from .env.local'); process.exit(3); }

const api = 'https://app.trychert.com/api/v1';
async function chert(method, path, body) {
  const response = await fetch(api + path, { method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(20_000), headers: {
    Authorization: `Bearer ${CHERT_API_KEY}`, 'X-Chert-Project-Id': CHERT_PROJECT_ID, 'Content-Type': 'application/json',
    ...(method === 'POST' ? { 'Idempotency-Key': randomUUID() } : {}) } });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  if (!response.ok) throw new Error(`Chert ${method} ${path} -> ${response.status} ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

const lines = await chert('GET', '/lines');
const line = (lines.data?.items ?? lines.lines ?? lines.data ?? lines)[0];
if (!line?.id) throw new Error('This project has no line.');
console.log(`Line: ${line.display_name ?? line.id} (${line.status})`);

// The room the call runs in, with the guide already in it.
const http = LIVEKIT_URL.replace(/^ws/, 'http');
const rooms = new RoomServiceClient(http, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const room = `outbound-${Date.now().toString(36)}`;
await rooms.createRoom({ name: room, emptyTimeout: 120 });
await new AgentDispatchClient(http, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).createDispatch(room, AGENT_NAME);
let guide;
for (let i = 0; i < 100 && !guide; i++) { guide = (await rooms.listParticipants(room))[0]; if (!guide) await pause(200); }
if (!guide) throw new Error(`The agent "${AGENT_NAME}" did not join. Is npm start running?`);

const bridge = `chert-bridge-${room}`;
// Chert checks the bridge's token before dialling: one room, join + publish + subscribe spelled out, at most two hours.
const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: bridge, ttl: 60 * 60 });
token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
const call = await chert('POST', '/calls', { direction: 'outbound', mode: 'customer_managed', line_id: line.id, destination,
  media: { audio: true, video: true }, livekit_url: LIVEKIT_URL, participant_token: await token.toJwt(),
  remote_participant_identity: guide.identity, when_busy: 'queue' })
  .catch(async error => { await rooms.deleteRoom(room).catch(() => {}); console.error(error.message); process.exit(1); });
const id = call.data?.id ?? call.id ?? call.call?.id ?? call.call_id;
console.log(JSON.stringify(call, (key, value) => /token|secret|key/i.test(key) ? '<hidden>' : value).replace(/\+\d{7,}/g, m => '+…' + m.slice(-4)).slice(0, 700));
console.log(`Calling ${destination.slice(0, -4).replace(/\d/g, '•')}${destination.slice(-4)} · call ${id}`);

// chert dev is not in this call, so nothing tells the guide FaceTime is ready: watch the call and tell her.
let greeted = false, last = '';
for (;;) {
  await pause(1000);
  const now = await chert('GET', `/calls/${id}`).catch(error => ({ state: `unknown (${error.message.slice(0, 80)})` }));
  const state = String(now.data?.state ?? now.data?.status ?? now.state ?? now.status ?? now.call?.state ?? 'unknown');
  if (state !== last) { console.log(`  ${state}`); last = state; }
  const there = (await rooms.listParticipants(room).catch(() => [])).some(participant => participant.identity === bridge);
  if (!greeted && (there || /ready|connected|active|in_progress|answered/i.test(state))) {
    greeted = true;
    await rooms.updateRoomMetadata(room, JSON.stringify({ chert_bridge_ready: true, chert_call: id }));
    console.log('  FaceTime is ready: the guide greets now.');
  }
  if (/ended|failed|declined|cancel|completed|no_answer|busy|error/i.test(state)) break;
}
await rooms.deleteRoom(room).catch(() => {});
