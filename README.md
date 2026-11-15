<p align="center">
  <img src="docs/media/thumbnail.png" width="860" alt="Ellie, the open house you FaceTime. Two phones held sideways show frames from a call: the street view of a red brick house, and its living room with a sofa added as a staging preview.">
</p>

# Ellie

**The open house you FaceTime.** Call a phone number and an AI guide answers at the front door of a real home for sale. She walks you through it on live video, answers from the listing record, repaints a wall or furnishes a room when you ask, and writes up the visit when you hang up.

> **Try it:** FaceTime Video **+1 (628) 233-9741** and hold your phone sideways.
> This is the demo line for HackPrinceton 2026. It answers one call at a time.

There is no app, no link and no headset. The picture is the listing's own Matterport photography, and what she says comes from the CoStar listing record, the scan's measurements and a Vexcel aerial.

## Why

Touring a home still means being there. A buyer moving to another city chooses from photos and a floor plan. An open house runs a few hours on a weekend, and the questions come on a weeknight. A private showing puts an agent and a stranger in an empty house. A 3D tour shows the rooms, but nobody is there to answer when you ask whether your desk fits by the window.

Ellie is the guide who is there: at any hour, from anywhere, on the phone you already have.

## A three-minute visit

Every frame below is from a real call to 9530 Alex Springs Lane, Houston.

| | | | |
|:--:|:--:|:--:|:--:|
| <img src="docs/media/porch.jpg" width="185" alt="The front porch and front door"><br>**0:00** She answers at the door | <img src="docs/media/living-modern.jpg" width="185" alt="The living room with a sofa, table, lamp and plant added"><br>**0:30** “Furnish this room” | <img src="docs/media/wall-red.jpg" width="185" alt="The living room's long wall painted red"><br>**0:45** “Make that wall red” | <img src="docs/media/stove.jpg" width="185" alt="A close-up of the gas range"><br>**1:00** “The stove, up close” |
| <img src="docs/media/research-card.jpg" width="185" alt="A card comparing this home with nearby listings"><br>**1:38** “How does it compare?” | <img src="docs/media/bedroom.jpg" width="185" alt="The primary bedroom with a bed added"><br>**1:45** “Put a bed in here” | <img src="docs/media/aerial.jpg" width="185" alt="An aerial view of the lot with the house and driveway marked"><br>**2:20** “Show me from above” | <img src="docs/media/recap.jpg" width="185" alt="A recap card of the visit"><br>**2:50** “That’s all for today” |

The full script, with what each beat proves, is in [`Demo-Loop.md`](Demo-Loop.md).

## What she does

| Job | On the call |
| --- | --- |
| Greets and qualifies | Opens at the front door, asks what matters to you, and remembers it |
| Leads the walk | Plans a route from what you told her and walks it, room by room |
| Shows, then tells | Moves the camera first, turns once through each new room, then describes what is in frame |
| Follows directions | “Turn around”, “look up”, “go back to the kitchen”, “show me the house number” |
| Knows the listing | Price, taxes, HOA and remarks from the record; room sizes from the scan; the lot from the aerial |
| Changes the place | Paints a wall any colour, adds furniture, restyles a room, and calls each one a preview |
| Researches | Hands comparisons and payment questions to a team of agents, and keeps touring while they work |
| Takes interruptions | Stops when you talk over her and answers what you asked |
| Closes | Reads back a recap, records the next step, and leaves a brief for the listing agent |

She is also careful in the ways a licensed guide has to be. She says she is an AI when asked, names the source of a number, and never comments on who lives nearby, on safety, or on whether a school or an area is “good”.

## How it works

```mermaid
flowchart LR
  P["iPhone<br/>FaceTime Video"] <--> C["Chert<br/>FaceTime bridge"]
  C <--> L["LiveKit room"]
  L <--> R
  subgraph E["Ellie · facetime/agent.mjs"]
    direction TB
    R["OpenAI Realtime<br/>hears, decides, calls tools"] --> V["ElevenLabs<br/>speaks"]
    R --> T["12 guide tools<br/>guide.mjs"]
    T --> S["Camera worker<br/>1280 × 720 at 15 fps<br/>drawn from the 360 photos"]
  end
  T -. research .-> D["Research desk<br/>LangChain Deep Agents"]
  T -. wrap_up .-> F["After the call<br/>follow-up, agent brief, comps"]
  D --> K[("CoStar listings")]
```

- **The call.** FaceTime reaches a LiveKit room through [Chert](https://www.trychert.com). The agent joins as one participant that publishes both the voice and the picture.
- **The voice.** OpenAI Realtime listens to the caller directly, decides when they have finished a thought, and calls tools. ElevenLabs speaks her words, with OpenAI's own voice as the backup if ElevenLabs is not answering.
- **The camera.** A worker thread draws every frame from the Matterport 360 photos: a free hand-held camera that walks between scan positions, turns through a room, and zooms on what she points at. The 3D mesh is never shown.
- **The tools.** `walk_to`, `plan_route`, `look_around`, `look`, `point_at`, `paint_wall`, `stage_room`, `clear_changes`, `show_outside`, `show_floor_plan`, `research` and `wrap_up`. Each returns what the camera now shows, and she talks only about that.
- **The changes.** Paint is a mask of the wall tinted so its light and shadows stay. Furniture is an image model working on the exact view, laid back onto the 360 photo so it stays put as the camera moves.

## The data

| Layer | What it gives her | Where you see it |
| --- | --- | --- |
| **Matterport** | The 360 photos she walks through, room boundaries and measurements | Every frame; 24 places to stand and 112 things to point at; the floor plan |
| **CoStar** | Price, taxes, HOA, remarks, and 2,120 listings to compare against | Spoken answers; the comparison card; the after-call packet |
| **Vexcel** | A 2026 aerial of the parcel and what was detected on it | The lot from above, about 40 by 110 feet, with the house and driveway marked |

### Where the sources disagree, she says so

The listing says 1,744 square feet. The scan measures about 1,280 square feet of rooms, plus a 367 square foot garage. She tells the buyer both and suggests an appraiser confirm the size. The same goes for the bedroom count (the remarks say three, the record and the scan show four) and the roof (a 2023 analysis flagged a tarp, the 2026 aerial shows even shingles). When something is not in the record at all, such as the flood zone, she says so and offers to confirm it with the listing agent.

## The research desk

The voice model has about two seconds to start answering, which is not enough to search two thousand listings. Questions like “how does this compare with similar homes nearby?” go to a [LangChain Deep Agent](https://docs.langchain.com/oss/javascript/deepagents/overview): a lead agent plans the work and hands it to two specialists, one that finds comparable homes and one that checks the listing against the scan. Ellie keeps touring, and about twenty seconds later the answer is on screen as a card and she says it aloud.

When the caller says goodbye, the same agents write three files: a follow-up for the buyer, a brief for the listing agent, and a table of comparable homes. The details, with real output, are in [`Deep-Agents-Pitch.md`](Deep-Agents-Pitch.md).

## Measured

| | Result | How it was measured |
| --- | --- | --- |
| First words after pickup | 0.8 to 1.9 s | Rehearsal calls |
| Reply, from the end of your sentence | About 2 s (1.7 to 2.4 s typical) | Rehearsal calls |
| After being interrupted | Stops at once; answers in 1.7 to 1.9 s | Rehearsal calls with a caller who talks over her |
| Picture | 1280 × 720 at 15 frames a second | Frames received by the caller |
| A researched comparison | 18 to 21 s | Calls with the research desk |
| After-call packet, three files | About 41 s | A run after the demo loop |
