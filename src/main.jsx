import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownRight, ArrowRight, ArrowUp, AudioLines, ChevronRight, CircleDot, DoorOpen,
  Focus, House, Layers, MapPin, Maximize, Mic, MonitorUp, ParkingSquare, Square, Video,
} from "lucide-react";
import "@fontsource-variable/dm-sans";
import "@fontsource/instrument-serif/latin-400.css";
import "./styles.css";
import { currentDestination, destinations, executeTourTool, finishes, initialView } from "../shared/tour.mjs";
import { Stage } from "./stage.jsx";
import { CallSetup } from "./call-setup.jsx";
import { connectVoice } from "./voice.mjs";

const prompts = [
  { icon: Focus, text: "Show me a desk spot and parking" },
  { icon: Layers, text: "Try sage on the living room wall" },
  { icon: House, text: "What’s the asking rent for the A5?" },
];
const tabs = [
  { id: "interior", icon: House, label: "Interior" },
  { id: "site", icon: MapPin, label: "Aerial" },
  { id: "plan", icon: Layers, label: "Floor plan" },
];

function Logo() {
  return <div className="wordmark"><span className="logo-mark"><DoorOpen size={19} strokeWidth={1.8} /></span>Open House</div>;
}

function Header({ onSetup }) {
  return (
    <header className="topbar">
      <div className="wrap topbar-inner">
        <Logo />
        <button type="button" className="setup-button" onClick={onSetup}><Video size={17} /> FaceTime setup <ArrowDownRight size={13} /></button>
      </div>
    </header>
  );
}

function Headline({ tour }) {
  const { property, floor } = tour;
  return (
    <header className="property-head">
      <div>
        <p className="eyebrow"><span /> GUIDED APARTMENT TOUR</p>
        <h1>{property.name}</h1>
        <p className="property-address"><MapPin size={15} /> {property.address}, {property.city}, {property.state} <span>·</span> {floor.name} floor plan</p>
      </div>
      <dl className="property-facts" aria-label="CoStar listing details">
        <div><dt>{floor.numBeds}</dt><dd>Bedroom</dd></div>
        <div><dt>{floor.numBaths}</dt><dd>Bath</dd></div>
        <div><dt>{floor.minSquareFeet} <small>sq ft</small></dt><dd>Listed area</dd></div>
      </dl>
    </header>
  );
}

