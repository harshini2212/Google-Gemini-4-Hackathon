# Demo Loop

The only thing that matters is two minutes on a phone. Everything we build either makes those two minutes better or gets cut.

## The dream, in one breath

A judge FaceTimes a phone number. A leasing agent picks up. She is standing at the front door of a real Houston apartment, holding her phone with the rear camera pointed into the unit. She walks the judge through it like a person would: turns, looks where they ask, answers anything about the unit and the building, repaints a wall and furnishes a room while they watch, then steps outside to show where they would park. Nobody is in that apartment. She is an agent working from CoStar, Matterport and Vexcel data.

## Who she is

**Ellie**, the open-house guide for the A5 one-bedroom at The Parker at Ellington, 12801 Roydon Dr, Houston.

She does every job a human guide does on a video tour:

| Job | What it looks like on the call |
| --- | --- |
| Greets and qualifies | Opens at the front door, asks what matters to the caller, remembers it |
| Leads the walk | Plans a route for this caller and walks it, room by room, without being told each step |
| Shows, not tells | Moves the camera first, then talks about what is in frame |
| Follows directions | "Turn around", "look up", "go back to the kitchen", "get closer to that window" |
| Knows the place cold | Room sizes from the scan, rent and floor plans from the listing, parking and building facts from the record |
| Changes the place | Paints a wall any colour, adds or removes furniture, restyles a room, and labels it a preview |
| Shows outside | Cuts to the aerial: the unit, the parking row, the distance between them |
| Stays honest | Says which source a number comes from; says "I'll confirm that with the leasing office" when the data is silent |
| Closes | Offers the next step: another room, the floor plan, or handing the phone to the next person |

Mastery order: **interior first** (Matterport is the star), the property record second (CoStar), the exterior third (Vexcel is the supporting shot, one clean beat).

## The two-minute loop

One caller, one unbroken call. Times are targets for the presenter, not rules for her.

| Time | Caller says | She does | On the phone | Proves |
| --- | --- | --- | --- | --- |
| 0:00 | *(dials, it rings)* | Picks up at the front door. "Hi, I'm Ellie, your guide for the A5 at The Parker at Ellington. Come on in. What matters most to you in a place?" | Handheld view from the entry, looking into the unit | It is a phone call. Hands-on moment |
| 0:12 | "I work from home and I drive." | Plans out loud: "Then three things: a spot for your desk, the living room, and where you'd park. Follow me." Starts walking. | Camera turns and walks through the unit | Agentic: plans, then acts |
| 0:25 | *(listening)* | Arrives at the dining nook. "This nook measures about 48 square feet in the scan, with the window right here." | Dining nook, window in frame | Matterport measurements |
| 0:40 | "Can you put a desk there?" | "Sure. Here's a staging preview." | Desk, chair and monitor wipe into the room | She changes the building |
| 0:55 | "Show me the living room." | Walks there. "Fireplace on this wall, patio through the doors on the right." | Walk, then living room | Spatial awareness |
| 1:05 | "Could that wall be red?" | "Let's see it." | Red rolls across the fireplace wall, shadows intact | The wow beat |
| 1:15 | "What's the rent?" | "Asking rent is 829 to 879 a month in the CoStar listing. It's listed at 700 square feet; the scan measures 611 indoors." | Same room, still red | CoStar and Matterport joined, honestly |
| 1:28 | "What's behind you?" | Turns around and describes what is actually there. | Camera swings 180 degrees | She knows what her camera sees |
| 1:38 | "Where would I park?" | "Let me step outside." | Aerial: unit pin, parking row, about 35 ft between them | Vexcel, CoStar and Matterport on one address |
| 1:52 | *(presenter)* | "Text the join code to this number and FaceTime her yourself." | Floor plan with her route on it | Judge's own phone |

If a judge goes off script, that is the demo working. Every room is walkable, every question either has a sourced answer or an honest "I'll confirm".

## Why these beats

