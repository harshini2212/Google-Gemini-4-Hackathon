// A rehearsal call without a phone: joins a LiveKit room as the caller, speaks the demo questions with the Mac's
// voice, and saves what the caller would see and hear. It uses no Chert minutes. The agent must be running (npm start).
//   node --env-file=.env.local rehearse.mjs <output folder> ["question" ...]
// Saves call.mp4 (the whole call with both voices, when ffmpeg is installed; REHEARSE_FILM=0 skips it), a frame after each answer,
// guide.wav, and prints a transcript of the guide.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackPublishOptions, TrackSource, VideoBufferType, VideoStream } from '@livekit/rtc-node';
import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import sharp from 'sharp';

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, OPENAI_API_KEY, AGENT_NAME } = process.env;
const out = process.argv[2] || 'rehearsal';
const questions = process.argv.length > 3 ? process.argv.slice(3) : [
  'I work from home and I drive. Can you show me around?',
  'Can you put a desk there?',
  "Let's go to the living room.",
  'Could that wall be red?',
  "What's the rent?",
  "What's behind you?",
  'Where would I park?',
];
mkdirSync(out, { recursive: true });
const RATE = 24000, FPS = 15, started = Date.now();
const log = text => console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s] ${text}`);

const http = LIVEKIT_URL.replace(/^ws/, 'http');
const rooms = new RoomServiceClient(http, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const roomName = `rehearsal-${Date.now().toString(36)}`;
await rooms.createRoom({ name: roomName, emptyTimeout: 60 });
await new AgentDispatchClient(http, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).createDispatch(roomName, AGENT_NAME);
const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: 'chert-bridge-rehearsal' });
token.addGrant({ roomJoin: true, room: roomName });

// One sound track for the recording: everything is placed by the time it happened since the first video frame.
let recordingFrom = 0, sound = new Int16Array(RATE * 60), guideAt = -1;
const place = (samples, at) => {
  if (at + samples.length > sound.length) { const grown = new Int16Array(Math.max(sound.length * 2, at + samples.length)); grown.set(sound); sound = grown; }
  for (let i = 0; i < samples.length; i++) sound[at + i] = Math.max(-32768, Math.min(32767, sound[at + i] + samples[i]));
};
const sampleNow = () => Math.max(0, Math.round((Date.now() - recordingFrom) / 1000 * RATE));

const room = new Room();
let heard = [], lastLoud = 0, spoke = false, frames = 0, latest = null, firstFrame = 0;
room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
  log(`subscribed to ${track.kind === TrackKind.KIND_VIDEO ? 'video' : 'audio'} from ${participant.identity}`);
  if (track.kind === TrackKind.KIND_AUDIO) (async () => {
    for await (const frame of new AudioStream(track, RATE, 1)) {
      const samples = Int16Array.from(frame.data);
      heard.push(samples);
      if (recordingFrom) { if (guideAt < 0) guideAt = sampleNow(); place(samples, guideAt); guideAt += samples.length; }
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      if (peak > 900) { lastLoud = Date.now(); spoke = true; }
    }
  })();
  else (async () => {
    for await (const event of new VideoStream(track)) { latest = event.frame; frames++; firstFrame ||= Date.now(); }
  })();
});
await room.connect(LIVEKIT_URL, await token.toJwt(), { autoSubscribe: true, dynacast: false });
log(`joined ${roomName} as the caller`);

// The caller's microphone: silence, except while a question plays.
// REHEARSE_MIC_DELAY (ms) publishes the microphone late, the way a phone bridge may.
await pause(Number(process.env.REHEARSE_MIC_DELAY) || 0);
const mic = new AudioSource(RATE, 1);
await room.localParticipant.publishTrack(LocalAudioTrack.createAudioTrack('caller-mic', mic),
  new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
let queue = new Int16Array(0), open = true;
(async () => {
  const CHUNK = RATE / 100;
  while (open) {
    const chunk = new Int16Array(CHUNK);
    chunk.set(queue.subarray(0, CHUNK));
    queue = queue.subarray(Math.min(CHUNK, queue.length));
    await mic.captureFrame(new AudioFrame(chunk, RATE, 1, CHUNK));
  }
})();

function speech(text) {
  const file = join(out, 'question.wav');
  execFileSync('say', ['-o', file, '--data-format=LEI16@24000', text]);
  const wav = readFileSync(file), at = wav.indexOf('data') + 8;
  return new Int16Array(wav.buffer.slice(wav.byteOffset + at, wav.byteOffset + at + ((wav.length - at) & ~1)));
}

const picture = () => latest.convert(VideoBufferType.RGBA);
async function snapshot(name) {
  if (!latest) return log(`no video frame for ${name}`);
  const frame = picture();
  await sharp(Buffer.from(frame.data), { raw: { width: frame.width, height: frame.height, channels: 4 } })
    .jpeg({ quality: 84 }).toFile(join(out, `${name}.jpg`));
  log(`saved ${name}.jpg (${frame.width}x${frame.height})`);
}

/** Waits for the guide to start talking and then stop for a moment. */
async function reply(limit = 40000) {
  const from = Date.now();
  spoke = false;
  while (Date.now() - from < limit) {
    if (spoke && Date.now() - lastLoud > 1400) return true;
    await pause(100);
  }
  log(spoke ? 'the guide was still talking at the time limit' : 'the guide did not answer');
  return false;
}

const waitUntil = async (test, limit) => { const from = Date.now(); while (!test() && Date.now() - from < limit) await pause(100); return test(); };
if (!await waitUntil(() => frames > 0, 25000)) log('NO VIDEO arrived from the agent');
else log('first video frame arrived');

// The recording: the picture as it stood at each fifteenth of a second, encoded as it goes.
// The first ffmpeg that actually runs here (a Mac can have one built for the other processor ahead of it on the PATH).
const ffmpeg = process.env.REHEARSE_FILM === '0' ? null : [process.env.FFMPEG, '/opt/homebrew/bin/ffmpeg', 'ffmpeg'].find(bin => bin && spawnSync(bin, ['-version']).status === 0);
let film = null, filmTimer = null;
if (latest && ffmpeg) {
  const first = picture();
  film = spawn(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${first.width}x${first.height}`, '-r', String(FPS),
    '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', join(out, 'picture.mp4')], { stdio: ['pipe', 'ignore', 'inherit'] });
  film.stdin.on('error', () => {});
  recordingFrom = Date.now();
  // The picture can arrive smaller for a while (the network adapts it): bring every frame to the film's size, in order.
  let writing = Promise.resolve();
  filmTimer = setInterval(() => {
    const frame = picture(), bytes = Buffer.from(frame.data);
    writing = writing.then(async () => film.stdin.write(frame.width === first.width && frame.height === first.height ? bytes
      : await sharp(bytes, { raw: { width: frame.width, height: frame.height, channels: 4 } }).resize(first.width, first.height, { fit: 'fill' }).raw().toBuffer())).catch(() => {});
  }, 1000 / FPS);
}

