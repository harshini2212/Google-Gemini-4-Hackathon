import { executeTourTool, guideInstructions, normalizeView, tourTools } from "../shared/tour.mjs";

const endpoint = "https://api.openai.com/v1";

export class ProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function openAI(path, body, asJson = true) {
  if (!process.env.OPENAI_API_KEY) throw new ProviderError(503, "The OpenAI key is missing from .env.");
  const headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
  if (asJson) headers["Content-Type"] = "application/json";
  const response = await fetch(endpoint + path, {
    method: "POST", headers, body: asJson ? JSON.stringify(body) : body,
    signal: AbortSignal.timeout(18_000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    console.error("OpenAI", path, response.status, problem.error?.code ?? problem.error?.type ?? "");
    throw new ProviderError(response.status === 429 ? 429 : 502, response.status === 429
      ? "The guide reached its OpenAI limit. Try again shortly." : "OpenAI could not connect the guide.");
  }
  return response;
}

export async function askGuide(tour, body) {
  let view = normalizeView(tour, body.view);
  const input = (Array.isArray(body.history) ? body.history : []).slice(-10)
    .filter(item => ["assistant", "user"].includes(item?.role) && typeof item?.text === "string")
    .map(item => ({ role: item.role, content: item.text.slice(0, 700) }));
  input.push({ role: "user", content: body.question });
  const actions = [];
  for (let step = 0; step < 4; step += 1) {
    const response = await openAI("/responses", {
      model: process.env.OPEN_HOUSE_TEXT_MODEL || "gpt-4.1-mini",
      instructions: guideInstructions + "\nUse plan_tour before changing the view for a multi-stop request.",
      input, store: false, tools: tourTools.map(spec => ({ ...spec, type: "function", strict: false })),
      tool_choice: step === 3 ? "none" : "auto",
      max_output_tokens: 520,
    });
    const { output = [] } = await response.json();
    const calls = output.filter(item => item.type === "function_call");
    if (!calls.length) {
      const text = output.flatMap(item => item.content ?? [])
        .filter(item => item.type === "output_text").map(item => item.text).join("\n").trim();
      if (text) return { text, view, actions };
      break;
    }
    input.push(...output);
    for (const call of calls) {
      let args;
      try { args = JSON.parse(call.arguments); } catch { args = {}; }
      const action = executeTourTool(tour, view, call.name, args);
      if (action.view !== view) actions.push(call.name);
      view = action.view;
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(action.result) });
    }
  }
  throw new ProviderError(502, "The guide didn’t return an answer. Try asking again.");
}

export async function openVoiceSession(sdp) {
  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify({
    type: "realtime",
    model: process.env.OPEN_HOUSE_REALTIME_MODEL || "gpt-realtime",
    instructions: guideInstructions + "\nCall inspect_tour when a turn depends on the current view, since the renter can also use the tour controls.",
    output_modalities: ["audio"],
    audio: {
      input: {
        transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
        turn_detection: { type: "server_vad", prefix_padding_ms: 300, silence_duration_ms: 550,
          create_response: true, interrupt_response: true },
      },
      output: { voice: "marin" },
    },
    tools: tourTools.map(spec => ({ ...spec, type: "function" })),
    tool_choice: "auto",
  }));
  const answer = await openAI("/realtime/calls", form, false);
  return answer.text();
}
