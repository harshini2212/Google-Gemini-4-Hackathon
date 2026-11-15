// Lets the guide hear through this computer's microphone instead of the phone line.
//
// For when the FaceTime bridge delivers the caller's picture but not their voice: the phone still shows and plays
// the guide, and whoever is talking to her is in the same room as this computer. Set OPEN_HOUSE_ROOM_MIC to the
// microphone's name (ffmpeg -f avfoundation -list_devices true -i "" lists them), e.g. "MacBook Pro Microphone".
//
// The microphone also hears her own voice coming out of the phone, so it is closed while she speaks and for a moment
// after: the caller cannot talk over her in this mode. It also hears the room, so it only opens for sound louder
// than OPEN_HOUSE_ROOM_MIC_GATE percent of full scale (default 6): someone speaking near it, not chatter across a hall.
import { spawn, spawnSync } from 'node:child_process';
import { voice } from '@livekit/agents';
import { AudioFrame } from '@livekit/rtc-node';

const RATE = 24000, FRAME = RATE / 100;          // 10 ms of sound at a time, as the phone line would give

export class RoomMicrophone extends voice.AudioInput {
  /**
   * @param {string} device the microphone's name
   * @param {() => boolean} speaking true while the guide is talking
   * @param {number} tail how long after she stops the microphone stays closed, in ms, for the phone's delay
   */
  constructor(device, speaking, tail = 900) {
    super();
    const ffmpeg = [process.env.FFMPEG, '/opt/homebrew/bin/ffmpeg', 'ffmpeg'].find(bin => bin && spawnSync(bin, ['-version']).status === 0);
    if (!ffmpeg) throw new Error('The room microphone needs ffmpeg');
    this.capture = spawn(ffmpeg, ['-loglevel', 'error', '-f', 'avfoundation', '-i', `:${device}`, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    this.capture.stderr.on('data', text => console.error('[room-mic]', String(text).trim().slice(0, 200)));
    const gate = (Number(process.env.OPEN_HOUSE_ROOM_MIC_GATE) || 6) * 327.67;
    let rest = Buffer.alloc(0), closedUntil = 0, openUntil = 0, peak = 0, at = Date.now(), last = -1;
    const capture = this.capture;
    this.multiStream.addInputStream(new ReadableStream({
      start(controller) {
        capture.stdout.on('data', chunk => {
          rest = rest.length ? Buffer.concat([rest, chunk]) : chunk;
          while (rest.length >= FRAME * 2) {
            const samples = new Int16Array(FRAME);
            if (speaking()) closedUntil = Date.now() + tail;
            if (Date.now() >= closedUntil) {
              let loud = 0;
              for (let i = 0; i < FRAME; i++) { samples[i] = rest.readInt16LE(i * 2); loud = Math.max(loud, Math.abs(samples[i])); }
              peak = Math.max(peak, loud);
              // Open on a loud frame and stay open through the pauses between words; otherwise pass silence.
              if (loud >= gate) openUntil = Date.now() + 700;
              else if (Date.now() >= openUntil) samples.fill(0);
            }
            rest = rest.subarray(FRAME * 2);
            controller.enqueue(new AudioFrame(samples, RATE, 1, FRAME));
          }
          if (Date.now() - at >= 1000) {      // the same once-a-second level the phone line's audio gets in the log
            const level = Math.round(peak / 327.67);
            if (level !== last) console.log(`[open-house] room microphone level ${level}%`);
            last = level; peak = 0; at = Date.now();
          }
        });
        capture.on('close', () => { try { controller.close(); } catch { /* already closed */ } });
      },
    }));
    console.log(`[open-house] hearing the caller through the room microphone "${device}", not the phone line`);
  }

  async close() {
    this.capture.kill('SIGTERM');
    await super.close();
  }
}
