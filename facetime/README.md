# FaceTime open-house guide

The open-house guide as a FaceTime Video call, through [Chert](https://www.trychert.com). The caller hears the
guide and sees the apartment tour as her camera. It is a LiveKit agent: an OpenAI Realtime voice plus one video
track drawn from the Matterport panoramas in `../data/demo`.

The script for the demo and what still has to be true is in [`../Demo-Loop.md`](../Demo-Loop.md).

## Run it

Node 22.23.2 or later (24 is what we use). The tour assets must exist first: `npm run prepare:demo` in the repo root.

1. `npm install`
2. `cp .env.example .env.local && chmod 600 .env.local`, then fill it in privately: the three LiveKit values
   from one LiveKit Cloud project, an OpenAI key with Realtime access, and `AGENT_NAME=open-house-guide`.
3. Terminal 1, the agent: `npm start`
4. Terminal 2, the line, in this folder: `npx @trychert/facetime@0.1.0-beta.21 dev`
   (`chert login` once per computer; `chert doctor` says what is missing).
5. When it says the agent is in a waiting room, make a **FaceTime Video** call to the line it shows.

Both processes must stay up. After changing the agent, restart both.

## Rehearse without a phone

```sh
node --env-file=.env.local rehearse.mjs out "Could you paint that wall sage green?" "Where would I park?"
```

It joins a LiveKit room as the caller, speaks the questions with the Mac's voice, and saves what the caller would
see (`out/*.jpg`) and hear (`out/guide.wav`, plus a transcript in the terminal). It uses no Chert minutes; it does
use the OpenAI key.

## What is where

| File | What it does |
| --- | --- |
| `agent.mjs` | The call: joins the room, publishes the camera track, runs the Realtime voice with the tour tools |
| `screen.mjs`, `screen-worker.mjs` | Draws the picture in a worker thread: panorama camera, wall finishes, aerial, floor plan, captions |
| `paint.mjs` | Tints a wall in a panorama any colour, keeping its light and shadow |
| `knowledge.mjs` | What the guide knows about the unit, the community and the area, with sources |
| `rehearse.mjs` | The phone-free rehearsal caller |
| `chert-rooms.mjs`, `greet.mjs` | From the Chert starter: how the agent joins calls and when it greets |

## Rules Chert enforces

- Greet within 10 seconds of FaceTime being ready, and only on that signal (`greet.mjs`).
- Exactly one participant publishes audio, and video is taken only from that same participant.
- A call lasts at most 5 minutes on the trial, and the line takes one call at a time.
- Never commit or share `.env.local`.
