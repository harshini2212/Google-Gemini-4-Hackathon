# Demo Loop

The only thing that matters is a few minutes on a phone. Everything we build either makes those minutes better or gets cut.

## The slot

| Part | Length | What it is |
| --- | --- | --- |
| Video | 3 min | A recorded real call running the loop below, cut tight, with the pitch over the first 20 seconds |
| Live demo | 3 min | The same loop on a real phone, then a judge takes over and asks whatever they like |
| Q&A | 3 min | Answers below, under "Questions we will get" |

**The pitch in one line:** tour a home that is far away without going there. It is faster, it is safer than meeting a stranger in an empty house, and the guide is available at any hour.

## The dream, in one breath

A judge FaceTimes a phone number. An open-house guide picks up. She is standing on the front porch of a real house for sale in Houston, holding her phone with the rear camera pointed at the front door. She walks the judge in and through it like a person would: turns, looks where they ask, zooms in on what she is talking about, answers anything about the house, repaints a wall and furnishes a room while they watch, then shows the lot from above. Nobody is in that house. She is an agent working from CoStar, Matterport and Vexcel data.

## Who she is

**Ellie**, the AI open-house guide for **9530 Alex Springs Lane, Houston**: a detached four-bedroom, two-bath home for sale, 24 places to stand from the kerb to the primary closet. (The A5 apartment at The Parker at Ellington is the fallback property; the same guide runs it.)

She does every job a human guide does on a video tour:

| Job | What it looks like on the call |
| --- | --- |
| Greets and qualifies | Opens on the front porch, asks what matters to the caller, remembers it |
| Leads the walk | Plans a route for this caller and walks it, room by room |
| Shows, not tells | Moves the camera first, turns once through each new room, then talks about what is in frame |
| Follows directions | "Turn around", "look up", "go back to the kitchen", "show me the stove up close" |
| Knows the place cold | Room sizes from the scan, price, taxes and comps from the listing, the lot and roof from the aerial |
| Changes the place | Paints a wall any colour, adds or removes furniture, restyles a room, and calls it a preview |
| Shows outside | The street view from the kerb, and the lot from above with the house and driveway marked |
| Stays honest | Names the source of a number; says "I'll confirm that with the listing agent" when the data is silent |
| Closes | Offers the next step: another room, the floor plan, or handing the phone to the next person |

Mastery order: **interior first** (Matterport is the star), the listing second (CoStar), the exterior third (Vexcel is one clean beat).

## The loop

One caller, one unbroken call. Times are targets for the presenter, not rules for her. This exact sequence has run clean in rehearsal twice.

| Time | Caller says | She does | On the phone | Proves |
| --- | --- | --- | --- | --- |
| 0:00 | *(dials, it rings)* | Picks up. "Hi, I'm Ellie, your AI guide for 9530 Alex Springs Lane. I'm on the front porch. Come on in. What matters most to you in a home?" | Handheld view of the front door | It is a phone call. Hands-on moment |
| 0:12 | "I work from home and I have two kids. Show me around." | Says the plan in a sentence and walks in through the front door. | Camera walks from the porch into the living room | Agentic: plans, then acts |
| 0:30 | "Can you furnish this room?" | "Here's a staging preview." | Sofa, table, rug and lamp wipe into the living room | She changes the building |
| 0:45 | "Could that long wall be red?" | "Here's a paint preview." Takes the furniture out and says so. | Red rolls across the long wall, shadows intact | The wow beat |
| 1:00 | "Let's see the kitchen. Show me the stove up close." | Walks there, turns through the room narrating what passes, then zooms on the range. | Walk, slow turn, close-up | She knows what her camera sees |
| 1:30 | "What's the asking price, and the taxes?" | "$215,000 asking. Taxes are about $5,900 a year." | Kitchen | CoStar, said like a person |
| 1:45 | "Take me to the primary bedroom and put a bed in it." | Walks there, shows the room, stages it. | Walk, slow turn, furnished bedroom | Two tools from one sentence |
| 2:10 | "What's behind you?" | Turns around and describes the doorway to the primary bath. | Camera swings 180 degrees | Spatial awareness |
| 2:20 | "Show me the house from above." | Shows the lot. "About 40 by 110 feet. A 2023 analysis flagged the roof; this 2026 image shows even shingles. I'd confirm roof work with the listing agent." | Aerial with the house and driveway marked | Vexcel and CoStar joined, honestly |
| 2:45 | "Is it in a flood zone?" | "That's not in the record. I'll confirm with the listing agent." | Aerial | She does not make things up |
| 2:55 | *(presenter)* | "Call her yourself." | Floor plan | Judge's own phone |

If a judge goes off script, that is the demo working. Every room is walkable, every question either has a sourced answer or an honest "I'll confirm".

Everything on camera is the Matterport 360 photography taken at the house, one photo per scan position. The 3D mesh is never shown; it is used only for depth.

## Why these beats

| Judging criterion | Weight | Where it lands |
| --- | --- | --- |
| Use of the data | 30% | Scan measurements in every room, listing price and taxes at 1:30, two aerial dates compared with the record at 2:20 |
| Agentic depth | 30% | She plans from two facts about the caller at 0:12, chains tools from one sentence at 1:45, and acts on the building at 0:30 and 0:45 |
| Usefulness | 25% | A brokerage could switch this on Monday: every out-of-town or after-hours lead gets a tour |
| Demo and polish | 15% | It is a FaceTime call on a real phone, and she moves like a person |

