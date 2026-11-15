// The tour picture for the FaceTime camera track. The drawing runs in screen-worker.mjs; this is its handle.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

export const WIDTH = Number(process.env.TOUR_WIDTH) || 1280;
export const HEIGHT = Math.round(WIDTH * 9 / 16 / 2) * 2;
export const FPS = 15;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Loads the tour pictures and returns the screen once every picture is in memory.
 * `show(view)` moves the picture to a tour view; `play(onFrame)` starts handing over RGBA frames; `pause()` stops.
 */
export function createScreen({ mediaDir = join(here, '../data/demo') } = {}) {
  const worker = new Worker(new URL('./screen-worker.mjs', import.meta.url), { workerData: { width: WIDTH, height: HEIGHT, fps: FPS, mediaDir } });
  let onFrame = null;
  return new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.on('message', message => {
      if (message.type === 'frame') onFrame?.(new Uint8Array(message.data));
      else if (message.type === 'error') console.error('[screen]', message.message);
      else if (message.type === 'ready') resolve({
        show: view => worker.postMessage({ type: 'view', view }),
        play(callback) { onFrame = callback; worker.postMessage({ type: 'play' }); },
        pause() { onFrame = null; worker.postMessage({ type: 'pause' }); },
        close: () => worker.terminate(),
      });
    });
  });
}
