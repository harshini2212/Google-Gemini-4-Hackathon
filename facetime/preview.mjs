// The call in a browser tab, for looking at the guide without a phone: http://localhost:5190
// It joins a LiveKit room as the caller with your microphone, exactly as the FaceTime bridge would. The agent
// must be running (npm start). It uses no Chert minutes.   node --env-file=.env.local preview.mjs
import { createServer } from 'node:http';
import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, AGENT_NAME } = process.env;
const port = Number(process.env.PREVIEW_PORT || 5190);
// With TOUR_ORIENTATION=portrait the agent sends the picture on its side, for a phone held upright: stand it up
// again here, as FaceTime does. Otherwise the picture is wide, as on a phone held sideways.
const upright = process.env.TOUR_ORIENTATION === 'portrait';
const http = LIVEKIT_URL.replace(/^ws/, 'http');
const rooms = new RoomServiceClient(http, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const dispatch = new AgentDispatchClient(http, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open House · call preview</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d1413; color: #f6f5ef;
    font: 16px/1.4 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; }
  main { width: min(1120px, 100vw); padding: 16px; }
  .screen { position: relative; aspect-ratio: 16 / 9; background: #18211f; border-radius: 18px; overflow: hidden; }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .screen.upright { aspect-ratio: 9 / 16; height: min(82vh, 860px); margin: 0 auto; border-radius: 34px; }
  .screen.upright video { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(90deg); }
  .idle { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 24px; }
  .idle h1 { font: 400 40px/1.1 Georgia, serif; margin: 0 0 8px; }
  .idle p { margin: 0; opacity: .7; }
  .bar { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 14px 4px 0; flex-wrap: wrap; }
  button { font: inherit; font-weight: 600; border: 0; border-radius: 999px; padding: 12px 26px; cursor: pointer; color: #fff; background: #2fa84f; }
  button.end { background: #e0483c; }
  button:disabled { opacity: .5; cursor: default; }
  #status { opacity: .75; }
</style>
</head>
<body>
<main>
  <div class="screen${upright ? ' upright' : ''}" id="screen">
    <video id="video" autoplay playsinline muted></video>
    <div class="idle" id="idle"><div><h1>Call Ellie</h1><p>The same call FaceTime would make, in this tab. Allow the microphone, then just talk.</p></div></div>
  </div>
  <div class="bar"><span id="status">Not in a call</span><button id="call">Call</button></div>
  <audio id="audio" autoplay></audio>
</main>
<script src="https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js"></script>
<script>
const $ = id => document.getElementById(id);
// Upright, the video is turned a quarter turn, so it is as wide as the screen is tall.
const fit = () => { if (!$('screen').classList.contains('upright')) return; $('video').style.width = $('screen').clientHeight + 'px'; $('video').style.height = $('screen').clientWidth + 'px'; };
addEventListener('resize', fit); fit();
let room = null, name = null;
const say = text => { $('status').textContent = text; };
async function hangUp() {
  const leaving = room, was = name;
  room = null; name = null;
  $('call').textContent = 'Call'; $('call').className = ''; $('idle').hidden = false; say('Call ended');
  if (leaving) await leaving.disconnect();
  if (was) fetch('/hangup', { method: 'POST', body: was });
}
async function call() {
  $('call').disabled = true; say('Calling…');
  try {
    const start = await (await fetch('/call', { method: 'POST' })).json();
    if (start.error) throw new Error(start.error);
    name = start.room;
    room = new LivekitClient.Room();
    room.on(LivekitClient.RoomEvent.TrackSubscribed, track => {
      if (track.kind === 'video') { track.attach($('video')); $('idle').hidden = true; }
      else { track.attach($('audio')); fetch('/ready', { method: 'POST', body: name }); say('Connected. Say hello.'); }
    });
    room.on(LivekitClient.RoomEvent.Disconnected, () => { if (room) hangUp(); });
    await room.connect(start.url, start.token);
    await room.localParticipant.setMicrophoneEnabled(true);
    say('Ringing…');
    $('call').textContent = 'End call'; $('call').className = 'end';
  } catch (error) { say('Could not start the call: ' + error.message); await hangUp(); }
  $('call').disabled = false;
}
$('call').onclick = () => room ? hangUp() : call();
addEventListener('pagehide', () => { if (name) navigator.sendBeacon('/hangup', name); });
</script>
</body>
</html>`;

const body = async req => { let text = ''; for await (const chunk of req) text += chunk; return text.slice(0, 200); };
const mine = name => /^preview-[a-z0-9]+$/.test(name);

createServer(async (req, res) => {
  const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  try {
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '')) return json(403, { error: 'Use a localhost address.' });
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page); }
    if (req.method === 'POST' && req.url === '/call') {
      const room = `preview-${Date.now().toString(36)}`;
      await rooms.createRoom({ name: room, emptyTimeout: 60 });
      await dispatch.createDispatch(room, AGENT_NAME);
      const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: 'chert-bridge-preview' });
      token.addGrant({ roomJoin: true, room });
      return json(200, { room, url: LIVEKIT_URL, token: await token.toJwt() });
    }
    if (req.method === 'POST' && (req.url === '/ready' || req.url === '/hangup')) {
      const room = await body(req);
      if (!mine(room)) return json(400, { error: 'Unknown call.' });
      // The same signal chert dev gives when FaceTime is ready: the guide greets on it.
      if (req.url === '/ready') await rooms.updateRoomMetadata(room, JSON.stringify({ chert_bridge_ready: true }));
      else await rooms.deleteRoom(room).catch(() => {});
      return json(200, {});
    }
    json(404, { error: 'Not found.' });
  } catch (error) {
    console.error('[preview]', error?.message ?? error);
    json(500, { error: 'The preview could not reach LiveKit.' });
  }
}).listen(port, '127.0.0.1', () => console.log(`Call preview · http://localhost:${port} (agent: ${AGENT_NAME})`));