function Viewer({ tour, view, action, resetCount, reset, onPose, openShare }) {
  return (
    <section className="viewer-card" aria-label="Property viewer">
      <div className="viewer-toolbar">
        <div className="view-tabs" role="group" aria-label="Property view">
          {tabs.map(({ id, icon: Icon, label }) => (
            <button className={view.mode === id ? "active" : ""} aria-pressed={view.mode === id} key={id} type="button"
              onClick={() => action("show_view", { stop: id === "interior" ? view.stop : id === "site" ? "parking" : "floorplan" })}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button expand-button" onClick={openShare} aria-label="Open shared viewer" title="Open shared viewer"><Maximize size={17} /></button>
      </div>
      <Stage tour={tour} state={view} resetCount={resetCount} reset={reset} onPose={onPose} />
      <div className="viewer-footer">
        {view.mode === "interior" && view.stop === "living" ? (
          <div className="finishes" role="group" aria-label="Fireplace wall finish">
            <span>Wall preview</span>
            {Object.entries(finishes).map(([key, finish]) => (
              <button type="button" key={key} className={view.finish === key ? "chosen" : ""}
                aria-pressed={view.finish === key} onClick={() => action("preview_finish", { finish: key })}>
                <span aria-hidden="true" style={{ background: finish.color }} /> {finish.label}
              </button>
            ))}
          </div>
        ) : view.mode === "site" ? (
          <p className="viewer-note"><ParkingSquare size={17} /> CoStar lists {tour.property.parking_spaces} spaces across the community</p>
        ) : view.mode === "plan" ? (
          <p className="viewer-note"><Layers size={17} /> {view.path.length ? "Dashed lines follow connected scan points" : "Room outlines from the Matterport scan"}</p>
        ) : <p className="viewer-note"><CircleDot size={16} /> {tour.stops[view.stop].detail}</p>}
        {view.mode === "interior" && <span className="drag-note"><Focus size={15} /> Drag to look around</span>}
      </div>
    </section>
  );
}

function Guide({ messages, partial, pending, status, error, setError, ask, startVoice, stopVoice, play, view, action }) {
  const [input, setInput] = useState("");
  const thread = useRef(null);
  const active = ["connecting", "listening", "thinking", "speaking"].includes(status);
  const statusText = {
    idle: "Ready", connecting: "Connecting", listening: "Listening", thinking: "Thinking", speaking: "Speaking",
  }[status];
  const here = currentDestination(view);
  const next = view.route[view.route.indexOf(here) + 1];
  const waiting = pending || ["thinking", "speaking"].includes(status);
  useEffect(() => {
    const node = thread.current;
    node.scrollTop = node.scrollHeight;
  }, [messages, partial, pending]);

  function submit(event) {
    event.preventDefault();
    if (!input.trim() || waiting || status === "connecting") return;
    ask(input.trim());
    setInput("");
  }

  return (
    <aside className="guide-card" aria-label="Tour guide">
      <div className="guide-head">
        <span className="guide-icon"><AudioLines size={23} strokeWidth={1.75} /></span>
        <div><h2>Tour guide</h2><p><span className={active ? "guide-dot active" : "guide-dot"} />{statusText}</p></div>
        <button type="button" className={active ? "talk-button live" : "talk-button"} onClick={active ? stopVoice : startVoice}>
          {active ? <Square size={13} /> : <Mic size={15} />}
          {active ? "End voice" : "Talk live"}
        </button>
      </div>
      <div className="guide-thread" ref={thread} role="log" aria-label="Tour conversation" aria-live="polite">
        <div className="bubble assistant">I can take you through the rooms, show you where to park, or try a new wall color. What would you like to see?</div>
        {messages.map(({ id, role, text }) => <div className={`bubble ${role}`} key={id}>{text}</div>)}
        {partial && <div className="bubble assistant">{partial}</div>}
        {pending && <div className="bubble assistant pending"><span /><span /><span /><span className="sr-only">Guide is working</span></div>}
        {!messages.length && !pending && (
          <div className="prompt-list">
            {prompts.map(({ icon: Icon, text }) => (
              <button type="button" key={text} disabled={waiting || status === "connecting"} onClick={() => ask(text)}>
                <Icon size={15} /> <span>{text}</span> <ChevronRight size={14} />
              </button>
            ))}
          </div>
        )}
      </div>
      {view.route.length > 0 && (
        <div className="saved-route">
          <div className="saved-route-label">Your route</div>
          <div className="route-stages">
            {view.route.map(key => (
              <button type="button" className={key === here ? "route-active" : ""} aria-current={key === here ? "step" : undefined}
                key={key} onClick={() => action("show_view", { stop: key })}>{destinations[key]}</button>
            ))}
          </div>
          {next && <button type="button" className="next-stop" onClick={() => action("next_stop")}>Next <ArrowRight size={14} /></button>}
        </div>
      )}
      {play && <button type="button" className="audio-play" onClick={play}>Play guide audio</button>}
      {error && <div className="guide-error" role="alert">{error} <button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
      <form className="guide-compose" onSubmit={submit}>
        <label htmlFor="guide-question" className="sr-only">Ask the tour guide</label>
        <input id="guide-question" value={input} onChange={event => setInput(event.target.value)} placeholder="Ask about this home…" maxLength={700} />
        <button type="submit" title="Send question" aria-label="Send question" disabled={!input.trim() || waiting || status === "connecting"}>
          <ArrowUp size={19} />
        </button>
      </form>
    </aside>
  );
}

function Stops({ tour, view, action }) {
  return (
    <section className="stops-section" aria-labelledby="stops-title">
      <div className="stops-heading"><h2 id="stops-title">Explore the apartment</h2>
        <button type="button" className="text-button" onClick={() => action("show_view", { stop: "floorplan" })}>See the layout <ArrowRight size={15} /></button>
      </div>
      <div className="stops-list">
        {Object.entries(tour.stops).map(([key, stop]) => {
          const active = view.mode === "interior" && view.stop === key;
          return (
            <button type="button" key={key} className={active ? "stop-card active" : "stop-card"}
              aria-pressed={active} onClick={() => action("show_view", { stop: key })}>
              <img src={stop.poster} alt="" />
              <span>{stop.label}</span><ArrowUp size={15} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ShareView({ tour, code }) {
  const [frame, setFrame] = useState({ view: initialView, pose: null, turns: "" });
  useEffect(() => {
    document.title = `Open House · Shared tour`;
    if (!code) return;
    const channel = new BroadcastChannel(`open-house-${code}`);
    channel.onmessage = event => {
      if (event.data.type === "frame") setFrame(event.data.frame);
      if (event.data.type === "pose") setFrame(previous => ({ ...previous, pose: event.data.pose }));
    };
    channel.postMessage({ type: "ready" });
    return () => channel.close();
  }, [code]);
  return (
    <main className="share-view">
      <header><Logo /><span>{tour.property.name} · {tour.floor.name}</span></header>
      <Stage tour={tour} state={frame.view} pose={frame.pose} resetCount={frame.resetCount} share />
      {frame.turns && <p className="share-caption"><AudioLines size={20} />{frame.turns}</p>}
    </main>
  );
}

function Host({ tour }) {
  const [view, setView] = useState(initialView);
  const [resetCount, setResetCount] = useState(0);
  const [messages, setMessages] = useState([]);
  const [partial, setPartial] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [playAudio, setPlayAudio] = useState(null);
  const [setup, setSetup] = useState(false);
  const [devices, setDevices] = useState({ input: "", output: "" });
  const viewRef = useRef(view);
  const channel = useRef(null);
  const pose = useRef(null);
  const shareCode = useRef(null);
  const sharePopup = useRef(null);
  const voice = useRef(null);
  const controller = useRef(null);
  const currentFrame = useRef(null);
  const turnText = partial || messages.findLast(message => message.role === "assistant")?.text || "";
  currentFrame.current = { view, pose: pose.current, turns: turnText, resetCount };

  useEffect(() => {
    shareCode.current = crypto.randomUUID();
    const transport = new BroadcastChannel(`open-house-${shareCode.current}`);
    channel.current = transport;
    transport.onmessage = event => {
      if (event.data.type === "ready") transport.postMessage({ type: "frame", frame: { ...currentFrame.current, pose: pose.current } });
    };
    return () => {
      controller.current?.abort();
      transport.close();
    };
  }, []);
  useEffect(() => {
    channel.current?.postMessage({ type: "frame", frame: { ...currentFrame.current, pose: pose.current } });
  }, [view, turnText, resetCount]);

  function add(role, text) {
    if (!text?.trim()) return;
    setMessages(previous => [...previous.slice(-39), { id: crypto.randomUUID(), role, text: text.trim() }]);
  }

  function reset() {
    pose.current = null;
    setResetCount(count => count + 1);
  }

  function update(nextView) {
    if (viewRef.current === nextView) return;
    viewRef.current = nextView;
    setView(nextView);
    reset();
  }

  function action(name, args) {
    const result = executeTourTool(tour, viewRef.current, name, args);
    update(result.view);
    return result.result;
  }

  function onPose(nextPose) {
    pose.current = nextPose;
    if (sharePopup.current && !sharePopup.current.closed) channel.current?.postMessage({ type: "pose", pose: nextPose });
  }

  function openShare() {
    if (sharePopup.current && !sharePopup.current.closed) {
      sharePopup.current.focus();
      return true;
    }
    const popup = window.open(`/?view=share&room=${shareCode.current}`, "open-house-share", "popup,width=1040,height=720");
    sharePopup.current = popup;
    return Boolean(popup);
  }

  async function ask(question) {
    if (pending || status === "connecting") return;
    setError("");
    add("user", question);
    if (voice.current) {
      setStatus("thinking");
      voice.current.type(question);
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, view: viewRef.current, history: messages.slice(-10) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The guide could not answer.");
      if (data.actions.length) update(data.view);
      add("assistant", data.text);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setPending(false);
    }
  }

  function onVoiceEvent(event) {
    switch (event.type) {
      case "conversation.item.input_audio_transcription.completed":
        add("user", event.transcript);
        break;
      case "response.created":
        setStatus("thinking");
        break;
      case "input_audio_buffer.speech_started":
        setPartial("");
        setStatus("listening");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        setStatus("listening");
        break;
      case "output_audio_buffer.started":
        setStatus("speaking");
        break;
      case "response.output_audio_transcript.delta":
        setPartial(previous => previous + event.delta);
        break;
      case "response.output_audio_transcript.done":
        setPartial("");
        add("assistant", event.transcript);
        break;
      case "response.done":
        if (event.response.status === "failed") {
          setError("The live guide could not finish that turn.");
          setStatus("listening");
        } else if (event.response.status !== "completed") {
          setPartial("");
          setStatus("listening");
        }
        break;
      case "error":
        setError("The live guide could not complete that turn.");
        setStatus("listening");
        break;
      default:
        break;
    }
  }

  function stopVoice() {
    controller.current?.abort();
    controller.current = null;
    voice.current = null;
    setStatus("idle");
    setPartial("");
    setPlayAudio(null);
  }

  async function startVoice(selected = { input: "", output: "" }) {
    if (controller.current || pending) return;
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setStatus("connecting");
    try {
      const connection = await connectVoice({
        ...selected, signal: abort.signal,
        onEvent: onVoiceEvent, onTool: action,
        onDisconnect() {
          if (controller.current !== abort) return;
          stopVoice();
          setError("The live guide disconnected. You can reconnect or type a question.");
        },
        onAudioBlocked(play) {
          if (abort.signal.aborted) return;
          setPlayAudio(() => () => play().then(() => setPlayAudio(null))
            .catch(() => setError("The browser blocked guide audio.")));
        },
      });
      if (controller.current === abort) {
        voice.current = connection;
        setStatus("listening");
      } else connection.close();
    } catch (problem) {
      if (controller.current !== abort) return;
      stopVoice();
      setError(problem.name === "NotAllowedError" ? "Allow microphone access to start the live guide." : problem.message);
    }
  }

  return (
    <>
      <Header onSetup={() => setSetup(true)} />
      <main className="wrap">
        <Headline tour={tour} />
        <div className="workbench">
          <Viewer tour={tour} view={view} action={action} resetCount={resetCount} reset={reset} onPose={onPose}
            openShare={() => { if (!openShare()) setError("Allow pop-ups to open the shared viewer."); }} />
          <Guide messages={messages} partial={partial} pending={pending} status={status} error={error} setError={setError}
            ask={ask} startVoice={() => startVoice()} stopVoice={stopVoice} play={playAudio} view={view} action={action} />
        </div>
        <Stops tour={tour} view={view} action={action} />
        <footer className="source-footer">
          <div><span>Property record</span> CoStar <b>·</b> <span>Interior scan</span> Matterport <b>·</b> <span>Aerial</span> Vexcel</div>
          <button type="button" className="text-button" onClick={() => setSetup(true)}><MonitorUp size={15} /> Share on FaceTime</button>
        </footer>
      </main>
      {setup && <CallSetup close={() => setSetup(false)} openShare={openShare} devices={devices} setDevices={setDevices}
        pending={pending} start={selected => { stopVoice(); startVoice(selected); }} />}
    </>
  );
}

function App() {
  const [tour, setTour] = useState(null);
  const [error, setError] = useState("");
  const query = new URLSearchParams(window.location.search);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/tour", { signal: abort.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setTour(data);
    }).catch(problem => {
      if (!abort.signal.aborted) setError(problem.message);
    });
    return () => abort.abort();
  }, []);
  if (!tour) return <main className="wrap load-state"><Logo /><p role={error ? "alert" : "status"}>{error || "Loading the apartment…"}</p></main>;
  return query.get("view") === "share" ? <ShareView tour={tour} code={query.get("room")} /> : <Host tour={tour} />;
}

createRoot(document.getElementById("root")).render(<App />);