| Judging criterion | Weight | Where it lands |
| --- | --- | --- |
| Use of the data | 30% | Scan measurements at 0:25, listing and scan compared at 1:15, three layers on one address at 1:38 |
| Agentic depth | 30% | She plans a route from two facts about the caller at 0:12 and executes it; she acts on the building at 0:40 and 1:05 |
| Usefulness | 25% | A leasing office could switch this on Monday: every after-hours lead gets a tour |
| Demo and polish | 15% | It is a FaceTime call on a real phone, and she moves like a person |

## What has to be true

Each line is a check we can run. Status is updated every pass through the loop.

| # | Must be true | How we check | Status |
| --- | --- | --- | --- |
| 1 | A FaceTime Video call to the line is answered and she speaks first within 3 seconds | Real call | Line answers; first full call not yet confirmed |
| 2 | She starts at the front door, facing into the unit | Rehearsal frame 0 | Building |
| 3 | Moving between rooms looks like walking: turn, move through each scan point, settle. No teleport, no black frames | Rehearsal contact sheet | Building |
| 4 | Standing still looks handheld, never frozen and never jittery | Watch 10 s of idle | Building |
| 5 | "Look left / behind / up / closer" moves the camera and she describes what is truly there | Rehearsal with the direction table | Building |
| 6 | Any wall colour by name, on screen within 1 second, edges clean on windows and trim | Rehearsal: red, navy, white | Building (sage and clay work today) |
| 7 | Furniture: presets appear instantly; a new request appears in under 30 seconds while she keeps talking | Rehearsal | Building |
| 8 | Every rent, size and count she says matches the data, with its source | The 12 test questions | Building |
| 9 | She declines to guess what the data lacks | The 3 trap questions | Building |
| 10 | Reply starts within 1.5 seconds of the caller finishing; interrupting her works | Rehearsal timing | Works in rehearsal |
| 11 | Video holds 14+ frames a second for the whole call | Rehearsal counter | 14.8 measured |
| 12 | The whole loop runs twice in a row with no restart | Two rehearsals, then two real calls | Not yet |

## The loop we run

Repeat until every row above is green, then stop building.

1. **Rehearse without a phone.** From `facetime/`: `node --env-file=.env.local rehearse.mjs <folder> "question" "question" …`. It joins as the caller, speaks the questions, and saves what the caller would see (frames) and hear (audio and transcript). It uses no Chert minutes.
2. **Look and listen.** Read the frames and the transcript against the table. Write down the one worst thing.
3. **Fix that one thing.** Nothing else.
4. **Every third pass, make a real call** from a phone, in the room, on the venue Wi-Fi.
5. **Freeze** when rows 1 to 12 are green twice. After that, only bug fixes.

## Rules

- No feature that is not in the two-minute table. New ideas go to "After the loop is clean".
- Preload everything she might show. Nothing on a live call waits on a download.
- Every change she makes is called a preview, out loud and on screen.
- She never states availability, assigned parking, pet rules or fees unless the data has them.
- One call at a time on the line. Calls are capped at 5 minutes on the trial.

## Running it on stage

- **Two processes must be up** on the demo laptop: the agent (`npm start` in `facetime/`) and the line (`npx @trychert/facetime@0.1.0-beta.21 dev` in the same folder). Start both ten minutes early and place one test call.
- **Judge's phone:** they text the join code to the line once over iMessage, then FaceTime it. Have the code on a slide.
- **Projector:** mirror the presenter's iPhone so the room sees the call.
- **Budget:** 50 FaceTime minutes a day on the trial, resetting at 00:00 UTC. Rehearse with `rehearse.mjs`, spend minutes only on real-call checks and the judging itself. `chert doctor` shows what is left and when the trial ends.
- **Fallback:** a screen recording of one clean real call, ready to play if the venue network or the line fails.

## Known limits to steer around

- A paint or furniture change lives at the spot where it was made. From another spot in the same room the wall shows as scanned. In the loop she paints and stages from each room's main spot, and moves on.
- A furniture request she has not seen before takes tens of seconds. The loop uses presets; she fills the wait by talking.
- The exterior is one aerial frame. It is a single beat, not a place to linger.

## After the loop is clean

In order, and only if rows 1 to 12 are green:

1. Parallax walking: the floor slides under the camera between scan points.
2. She texts the caller a recap and the floor plan over iMessage after the call.
3. Portrait video, if a real call shows landscape wastes the phone screen.
