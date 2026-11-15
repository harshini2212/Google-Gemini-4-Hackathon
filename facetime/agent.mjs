// The open-house guide on a FaceTime video call. The caller hears Ellie and sees the apartment through her camera:
// her tools (guide.mjs) move that camera and change the rooms on the caller's phone.
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, llm, tts, voice } from '@livekit/agents';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import { realtime, TTS as OpenAISpeech } from '@livekit/agents-plugin-openai';
import { AudioStream, LocalVideoTrack, RoomEvent, TrackKind, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { loadGuide } from './guide.mjs';
import { RoomMicrophone } from './room-mic.mjs';
import { createScreen, HEIGHT, WIDTH } from './screen.mjs';

const ELEVEN_MODEL = process.env.ELEVEN_MODEL || 'eleven_flash_v2_5';

/**
 * Whether ElevenLabs will speak right now, found out with a two-letter request: a dead key, an empty quota or an
 * outage then shows before the call starts instead of as silence during it. Resolves to '' when it will, else why not.
 */
async function elevenTrouble() {
  const { ELEVEN_API_KEY: key, ELEVEN_VOICE_ID: voiceId } = process.env;
  if (!key || !voiceId) return 'ELEVEN_API_KEY or ELEVEN_VOICE_ID is not set';
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`, { method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hi', model_id: ELEVEN_MODEL }), signal: AbortSignal.timeout(4000) });
    await response.body?.cancel();
    return response.ok ? '' : `ElevenLabs answered ${response.status}`;
  } catch (error) { return `ElevenLabs could not be reached (${error?.name ?? 'error'})`; }
}

const agent = defineAgent({
  entry: async ctx => {
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    // Chert prepares a room before a caller exists. Load the guide and the pictures while waiting,
    // but open the paid model session and send video only once the caller is here.
    const guide = await loadGuide();
    const [screen, caller] = await Promise.all([createScreen(guide.mediaDir ? { mediaDir: guide.mediaDir } : {}), ctx.waitForParticipant()]);

    let view = guide.initialView();
    screen.show(view);

    // How loud the caller's side is, once a second while it changes: a silent line and a quiet caller look the same
    // to the model, and this tells them apart in the log.
    const listen = track => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      (async () => {
        let peak = 0, at = Date.now(), last = -1;
        for await (const frame of new AudioStream(track, 16000, 1)) {
          for (let i = 0; i < frame.data.length; i += 4) peak = Math.max(peak, Math.abs(frame.data[i]));
          if (Date.now() - at < 1000) continue;
          const level = peak < 3277 ? Math.round(peak / 32.767) / 10 : Math.round(peak / 327.67);
          if (level !== last) console.log(`[open-house] caller audio level ${level}% (${caller.identity.slice(0, 20)})`);
          last = level; peak = 0; at = Date.now();
        }
      })().catch(() => {});
    };
    ctx.room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => { if (participant.identity === caller.identity) listen(track); });
    for (const publication of caller.trackPublications.values()) if (publication.track) listen(publication.track);

    // Video: one camera track, published by this agent. The Mac shows video only
    // from the participant that speaks, so the picture and the voice stay together.
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('open-house-tour', source);
    let published = false;
    screen.play(frame => {
      source.captureFrame(new VideoFrame(frame, WIDTH, HEIGHT, VideoBufferType.RGBA));
      if (published) return;
      published = true;
      ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA })
        .catch(error => console.error('[open-house] could not publish the tour video', error));
    });

    // Her voice is ElevenLabs, always: the realtime model listens and thinks, and writes what she says for that voice
    // to speak. OpenAI is the backup twice over. If ElevenLabs is not answering when the call starts, the realtime
    // model speaks with its own voice for that call; if it fails in the middle of one, OpenAI's speech takes over.
    const model = process.env.OPEN_HOUSE_REALTIME_MODEL || 'gpt-realtime';
    const trouble = await elevenTrouble(), borrowed = !trouble;
    console.log(borrowed ? `[open-house] voice: ElevenLabs ${ELEVEN_MODEL}, OpenAI speech standing by`
      : `[open-house] voice: OpenAI Realtime (backup), because ${trouble}`);
    // When she takes her turn: on what was said sounding finished, not on the first pause, so she does not finish the
    // caller's sentences. OPEN_HOUSE_PATIENCE is the model's eagerness to answer: low waits longest (it left a long gap
    // after the caller cut in), high answers soonest, medium is between. Speaking over her still stops her.
    const turnDetection = { type: 'semantic_vad', eagerness: process.env.OPEN_HOUSE_PATIENCE || 'medium', create_response: true, interrupt_response: true };
    // A microphone across a room also needs far-field clean-up.
    const ears = { turnDetection, ...(process.env.OPEN_HOUSE_ROOM_MIC ? { inputAudioNoiseReduction: { type: 'far_field' } } : {}) };
    const session = new voice.AgentSession(borrowed
      ? { llm: new realtime.RealtimeModel({ model, modalities: ['text'], ...ears }),
        tts: new tts.FallbackAdapter({ maxRetryPerTTS: 1, ttsInstances: [
          new elevenlabs.TTS({ voiceId: process.env.ELEVEN_VOICE_ID, model: ELEVEN_MODEL }),
          new OpenAISpeech({ model: 'gpt-4o-mini-tts', voice: 'coral' })] }) }
      : { llm: new realtime.RealtimeModel({ model, voice: 'marin', ...ears }) });
    // OPEN_HOUSE_ROOM_MIC: hear the caller through this computer's microphone instead of the phone line (room-mic.mjs).
    let speaking = false, roomMic = null;
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => { speaking = event.newState === 'speaking'; });
    if (process.env.OPEN_HOUSE_ROOM_MIC) {
      roomMic = new RoomMicrophone(process.env.OPEN_HOUSE_ROOM_MIC, () => speaking);
      session.input.audio = roomMic;
    }
    let open = true;
    const call = {
      // For work that finishes after its tool has answered (a staging preview): change the view, then tell her.
      later(change, say) {
        if (!open) return;
        view = change(view);
        screen.show(view);
        session.generateReply({ instructions: say });
      },
    };
    const tools = guide.tools.map(spec => llm.tool({
      name: spec.name, description: spec.description, parameters: spec.parameters,
      execute: async args => {
        const action = spec.run(view, args, call);
        if (action.view !== view) { view = action.view; screen.show(view); }
        console.log(`[open-house] ${spec.name} ${JSON.stringify(args)} -> ${JSON.stringify(action.result).slice(0, 300)}`);
        return JSON.stringify(action.result);
      },
    }));

    ctx.addShutdownCallback(async () => {
      open = false;
      await roomMic?.close();
      await screen.close();
      await session.close();
      await track.close();
      await source.close();
    });
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions: guide.instructions, tools }),
      record: false,
      inputOptions: {
        participantIdentity: caller.identity,
        audioEnabled: true,
        videoEnabled: false,
        textEnabled: false,
        closeOnDisconnect: true,
        deleteRoomOnClose: false,
      },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false },
    });
    // Greet once when chert dev reports that FaceTime is ready (bridge_ready in the
    // room metadata): the Mac ends the call if it hears nothing within 10 seconds
    // of that. Participant arrival alone is not readiness, so there is no greeting
    // on it. Without the signal there is no greeting, and the caller speaks first.
    const stopGreeting = greetOnBridgeReady(ctx.room, () => {
      session.generateReply({ instructions: guide.greeting });
      // She walks in through the door while she says hello.
      if (guide.walkIn) setTimeout(() => { if (open) { view = guide.walkIn(view); screen.show(view); } }, 1500);
    });
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

export default agent;

// Your own LiveKit project when .env.local has its three LIVEKIT_ values; otherwise Chert rooms through chert dev.
runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'open-house-guide' });
