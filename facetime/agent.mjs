// The open-house guide on a FaceTime video call. The caller hears the guide and sees the tour as its camera:
// the guide's tools (shared/tour.mjs, the same ones the web tour uses) move the picture on the caller's phone.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, llm, voice } from '@livekit/agents';
import { realtime } from '@livekit/agents-plugin-openai';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { executeTourTool, guideInstructions, initialView, normalizeView, tourTools } from '../shared/tour.mjs';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { createScreen, HEIGHT, WIDTH } from './screen.mjs';

const instructions = `${guideInstructions}
You are on a live FaceTime video call, and you are an AI guide. The renter sees the tour as your video:
each tool call changes the picture on their phone, so move the view first, then talk about what is on screen.
The renter has no controls; you are their hands. Speak warmly and briefly, like a leasing agent walking beside them.`;
// Said once, as soon as FaceTime is ready. Keep it short: it is the first thing the caller hears.
const greeting = `Greet the caller in one short sentence: you are their AI guide for the A5 one-bedroom at
The Parker at Ellington, and this is the living room. Then ask what matters most to them in a home.`;

const tour = JSON.parse(await readFile(new URL('../data/demo/tour.json', import.meta.url), 'utf8'));

const agent = defineAgent({
  entry: async ctx => {
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    // Chert prepares a room before a caller exists. Load the pictures while waiting,
    // but open the paid model session and send video only once the caller is here.
    const [screen, caller] = await Promise.all([createScreen(), ctx.waitForParticipant()]);

    let view = normalizeView(tour, initialView);
    screen.show(view);

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

    const tools = tourTools.map(spec => llm.tool({
      name: spec.name, description: spec.description, parameters: spec.parameters,
      execute: async args => {
        const action = executeTourTool(tour, view, spec.name, args);
        if (action.view !== view) { view = action.view; screen.show(view); }
        console.log(`[open-house] ${spec.name} ${JSON.stringify(args)} -> ${JSON.stringify(action.result)}`);
        return JSON.stringify(action.result);
      },
    }));

    const session = new voice.AgentSession({
      llm: new realtime.RealtimeModel({ model: process.env.OPEN_HOUSE_REALTIME_MODEL || 'gpt-realtime', voice: 'marin' }),
    });
    ctx.addShutdownCallback(async () => {
      await screen.close();
      await session.close();
      await track.close();
      await source.close();
    });
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions, tools }),
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
    const stopGreeting = greetOnBridgeReady(ctx.room, () => session.generateReply({ instructions: greeting }));
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

export default agent;

// Your own LiveKit project when .env.local has its three LIVEKIT_ values; otherwise Chert rooms through chert dev.
runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'open-house-guide' });
