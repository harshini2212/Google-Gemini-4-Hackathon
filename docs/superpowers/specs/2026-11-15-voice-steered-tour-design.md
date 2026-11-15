# Room arrival spin, close-ups and surface restyles: direction

Date: 2026-11-15
From: Ryan (brainstormed with Claude)
Status: proposal for the team. Nothing here is built. It does not change
`Demo-Loop.md`; where it disagrees with it, that is listed under "Needs a team
decision".

## Why this note exists

Ryan worked out a direction for how the tour should feel before seeing the
current code. Much of it matches what is already on `main` (360 photos from
the Matterport scan, a live voice guide with tools, prepared changes rather
than live generation, no Unity/Blender mesh at call time). This note keeps
only what is new, mapped onto the code as it is now.

## The feel Ryan is after

You tell the guide where to go and what to imagine, and the picture does it:

1. "Let's go to the kitchen." The view goes to the kitchen.
2. She gives a brief intro, about 5 seconds.
3. The camera does one slow full 360 of the room while she describes it.
4. She asks if there is any part of the room you want to look at more closely.
5. "Let's go see the grill." The view moves to the scan point nearest that
   feature, facing it, and she talks about it.
6. "Imagine the floors were marble." The floor changes on screen, smoothly,
   with no wait.

## What is new compared with `main`

| Idea | Today | Proposed |
| --- | --- | --- |
| Arrival 360 | `show_view` lands on a fixed yaw with a gentle sway | A full rotation on arrival, narrated, then the closer-look question |
| Close-ups | Demo-Loop lists "get closer to that window"; no tool for it | A named list of features per room, each tied to its nearest scan point and a facing direction |
| Surface restyles | `preview_finish` tints the fireplace wall (sage, clay); Demo-Loop wants any wall colour and furniture | Also floors and other surfaces, e.g. marble floor in the kitchen |

## How each would fit the current code

### Arrival 360

- A new tour tool, e.g. `look_around`, or a flag on the view state that
  `show_view` sets on arrival. `screen-worker.mjs` already draws the panorama
  at any yaw, so the spin is an animated yaw over about 25 seconds.
- The guide's instructions gain the arrival order: short intro, spin with the
  room's facts from `knowledge.mjs`, then the closer-look question.
- Speaking over her interrupts the narration. The spin keeps going unless the
  next request moves the camera.

### Close-ups

- Add a `details` list per room in the prepared tour data: name, phrases, scan
  point id, yaw and pitch, and facts.
- A new tool, e.g. `look_closer(detail)`, limited to those names. It moves to
  that scan point the same way a room change does.
- Photos only. A feature with no scan point near it is left out rather than
  shown by zooming, which goes soft. No cut to a 3D render: next to the photo
  it is a visible drop in quality.
- "Back" returns to the room's main spot.

### Surface restyles (floors and more)

- A material change such as marble cannot be done by the hue tint in
  `paint.mjs`; it needs a new texture with the room's light on it. Two ways to
  prepare it, both offline:
  - extend the Blender finishes step (`scripts/render_finishes.py`) to render
    a floor material, or
  - run the room's panorama through an AI image editor with a fixed prompt.
- Either way, composite the result back onto the original panorama through a
  mask of just that surface, so everything else is pixel-identical and only
  the floor changes during the fade.
- Check the left/right seam and the floor directly under the camera, where 360
  photos distort.
- Hardcoded: a small prepared set per room, chosen from an enum like
  `finishes` in `shared/tour.mjs`. For anything else she offers what she has.
- Same limit as paint today: the change lives at the room's main spot. A
  restyle requested from a close-up returns to the main spot first.

## Needs a team decision

1. **Who talks in the demo.** Ryan wants the team to speak to her on a
   rehearsed path. `Demo-Loop.md` has a judge calling from their own phone and
   going off script. These can coexist (team runs the two-minute loop, then
   hands over the phone), but the prepared lists above are sized for a
   rehearsed path.
2. **Which unit.** Ryan was thinking of a Los Angeles scan. `main` is built on
   the A5 at The Parker at Ellington in Houston, with CoStar and Vexcel data
   joined to it. Switching would mean redoing the data preparation; staying on
   Houston costs nothing. Claude's suggestion: stay on Houston unless there is
   a reason LA is better.
3. **Walking versus transitions.** Ryan is fine with a fade between rooms and
   between a room and a close-up. Demo-Loop row 3 asks for walking through
   scan points with no teleport. If walking already works, close-ups should
   use it too.
4. **Room in the two minutes.** Demo-Loop rule: nothing outside the two-minute
   table. A 25-second spin does not fit every stop. Options: spin only at the
   first room, shorten it, or swap it for an existing beat. Likewise one floor
   restyle would replace or join the red wall beat at 1:05.
5. **Order.** Claude's suggestion: arrival 360 first (smallest, mostly camera
   and instructions), then one floor restyle in one room to judge quality,
   then close-ups.

## Risks

- **Restyle quality.** A floor is a large area seen at a steep angle, with
  furniture legs and shadows on it. Make one real variant early and look at it
  on a phone before committing to more.
- **Spin on a phone.** Check the rotation at the call's frame rate (14.8
  measured); a slow pan can look choppy.
- **Close-up coverage.** Whether the features worth showing have a scan point
  near them is unknown until someone looks at the scan's points.