await rooms.updateRoomMetadata(roomName, JSON.stringify({ chert_bridge_ready: true }));
log('signalled bridge_ready (FaceTime is ready)');
const greetedIn = Date.now();
await waitUntil(() => spoke, 12000);
log(`first words ${((Date.now() - greetedIn) / 1000).toFixed(1)} s after bridge_ready`);
await reply(25000);
await snapshot('0-greeting');

for (const [index, line] of questions.entries()) {
  // A question that starts with ^ is spoken over her: two seconds into her next stretch of talking.
  const cutIn = line.startsWith('^'), question = cutIn ? line.slice(1) : line;
  if (cutIn) {
    // Wait for her to be two and a half seconds into talking (the question before this one does not wait for her to finish).
    let since = 0;
    await waitUntil(() => { if (Date.now() - lastLoud < 300) since ||= Date.now(); else since = 0; return since && Date.now() - since > 2500; }, 30000);
    log(`caller cuts in${since ? '' : ' (she was not talking)'}: ${question}`);
    const audio = speech(question), from = Date.now();
    if (recordingFrom) place(audio, sampleNow());
    queue = audio;
    await waitUntil(() => Date.now() - lastLoud > 600, 15000);
    log(`  she stopped talking ${Math.max(0, (Date.now() - from - 600) / 1000).toFixed(1)} s after the caller started`);
    await pause(Math.max(0, audio.length / RATE * 1000 - (Date.now() - from)));
    const ended = Date.now();
    spoke = false;
    await waitUntil(() => spoke, 15000);
    log(`  she started answering after ${((Date.now() - ended) / 1000).toFixed(1)} s`);
    if (questions[index + 1]?.startsWith('^')) continue;      // the next line is spoken over this answer
    await reply();
    await pause(1600);
    await snapshot(`${index + 1}-after-question`);
    continue;
  }
  log(`caller: ${question}`);
  const audio = speech(question);
  if (recordingFrom) place(audio, sampleNow());
  queue = audio;
  await pause(audio.length / RATE * 1000);
  const asked = Date.now();
  spoke = false;
  await waitUntil(() => spoke, 15000);
  log(`  she started answering after ${((Date.now() - asked) / 1000).toFixed(1)} s`);
  if (questions[index + 1]?.startsWith('^')) continue;        // the next line is spoken over this answer
  await reply();
  await pause(1600);                         // let the picture finish its change
  await snapshot(`${index + 1}-after-question`);
}

const seconds = (Date.now() - firstFrame) / 1000;
log(`video: ${frames} frames, ${(frames / seconds).toFixed(1)} per second`);
open = false;
clearInterval(filmTimer);
const length = sampleNow();
await room.disconnect();
await rooms.deleteRoom(roomName).catch(() => {});

function wave(samples) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + samples.byteLength, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(samples.byteLength, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]);
}

// The whole call as one film with both voices.
if (film) {
  film.stdin.end();
  await new Promise(resolve => film.on('close', resolve));
  writeFileSync(join(out, 'call.wav'), wave(sound.subarray(0, Math.min(length, sound.length))));
  const mux = spawnSync(ffmpeg, ['-loglevel', 'error', '-y', '-i', join(out, 'picture.mp4'), '-i', join(out, 'call.wav'),
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', join(out, 'call.mp4')], { stdio: 'inherit' });
  log(mux.status === 0 ? `saved call.mp4 (${(length / RATE).toFixed(0)} s)` : 'could not join the picture and the sound');
}

// What the caller heard from the guide, as a file and as text.
const total = heard.reduce((sum, part) => sum + part.length, 0);
const pcm = new Int16Array(total);
let offset = 0;
for (const part of heard) { pcm.set(part, offset); offset += part.length; }
const wav = wave(pcm);
writeFileSync(join(out, 'guide.wav'), wav);
if (OPENAI_API_KEY && total) {
  const form = new FormData();
  form.set('model', 'gpt-4o-mini-transcribe');
  form.set('file', new Blob([wav], { type: 'audio/wav' }), 'guide.wav');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form });
  log(response.ok ? `the guide said: ${(await response.json()).text}` : `transcription failed (${response.status})`);
}
process.exit(0);
