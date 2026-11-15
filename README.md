# FaceTime Open House

An AI agent gives a live open house over FaceTime. It walks you through an apartment using Matterport 3D scans, answers questions as you go, and can restyle the space when you ask.

## Concept

The agent draws on three data sources:

1. **Matterport 3D scans** (main source): the walkthrough itself
2. **Area / neighborhood data**: commute, nearby places, what the area is like
3. **Building exterior renders**

Polish wins this one, not novelty. The open-house idea is strong enough as long as the demo is tight.

## Why FaceTime

- Hardware projects win because judges get a hands-on demo moment. FaceTime gives you that same moment on a phone.
- Precedent: this year's Cal Hacks grand prize went to a FaceTime OS for controlling a PC.
- **Goal: get it running on the judge's own phone during the demo.**

## Architecture

```
Matterport API ──► Unity / Blender (render) ──► video stream ──► FaceTime call
                                                        ▲
             full-duplex LLM agent (narration + Q&A) ───┘
             unified API merges FaceTime audio + text streams on the backend
```

- Pull Matterport into Unity or Blender, then stream the render to FaceTime. Basic wiring should take under 2 hours.
- Put a full-duplex LLM agent on top for live narration and Q&A.
- Blender + Codex recommended for the rendering work.

### Personalization (the demo feature)

- Change wall colors or color schemes on command
- Preload a few style variants so changes look like live rendering
- Stretch goal: change the furniture style on request (e.g. "1920s vintage")
- Precedent: we already edited a Matterport model from pristine to fire-damaged for a wildfire-insurance demo

## Demo strategy

- Build for the demo, not the full product.
- Total window is 5–8 min, and the core demo should land in **2–3 min**.
- Don't stack features ("feature one, two, three, four...").
- Preload a few realistic states, or do one simple color/style change live.

## Next steps

- [ ] Wire Matterport into Blender and stream it to FaceTime
- [ ] Get color/style changes demo-ready
- [ ] Message Anish about helping with the build (he's in India, so he'll be awake during the hackathon; check his bandwidth given his PR review load)
