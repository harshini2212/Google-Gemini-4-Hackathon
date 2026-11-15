# FaceTime Open House

An AI guide walks a renter through a real apartment on FaceTime. The demo tours the A5 at The Parker at Ellington in Houston. The guide can plan a route, switch camera views, answer from the property record, and preview wall finishes.

## Browser rehearsal

```sh
npm ci
npm run dev
```

Open [localhost:5180](http://localhost:5180) in Chrome on the host Mac. The app serves prepared assets from `data/demo/`. The OpenAI key in the local `.env` enables typed questions and live conversation. Use **Talk live** to rehearse with the browser microphone.

## Prepare the property data

Use Node 22.12 or later, Blender 5.1, and Python with Pillow, NumPy, and Shapely. The local `.env` supplies the Matterport API key and token and the Vexcel API key.

```sh
python3 -m pip install Pillow numpy shapely
npm run prepare:demo -- --live --kit /path/to/challenge-kit
```

Point `--kit` at the CoStar challenge export containing `data/apartment-listing.jsonl` and `data/commercial-property.jsonl`. On this Mac, the command defaults to the kit under the existing Brace workspace. Running `npm run prepare:demo` without `--live` reads the Matterport and Vexcel captures already cached there. Use `--cache` or `--blender` to supply alternative paths.

## FaceTime

The [Chert agent](facetime/) serves the tour video and answers the caller using the shared tour tools. From that directory, keep `npm start` and `npx @trychert/facetime@0.1.0-beta.21 dev` running in separate terminals. Wait for the agent to enter its waiting room, then place a FaceTime Video call from a verified iPhone.

For a hosted screen-share rehearsal, open **FaceTime setup** and **Open tour window** on the Mac. Share that window from the FaceTime menu bar. The window follows room changes, camera turns, finishes, and guide captions from the host tab. [Apple window sharing guide](https://support.apple.com/en-mz/guide/facetime/fctmdcf2007a/mac)

For voice in the hosted screen-share setup, set FaceTime **Video → Output** to one loopback device and **Video → Microphone** to a second. In the web app, select **Find audio devices**, then match **Guest → guide** to FaceTime Output and **Guide → guest** to FaceTime Microphone. Choose **Connect guide audio**. [BlackHole audio loopback](https://github.com/ExistentialAudio/BlackHole)

## Two-minute walkthrough

1. Ask “I work from home and drive. Can you show me a desk spot and where I’d park?” The guide opens the dining nook and adds a parking stop.
2. Say “Next.” The aerial shows the registered scan point and a visible parking row about 35 feet away in a straight line. CoStar supplies the community-wide parking count. Confirm actual access and availability on site.
3. Ask “Can I see the fireplace wall in soft sage?” The shared view returns to the living room and applies the Blender preview on the original Matterport scan.

The layout uses measured Matterport room boundaries and connected scan points. CoStar supplies the listed area and asking-rent snapshot. Paint previews apply to the fireplace wall from the living-room scan position. [Matterport Model API](https://matterport.github.io/showcase-sdk/modelapi_home.html) · [Official OpenAI documentation for Realtime WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
