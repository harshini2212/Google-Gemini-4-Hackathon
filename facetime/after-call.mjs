// Right after a FaceTime call ends, texts the caller to ask how the tour went, over iMessage through Chert.
//   node --env-file=.env.local after-call.mjs <chert call id> [phone]
// agent.mjs starts this as its own process when a real call ends (never for rehearsals or the browser preview, which
// have no Chert call). It needs CHERT_API_KEY and CHERT_PROJECT_ID. OPEN_HOUSE_FEEDBACK_TEXT=0 turns it off.
//
// Who gets the text: Chert does not tell an agent who called (a call record has no number on it), so the number is
// the one the caller gave the guide during the call (the [phone] argument), or else OPEN_HOUSE_FEEDBACK_TO, the phone
// the demo is run from. With neither, nothing is sent. Chert itself only delivers to a phone that has joined this
// project, and says so when it refuses; what happened is one line in visits/after-call.log.
import { readFile } from 'node:fs/promises';

const { CHERT_API_KEY, CHERT_PROJECT_ID, OPEN_HOUSE_PROPERTY: slug } = process.env;
const id = process.argv[2];
const api = 'https://app.trychert.com/api/v1';
const headers = { Authorization: `Bearer ${CHERT_API_KEY}`, 'X-Chert-Project-Id': CHERT_PROJECT_ID, 'Content-Type': 'application/json' };
const say = text => console.log(`[after-call] ${new Date().toISOString()} call ${String(id).slice(0, 8)}: ${text}`);
/** A phone number as Chert takes it, or '' when it is not one. Ten digits are taken as a US number. */
const number = text => { const digits = String(text ?? '').replace(/[^\d+]/g, '').replace(/^(\d{10})$/, '+1$1').replace(/^(1\d{10})$/, '+$1'); return /^\+\d{10,15}$/.test(digits) ? digits : ''; };

if (process.env.OPEN_HOUSE_FEEDBACK_TEXT === '0') process.exit(0);
if (!id || !CHERT_API_KEY || !CHERT_PROJECT_ID) { say('nothing sent: a call id, CHERT_API_KEY and CHERT_PROJECT_ID are needed'); process.exit(2); }
const recipient = number(process.argv[3]) || number(process.env.OPEN_HOUSE_FEEDBACK_TO);
if (!recipient) { say('nothing sent: the caller gave no number and OPEN_HOUSE_FEEDBACK_TO is not set (Chert does not say who called)'); process.exit(0); }

try {
  const get = async path => (await (await fetch(api + path, { headers, signal: AbortSignal.timeout(15_000) })).json()).data;
  // The line the call came in on; the project's first line if the call record cannot be read.
  const lineId = (await get(`/calls/${encodeURIComponent(id)}`).catch(() => null))?.line_id ?? (await get('/lines'))?.items?.[0]?.id;
  if (!lineId) { say('nothing sent: could not find the line the call came in on'); process.exit(0); }
  const home = slug ? JSON.parse(await readFile(new URL(`./properties/${slug}/site.json`, import.meta.url), 'utf8')).guide?.short : null;
  const text = `Hi, it's Ellie, your AI open-house guide. Thanks for touring ${home ?? 'the home'} with me. How did you like the experience? Reply with a number from 1 to 5, and any feedback on what you would want to see or ask next time.`;
  // One key per call: a retry of the same call can never text twice.
  const response = await fetch(`${api}/shared-messages`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': `open-house-feedback-${id}` },
    body: JSON.stringify({ line_id: lineId, recipient, text }), signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => ({}));
  say(response.ok ? `feedback text handed to Chert for the number ending ${recipient.slice(-2)} (${body.data?.state ?? response.status})`
    : `Chert refused the feedback text: ${response.status} ${body.error?.code ?? ''} ${String(body.error?.message ?? '').slice(0, 160)}`);
} catch (error) {
  say(`could not send the feedback text: ${error?.message ?? error}`);
}