## What has to be true

Each line is a check we can run. Status is updated every pass through the loop.

| # | Must be true | How we check | Status |
| --- | --- | --- | --- |
| 1 | A FaceTime Video call to the line is answered and she speaks first within 3 seconds | Real call | Not yet confirmed: no call has reached the dedicated line |
| 2 | She starts at the entrance, facing the front door | Rehearsal frame 0 | Done |
| 3 | Moving between rooms looks like walking: turn, move through each scan point, settle. No teleport, no black frames | Frame capture | Done as turn, push and dissolve; real parallax is being wired in |
| 4 | Standing still looks handheld, never frozen and never jittery | Frame capture | Done |
| 5 | "Look left / behind / up", "show me X up close" move the camera and she describes what is truly there | Rehearsal | Done (112 mapped features in the house) |
| 6 | Any wall colour by name, on screen within a second or two, edges clean on windows and trim | Frame capture | Done for five walls in the house |
| 7 | Furniture: presets appear instantly; a new request appears in about 12 seconds while she keeps talking | Rehearsal | Presets done (six in the house); live requests work on the apartment, not re-tested on the house |
| 8 | Every price, size and count she says matches the data, with its source | Rehearsal transcript | Held in both rehearsals; the 12 test questions have not been run as a set |
| 9 | She declines to guess what the data lacks | Rehearsal | Done (flood zone, roof condition) |
| 10 | Reply starts within 2 seconds of the caller finishing; interrupting her works | Rehearsal timing | 1.8 to 2.7 s measured; interruption not tested |
| 11 | Video holds 14+ frames a second for the whole call | Rehearsal counter | 14.9 measured |
| 12 | The whole loop runs twice in a row with no restart | Two rehearsals, then two real calls | Two rehearsals done; real calls not yet |

## The loop we run

Repeat until every row above is green, then stop building.

1. **Rehearse without a phone.** From `facetime/`: `OPEN_HOUSE_PROPERTY=alex-springs node --env-file=.env.local rehearse.mjs <folder> "question" "question" …`. It joins as the caller, speaks the questions, and saves what the caller would see and hear. Or open the call in a browser tab: `node --env-file=.env.local preview.mjs`, then http://localhost:5190. Neither uses Chert.
2. **Look and listen.** Read the frames and the transcript against the table. Write down the one worst thing.
3. **Fix that one thing.** Nothing else.
4. **Every third pass, make a real call** from a phone, in the room, on the venue Wi-Fi.
5. **Freeze** when rows 1 to 12 are green twice. After that, only bug fixes.

## Rules

- No feature that is not in the loop table. New ideas go to "After the loop is clean".
- Preload everything she might show. Nothing on a live call waits on a download.
- Every change she makes is called a preview, out loud and on screen.
- She never states offers, sale history, inspection results, flood or insurance facts, or school ratings unless the data has them.
- One call at a time on the line.

## Running it on stage

- **Two processes must be up** on the demo laptop, both from `facetime/` with `OPEN_HOUSE_PROPERTY=alex-springs`: the agent (`npm start`) and the line (`npx @trychert/facetime@0.1.0-beta.21 dev`). Start both ten minutes early and place one test call.
- **The line** is a dedicated number, so there is no daily minute cap. Outbound calls (`call.mjs`) need the recipient verified on that line by Chert.
- **Projector:** mirror the presenter's iPhone so the room sees the call.
- **Fallback:** the browser preview on the laptop, and a screen recording of one clean real call.

## Known limits to steer around

- A paint or furniture change lives at the spot where it was made. In the loop she paints and stages from each room's main spot, and moves on.
- Paint and a furniture preview do not share a spot: painting takes the furniture out, and she says so.
- A furniture request she has no preset for takes about 12 seconds. She fills the wait by talking.
- The aerial is one frame. It is a single beat, not a place to linger.
- The back yard was never scanned; she can describe it only from the record and the aerial.

## Questions we will get

| Question | Answer |
| --- | --- |
| Is that a real house? | Yes. 9530 Alex Springs Lane in Houston, from its Matterport scan, its CoStar for-sale listing and the Vexcel aerial. |
| Is the video pre-rendered? | No. Each frame is drawn live from the 360 photo at her position, in the direction she is facing. Paint and furniture are applied to that photo during the call. |
| What stops her making things up? | She speaks only from a brief built from the three data layers and from what each tool tells her is in frame. For anything else she says she will confirm with the listing agent. |
| How does it reach FaceTime? | The agent is a LiveKit participant with one audio and one video track. Chert bridges that room to a real Apple line. |
| How would this scale past one house? | A property is a folder. The places, what is visible from each, the brief, wall masks, furniture presets and depth were each generated from the scan and the listing; the apartment and the house run on the same engine. |
| Who is it for? | Buyers and renters relocating from another city, brokerages after hours, and anyone who would rather not tour an empty house alone with a stranger. |

## After the loop is clean

In order, and only if rows 1 to 12 are green:

1. Real parallax between scan points, from the scan's depth.
2. She texts the caller a recap and the floor plan over iMessage after the call.
3. Portrait video, if a real call shows landscape wastes the phone screen.
