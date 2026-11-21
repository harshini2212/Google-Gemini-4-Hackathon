# Ellie Home

**Shop your own room on a live video call.** Point your phone camera at a room and talk to Ellie. She looks at the space, finds real products in Shopify stores, and builds each one as a **measured 3D model** at its true size. You can turn the model around over your live camera, or have her draw it into a photo of your room. When you decide, she fills a real Shopify cart and opens the store's own checkout.

Gemini 4 NYC Hackathon · 2026-11-21 · Problem Statement Two (Element 119) + Shopify bonus track.

> **Built on Ellie.** This project extends [jimmyc803/facetime-open-house](https://github.com/jimmyc803/facetime-open-house) (HackPrinceton 2026), an AI open-house guide you FaceTime. Ellie's original README and pitch are in [`docs/original-ellie/`](docs/original-ellie/). [What we built today](#what-we-built-today) lists, file by file, what is new at this hackathon and what is reused.

## The loop

1. **See**: Gemini 3.8 Live watches your camera at 1 fps and listens to you. `look_at_room` runs a Decision 1 gate, then sends a full frame to Gemini 4 Neon. It returns the room type, style, palette, what's already there, and the open floor spaces, with sizes estimated from reference objects (doors, outlets, chairs).
2. **Find**: `find_products` searches six real Shopify storefronts at once. Hydrogen workers read missing specs in parallel and **Decision 1** ranks the results for your room and request. Fit (`fits / too wide / margin`) is computed in code from the listed numbers and is never left to a model.
3. **Build in 3D**: `show_in_3d` turns the product's photos and listing into a part-based 3D model (legs, frame, cushions, arms, shades…) in centimetres, rendered with three.js over your live camera. The model goes through a plan the agent checks itself against:
   - **Dimensions**: overall W × D × H from the listing text, or read and estimated by the reasoning model when the listing doesn't say.
   - **Draft**: the reasoning model writes the part model.
   - **Rule checks (code)**: overall size within 8% on every axis, standing on the floor, no floating parts, valid geometry.
   - **Repair**: failures go back to the model as concrete issues, for up to 2 rounds.
   - **Snap**: a deterministic final scale to the measured size.
   - **Visual check**: the browser renders the model, and the Decision model compares that render with the real product photo. Below 7/10 likeness, its listed differences trigger one more repair.
4. **Place**: `place_in_room` gives the image model your actual camera frame plus the product photo and the true size. It returns a preview of the product in *your* room.
5. **Buy**: `add_to_cart` → `checkout` builds a Shopify cart permalink per store (`https://store/cart/VARIANT:QTY,…`). You review and pay on the store's own checkout. Ellie never handles payment.

## Gemini 4 models, one job each

| Model | Id | Job |
| --- | --- | --- |
| Gemini 3.8 Live | `gemini-3.8-live` | Real-time voice + camera call; decides when to call each tool |
| **Gemini 4 Carbon** | `gemini-4-carbon` | Deepest reasoning: drafts and repairs the measured 3D part model |
| **Gemini 4 Neon** | `gemini-4-neon` | Fast analysis while you wait: reads the room, resolves dimensions, lists render-vs-photo differences |
| **Gemini 4 Hydrogen** | `gemini-4-hydrogen` | Typed chat agent + parallel spec-reading workers for every search result |
| Gemini Decision 1 | `gemini-decision-1` | Decisions API: gates camera frames (yes/no), ranks products (rubric), scores 3D likeness (rubric) |
| Nano Banana 2.1 | `gemini-nano-banana-2.1` | Places the chosen product into the shopper's camera frame |

Per the Builder Guide, Gemini 4 calls use thinking levels (Carbon/Neon medium, Hydrogen low) and no temperature.
Team split and API contracts: [`docs/TEAM-PLAN.md`](docs/TEAM-PLAN.md).

The app shows a live log of every model call (role, job, model id, latency), so you can see which model did what.

## Proof it works: the eval

`eval/run.mjs` measures whether products come out at their **true size**. It runs on products the team never looked at.

- **Test set**: a seeded random sample of real products from public Shopify stores (Tribesigns, Walker Edison, Albany Park, Burrow) whose listing prints overall W × D × H. Those numbers are the ground truth. Nothing was hand-picked or written by us. The sample is messy: pendant lights whose height includes the chain, folded sofa beds, L-shaped benches, sectionals, outdoor sets.
- **Conditions**: **A** gives the full listing (photos, title and text). **B** gives photos and title only, with every dimension scrubbed from the text, as with an Instagram post or showroom photo.
- **Baseline**: one call to the same reasoning model ("build this product in 3D"), with no dimension step, checks or repair.
- **Metrics**: mean per-axis size error, the share of products with all three axes within 10%, structural validity, the share of first drafts that pass, repairs per product, and time.

```bash
node --env-file=.env eval/run.mjs --n 30            # writes eval/REPORT.md + eval/results/*.json
node eval/run.mjs --collect-only --n 30             # just list the test set (no API calls)
```

Results and the worst failures are in [`eval/REPORT.md`](eval/REPORT.md).

## Run it

Needs Node 22+ and a Gemini API key.

```bash
npm install
cp .env.example .env    # add GEMINI_API_KEY and the Gemini 4 model ids from the Builder Guide
npm run dev             # http://localhost:5180
```

**On your phone:** `npm run phone` also serves HTTPS on your Wi-Fi address (it prints `https://<ip>:5443`). Open that on a phone on the same Wi-Fi, accept the self-signed certificate warning, and the phone camera and mic work.

Open it in Chrome, turn on the camera, and either tap **Talk live** or type. Shopify search needs no keys, because it uses each store's public storefront endpoints.

## What we built today

**New at the Gemini 4 hackathon (2026-11-21):**

| File | What it does |
| --- | --- |
| `server/gemini.mjs` | Gemini 4 client: model roles, structured JSON calls, image generation, chat steps, ephemeral Live tokens, model-call trace |
| `server/shopify.mjs` | Federated Shopify search across storefronts, catalog cache, listing-dimension parser, cart-permalink checkout |
| `server/home.mjs` | Room reading, Decision ranking + coded fit check, dimension resolution, 3D part-model generation, rule checks, repair loop, snap-to-size, visual self-check, staging in the room |
| `shared/home-tools.mjs` | The six tools and Ellie's shopping instructions, shared by voice and chat |
| `src/live.mjs` | Gemini Live in the browser: 16 kHz mic via AudioWorklet, camera frames at 1 fps, 24 kHz voice playback with barge-in, tool calls |
| `src/model-view.jsx` | three.js renderer for the part models: transparent AR overlay on the camera, PBR materials, contact shadows, snapshot for the visual check |
| `src/main.jsx` | Rewritten app: camera stage, 3D / placed-in-room views, product cards with fit badges, cart + checkout sheet, model activity log |
| `src/home.css` | Styles for all of the above |
| `eval/run.mjs` | The eval harness (test-set collection, two conditions, baseline vs pipeline, report) |
| `server/index.mjs` | Rewritten API routes for the above (kept Ellie's localhost guard and static serving) |

**Reused from Ellie (facetime-open-house):** the React + Vite app shell, the server skeleton and request guards, the guide-panel design and `src/styles.css`, and the idea of a live guide that changes what you see while you talk. Ellie's FaceTime/LiveKit agent (`facetime/`), property tour (`shared/tour.mjs`, `src/stage.jsx`, `src/panorama.jsx`) and OpenAI voice (`server/openai.mjs`, `src/voice.mjs`) are left in the repo unchanged, are not used by Ellie Home, and are not part of our demo.

## Honest limits

- Room sizes from a single camera frame are estimates. Ellie says so and asks for a tape-measure number.
- The 3D models are part-based approximations built for size and silhouette. They are not photoreal scans.
- The placed-in-room image is a generated preview and can drift from the exact product.
- Product data comes from public storefront endpoints, so a store can rate-limit us. Search falls back to its cached catalog.
