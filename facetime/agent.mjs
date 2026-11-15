// The open-house guide on a FaceTime video call. The caller hears Ellie and sees the apartment through her camera:
// her tools (guide.mjs) move that camera and change the rooms on the caller's phone.
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, llm, voice } from '@livekit/agents';
import { realtime } from '@livekit/agents-plugin-openai';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { loadGuide } from './guide.mjs';
import { createScreen, HEIGHT, WIDTH } from './screen.mjs';

const agent = defineAgent({
  entry: async ctx => {
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    // Chert prepares a room before a caller exists. Load the guide and the pictures while waiting,
    // but open the paid model session and send video only once the caller is here.
    const [guide, screen, caller] = await Promise.all([loadGuide(), createScreen(), ctx.waitForParticipant()]);

    let view = guide.initialView();
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

    const session = new voice.AgentSession({
      llm: new realtime.RealtimeModel({ model: process.env.OPEN_HOUSE_REALTIME_MODEL || 'gpt-realtime', voice: 'marin' }),
    });
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
    const stopGreeting = greetOnBridgeReady(ctx.room, () => session.generateReply({ instructions: guide.greeting }));
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

export default agent;

// Your own LiveKit project when .env.local has its three LIVEKIT_ values; otherwise Chert rooms through chert dev.
runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'open-house-guide' });
