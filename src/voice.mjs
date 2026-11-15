async function waitForChannel(channel, signal) {
  if (channel.readyState === "open") return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("The guide audio connection timed out.")), 12_000);
    const opened = () => finish();
    const closed = () => finish(new Error("The guide audio connection closed."));
    const aborted = () => finish(signal.reason);
    function finish(error) {
      clearTimeout(timer);
      channel.removeEventListener("open", opened);
      channel.removeEventListener("close", closed);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    }
    channel.addEventListener("open", opened);
    channel.addEventListener("close", closed);
    signal.addEventListener("abort", aborted);
    if (signal.aborted) aborted();
  });
}

export async function connectVoice({ input, output, signal, onEvent, onTool, onDisconnect, onAudioBlocked }) {
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection !== "function") {
    throw new Error("Voice needs a browser with microphone and WebRTC access on localhost.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: input
      ? { deviceId: { exact: input }, channelCount: { ideal: 1 }, echoCancellation: false, noiseSuppression: false }
      : { echoCancellation: true, noiseSuppression: true },
  });
  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel("oai-events");
  const audio = new Audio();
  let closing = false;
  let consecutiveActions = 0;
  const send = event => { if (channel.readyState === "open") channel.send(JSON.stringify(event)); };

  function close() {
    if (closing) return;
    closing = true;
    signal.removeEventListener("abort", close);
    stream.getTracks().forEach(track => track.stop());
    channel.close();
    peer.close();
    audio.pause();
    audio.srcObject = null;
  }

  const disconnect = () => {
    if (closing) return;
    close();
    onDisconnect();
  };
  signal.addEventListener("abort", close, { once: true });
  channel.addEventListener("close", disconnect);
  peer.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(peer.connectionState)) disconnect();
  };
  channel.onmessage = ({ data }) => {
    if (closing) return;
    const event = JSON.parse(data);
    onEvent(event);
    if (event.type !== "response.done" || event.response.status !== "completed") return;
    const calls = event.response.output.filter(item => item.type === "function_call");
    if (!calls.length) {
      consecutiveActions = 0;
      return;
    }
    for (const call of calls) {
      let args;
      try { args = JSON.parse(call.arguments); } catch { args = {}; }
      const result = consecutiveActions < 4 ? onTool(call.name, args) : { error: "The tour action limit was reached." };
      send({ type: "conversation.item.create", item: {
        type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result),
      } });
    }
    consecutiveActions += 1;
    send(consecutiveActions >= 4
      ? { type: "response.create", response: { tool_choice: "none" } }
      : { type: "response.create" });
  };

  try {
    signal.throwIfAborted();
    audio.autoplay = true;
    if (output) {
      if (typeof audio.setSinkId !== "function") throw new Error("Open the host tour in Chrome to select the FaceTime audio output.");
      await audio.setSinkId(output);
    }
    peer.ontrack = event => {
      if (closing) return;
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      audio.play().catch(() => onAudioBlocked(() => audio.play()));
    };
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    await peer.setLocalDescription(await peer.createOffer());
    const answer = await fetch("/api/voice", {
      method: "POST", headers: { "Content-Type": "application/sdp" }, body: peer.localDescription.sdp, signal,
    });
    if (!answer.ok) {
      const problem = await answer.json().catch(() => ({}));
      throw new Error(problem.error || "The live guide could not connect.");
    }
    await peer.setRemoteDescription({ type: "answer", sdp: await answer.text() });
    await waitForChannel(channel, signal);
    signal.throwIfAborted();
    return {
      close,
      type(text) {
        consecutiveActions = 0;
        send({ type: "conversation.item.create", item: {
          type: "message", role: "user", content: [{ type: "input_text", text }],
        } });
        send({ type: "response.create" });
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}
