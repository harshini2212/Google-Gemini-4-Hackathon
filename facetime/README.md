# FaceTime open-house guide

Ellie, the open-house guide, as a FaceTime Video call through [Chert](https://www.trychert.com). The caller hears
her and sees the home as her camera. It is a LiveKit agent: OpenAI Realtime hears and decides, ElevenLabs speaks, and
one video track is drawn from a property's Matterport 360 photos. What the product is and how it works is in
[`../README.md`](../README.md).

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

## Which home

`OPEN_HOUSE_PROPERTY=alex-springs` (in the environment of `npm start`, `rehearse.mjs` and `preview.mjs`) tours the
house at 9530 Alex Springs Lane; without it the guide tours the A5 apartment. A property is two folders:
`properties/<slug>/` (places, knowledge, site notes; in git) and `media/<slug>/` (360 photos, wall masks, furniture
presets, depth; built locally, not in git). Build the pictures with `python3 scripts/prepare_property.py <slug>`,
then `make_walls.py`, `make_staging.mjs --property` and `make_depth.py` for that slug.

## See it in a browser

`node --env-file=.env.local preview.mjs`, then http://localhost:5190: the same call in a tab, with your microphone.

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
| `agent.mjs` | The call: joins the room, publishes the camera track, runs the Realtime voice with the guide's tools |
| `guide.mjs` | Ellie: her instructions and tools (walk, look, point and zoom, paint, furnish, outside, floor plan) |
| `places.mjs`, `knowledge.mjs` | The apartment: where she can stand and what the camera sees there; what she knows, with sources |
| `properties/<slug>/` | The same for another property, plus `site.json` (aerial, captions, persona) |
| `screen.mjs`, `screen-worker.mjs` | Draws the picture in a worker thread: a free hand-held camera in the 360 photos, walks, paint, staging, aerial, floor plan |
| `paint.mjs`, `stage.mjs` | Paint a wall any colour keeping its light; add or change furniture with an image model and lay it back on the photo |
| `depthwalk.mjs` | Redraws a 360 photo from a camera that has stepped away from it, using depth from the scan's mesh |
| `rehearse.mjs`, `preview.mjs`, `call.mjs` | A rehearsal caller without a phone; the call in a browser tab; an outbound call through Chert's API |
| `research.mjs` | The research desk: a LangChain Deep Agent that answers comparison questions during the call and writes the follow-up packet after it (see `../Deep-Agents-Pitch.md`) |
| `after-call.mjs` | When a real call ends, texts the caller through Chert to ask how the tour went |
| `chert-rooms.mjs`, `greet.mjs` | From the Chert starter: how the agent joins calls and when it greets |

## How the picture fits the phone

The picture is wide (1280 by 720), for a phone held sideways, which FaceTime fills edge to edge. A phone is wider than
16:9, so FaceTime cuts about 65 rows off the top and the bottom and lays the caller's own picture over the top left;
every caption, the aerial's labels, the floor plan and the recap card are drawn inside what is left (`WIDE` in
`screen-worker.mjs`, measured from a screenshot of a real call). `TOUR_ORIENTATION=portrait` draws every scene upright
instead (720 by 1280, sent lying on its side) for a phone held upright, and the browser preview follows it.

## The text after the call

When a real call ends, `after-call.mjs` asks the caller by iMessage, through Chert, how the tour went. Chert does not
tell an agent who called, so the text goes to the number the caller gave Ellie during the call, or else to
`OPEN_HOUSE_FEEDBACK_TO` in `.env.local`. Chert only delivers to a phone that has joined the project. Each attempt
writes one line to `visits/after-call.log`. `OPEN_HOUSE_FEEDBACK_TEXT=0` turns it off.

## Rules Chert enforces

- Greet within 10 seconds of FaceTime being ready, and only on that signal (`greet.mjs`).
- Exactly one participant publishes audio, and video is taken only from that same participant.
- A call lasts at most 5 minutes on the trial, and the line takes one call at a time.
- Never commit or share `.env.local`.
