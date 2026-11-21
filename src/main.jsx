import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp, AudioLines, Box, Camera, CameraOff, Check, ChevronRight, CircleDot, ExternalLink,
  Mic, Ruler, ScanSearch, ShoppingBag, Sofa, Sparkles, Square, Wand2, X,
} from "lucide-react";
import "@fontsource-variable/dm-sans";
import "@fontsource/instrument-serif/latin-400.css";
import "./styles.css";
import "./home.css";
import { ModelView } from "./model-view.jsx";
import { connectLive } from "./live.mjs";
import { CartBar } from "./commerce/cart.jsx";
import { makeCartItem, startCheckout } from "./commerce/client.mjs";

const prompts = [
  { icon: ScanSearch, text: "What would make this room feel finished?" },
  { icon: Sofa, text: "Find me a sofa that fits this wall, under $1,800" },
  { icon: Sparkles, text: "I need a floor lamp for this corner" },
];
const ROLE_LABEL = { live: "Live", carbon: "Carbon", neon: "Neon", hydrogen: "Hydrogen", decision: "Decision", image: "Image" };

async function api(path, payload) {
  const response = await fetch(path, {
    method: payload === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

const money = n => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const cm = n => (n ? `${Math.round(n)} cm` : "?");
const inches = n => (n ? `${Math.round(n / 2.54)}″` : "?");

function Header({ status }) {
  return (
    <header className="topbar">
      <div className="wrap topbar-inner">
        <div className="wordmark"><span className="logo-mark"><Sofa size={19} strokeWidth={1.8} /></span>Ellie <span className="wordmark-sub">Home</span></div>
        <div className="model-pills">
          {status?.models && Object.entries(status.models).map(([role, id]) => (
            <span key={role} className="model-pill" title={id}><b>{ROLE_LABEL[role]}</b> {id}</span>
          ))}
          {status && !status.ready && <span className="model-pill warn">Add GEMINI_API_KEY</span>}
        </div>
      </div>
    </header>
  );
}

function Steps({ build, critique }) {
  if (!build) return null;
  return (
    <ol className="build-steps">
      {build.steps.map((s, i) => (
        <li key={i}><Check size={13} /><b>{s.step}</b> <span>{s.detail}</span></li>
      ))}
      {critique && <li><Check size={13} /><b>visual check</b> <span>{critique.score}/10 likeness{critique.issues?.length ? ` · ${critique.issues.slice(0, 2).join("; ")}` : ""}</span></li>}
    </ol>
  );
}

function StageCard({ videoRef, cameraOn, startCamera, stopCamera, tab, setTab, build, critique, staged, modelRef, busy }) {
  const tabs = [
    { id: "live", icon: Camera, label: "Your room" },
    { id: "3d", icon: Box, label: "3D model", disabled: !build },
    { id: "staged", icon: Wand2, label: "Placed in room", disabled: !staged },
  ];
  return (
    <section className="viewer-card" aria-label="Your room">
      <div className="viewer-toolbar">
        <div className="view-tabs" role="group" aria-label="View">
          {tabs.map(({ id, icon: Icon, label, disabled }) => (
            <button key={id} type="button" disabled={disabled} className={tab === id ? "active" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button" onClick={cameraOn ? stopCamera : startCamera} title={cameraOn ? "Turn camera off" : "Turn camera on"}>
          {cameraOn ? <CameraOff size={17} /> : <Camera size={17} />}
        </button>
      </div>
      <div className="stage home-stage">
        <video ref={videoRef} className={tab === "staged" ? "cam hidden" : "cam"} playsInline muted autoPlay />
        {!cameraOn && tab === "live" && (
          <div className="cam-empty">
            <button type="button" className="talk-button" onClick={startCamera}><Camera size={16} /> Turn on camera</button>
            <p>Point it at the space you want to furnish.</p>
          </div>
        )}
        {build && (tab === "3d" || tab === "live") && (
          <ModelView ref={modelRef} model={build.model} overlay={tab === "live" && cameraOn} spin={tab === "3d"} />
        )}
        {tab === "staged" && staged && <img className="staged" src={staged.image} alt={`Preview of ${staged.product.title} in your room`} />}
        {build && tab !== "staged" && (
          <div className="dims-tag">
            <Ruler size={14} /> {build.product.title} · {cm(build.dims.w)} W × {cm(build.dims.d)} D × {cm(build.dims.h)} H
            <span> ({inches(build.dims.w)} × {inches(build.dims.d)} × {inches(build.dims.h)})</span>
          </div>
        )}
        {tab === "staged" && <div className="dims-tag"><Wand2 size={14} /> Preview drawn by the image model. Not an exact likeness.</div>}
        {busy && <div className="busy-tag"><span className="spinner" /> {busy}</div>}
      </div>
      <div className="viewer-footer">
        {build ? <Steps build={build} critique={critique} />
          : <p className="viewer-note"><CircleDot size={16} /> Ellie sees what your camera sees, finds real products on Shopify, and builds each one in 3D at true size.</p>}
      </div>
    </section>
  );
}

function Guide({ messages, partial, pending, status, error, setError, ask, startVoice, stopVoice }) {
  const [input, setInput] = useState("");
  const thread = useRef(null);
  const active = ["connecting", "listening", "thinking", "speaking"].includes(status);
  const statusText = { idle: "Ready", connecting: "Connecting", listening: "Listening", thinking: "Working", speaking: "Speaking" }[status];
  useEffect(() => { thread.current.scrollTop = thread.current.scrollHeight; }, [messages, partial, pending]);
  function submit(event) {
    event.preventDefault();
    if (!input.trim() || pending) return;
    ask(input.trim());
    setInput("");
  }
  return (
    <aside className="guide-card" aria-label="Ellie">
      <div className="guide-head">
        <span className="guide-icon"><AudioLines size={23} strokeWidth={1.75} /></span>
        <div><h2>Ellie</h2><p><span className={active ? "guide-dot active" : "guide-dot"} />{statusText}</p></div>
        <button type="button" className={active ? "talk-button live" : "talk-button"} onClick={active ? stopVoice : startVoice}>
          {active ? <Square size={13} /> : <Mic size={15} />}{active ? "End call" : "Talk live"}
        </button>
      </div>
      <div className="guide-thread" ref={thread} role="log" aria-live="polite">
        <div className="bubble assistant">Hi, I'm Ellie. Show me your room and tell me what you're looking for. I'll find real pieces that fit, show them to you in 3D, and get them in your cart.</div>
        {messages.map(({ id, role, text }) => <div className={`bubble ${role}`} key={id}>{text}</div>)}
        {partial && <div className="bubble assistant">{partial}</div>}
        {pending && <div className="bubble assistant pending"><span /><span /><span /></div>}
        {!messages.length && !pending && (
          <div className="prompt-list">
            {prompts.map(({ icon: Icon, text }) => (
              <button type="button" key={text} onClick={() => ask(text)}><Icon size={15} /> <span>{text}</span> <ChevronRight size={14} /></button>
            ))}
          </div>
        )}
      </div>
      {error && <div className="guide-error" role="alert">{error} <button type="button" onClick={() => setError("")} aria-label="Dismiss">×</button></div>}
      <form className="guide-compose" onSubmit={submit}>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask Ellie…" maxLength={500} aria-label="Ask Ellie" />
        <button type="submit" aria-label="Send" disabled={!input.trim() || pending}><ArrowUp size={19} /></button>
      </form>
    </aside>
  );
}

function FitBadge({ fit, dims }) {
  if (!fit || fit.fits === "unknown") return <span className="fit unknown">{dims?.w ? "Fit not checked yet" : "Size unlisted"}</span>;
  return <span className={`fit ${fit.fits}`} title={fit.note}>{fit.fits === "yes" ? `Fits · ${fit.margin_cm} cm spare` : "Too wide"}</span>;
}

function Products({ products, room, run, cart }) {
  if (!products.length) return null;
  return (
    <section className="stops-section">
      <div className="stops-heading">
        <h2>From real Shopify stores{room ? <small> · ranked for your {room.style?.toLowerCase()} {room.room_type?.toLowerCase()}</small> : null}</h2>
      </div>
      <div className="product-list">
        {products.map(p => (
          <article key={p.id} className="product-card">
            <img src={p.image ? `${p.image}${p.image.includes("?") ? "&" : "?"}width=480` : ""} alt="" loading="lazy" />
            <div className="product-body">
              <p className="product-store">{p.storeName}</p>
              <h3>{p.title}</h3>
              <p className="product-meta"><b>{money(p.price)}</b>{p.listingDims?.w ? ` · ${cm(p.listingDims.w)} wide` : ""}</p>
              <FitBadge fit={p.fit} dims={p.listingDims} />
              {p.reason && <p className="product-reason">{p.reason}</p>}
              <div className="product-actions">
                <button type="button" onClick={() => run("show_in_3d", { product_id: p.id })}><Box size={14} /> 3D</button>
                <button type="button" onClick={() => run("place_in_room", { product_id: p.id })}><Wand2 size={14} /> Place</button>
                <button type="button" className="primary" onClick={() => run("add_to_cart", { product_id: p.id })}>
                  {cart.some(c => c.productId === p.id) ? <Check size={14} /> : <ShoppingBag size={14} />} Add
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Activity({ trace }) {
  if (!trace.length) return null;
  return (
    <section className="activity">
      <h2>What each Gemini model did</h2>
      <ul>
        {trace.slice(-8).reverse().map(t => (
          <li key={t.at + t.job}>
            <span className={`role role-${t.role}`}>{ROLE_LABEL[t.role] ?? t.role}</span>
            <span className="job">{t.job}</span>
            <span className="model-id">{t.model}</span>
            <span className={t.ok ? "ms" : "ms bad"}>{t.ok ? `${(t.ms / 1000).toFixed(1)}s` : "failed"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function App() {
  const [status, setStatus] = useState(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [tab, setTab] = useState("live");
  const [room, setRoom] = useState(null);
  const [products, setProducts] = useState([]);
  const [build, setBuild] = useState(null);
  const [critique, setCritique] = useState(null);
  const [staged, setStaged] = useState(null);
  const [cart, setCart] = useState([]);
  const [checkouts, setCheckouts] = useState(null);
  const [busy, setBusy] = useState("");
  const [messages, setMessages] = useState([]);
  const [partial, setPartial] = useState("");
  const [pending, setPending] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [error, setError] = useState("");
  const [trace, setTrace] = useState([]);
  const videoRef = useRef(null);
  const modelRef = useRef(null);
  const canvas = useRef(null);
  const live = useRef(null);
  const liveAbort = useRef(null);
  const contents = useRef([]);
  const state = useRef({});
  state.current = { room, products, cart, build };
  const heardUser = useRef("");

  useEffect(() => {
    if (import.meta.env.DEV) window.__ellie = { setBuild, setProducts, setTab, run };
  });

  useEffect(() => {
    api("/api/status").then(setStatus).catch(() => {});
    const timer = setInterval(() => api("/api/trace").then(d => setTrace(d.trace)).catch(() => {}), 2500);
    return () => clearInterval(timer);
  }, []);

  const add = (role, text) => text?.trim() && setMessages(m => [...m.slice(-39), { id: crypto.randomUUID(), role, text: text.trim() }]);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } });
      videoRef.current.srcObject = stream;
      setCameraOn(true);
      setTab("live");
    } catch {
      setError("Allow camera access so Ellie can see your room.");
    }
  }
  function stopCamera() {
    videoRef.current?.srcObject?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }

  function grabFrame(width = 1024, quality = 0.82) {
    const video = videoRef.current;
    if (!video?.videoWidth) return null;
    canvas.current ??= document.createElement("canvas");
    const c = canvas.current;
    c.width = width;
    c.height = Math.round((video.videoHeight / video.videoWidth) * width);
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality).split(",")[1];
  }

  const findProduct = id => state.current.products.find(p => p.id === id);

  async function visualCheck(result) {
    await new Promise(r => setTimeout(r, 900));
    const render = modelRef.current?.snapshot();
    if (!render) return null;
    try {
      const out = await api("/api/critique", { productId: result.product.id, render, model: result.model });
      setCritique(out.critique);
      if (out.model) setBuild(b => (b?.product.id === result.product.id
        ? { ...b, model: out.model, steps: [...b.steps, { step: "visual repair", detail: out.critique.issues.slice(0, 3).join("; ") }] } : b));
      return out.critique;
    } catch { return null; }
  }

  // Every tool runs here, whether Gemini Live or the typed chat asked for it.
  async function run(name, args = {}) {
    try {
      switch (name) {
        case "look_at_room": {
          const frame = grabFrame();
          if (!frame) return { error: "The camera is off. Ask the shopper to turn it on." };
          setBusy("Reading your room…");
          const scan = await api("/api/scan", { frame, goal: args.goal });
          setRoom(scan);
          return scan;
        }
        case "find_products": {
          setBusy(`Searching Shopify for “${args.query}”…`);
          const out = await api("/api/products", { ...args, room: state.current.room });
          setProducts(out.products);
          return {
            space_used: out.space,
            products: out.products.map(p => ({ id: p.id, title: p.title, store: p.storeName, price: p.price,
              size_cm: p.listingDims ? { w: p.listingDims.w, d: p.listingDims.d, h: p.listingDims.h } : "not listed",
              fits: p.fit.fits, fit_note: p.fit.note, why: p.reason })),
          };
        }
        case "show_in_3d": {
          const product = findProduct(args.product_id);
          setBusy(`Building ${product?.title ?? "it"} in 3D…`);
          const result = await api("/api/model3d", { productId: args.product_id });
          setCritique(null);
          setBuild(result);
          setTab(cameraOn ? "live" : "3d");
          visualCheck(result);
          return { shown: result.product.title, size_cm: result.dims, size_source: result.dims.source,
            checks_passed_first_try: result.checks.first.ok, repairs: result.steps.filter(s => s.step.startsWith("repair")).length };
        }
        case "place_in_room": {
          const frame = grabFrame(1280, 0.9);
          if (!frame) return { error: "The camera is off." };
          setBusy("Placing it in your room…");
          const out = await api("/api/stage", { frame, productId: args.product_id, where: args.where });
          setStaged(out);
          setTab("staged");
          return { placed: out.product.title, note: "Preview shown on screen." };
        }
        // Commerce is owned by Rucha: see src/commerce/ and docs/TEAM-PLAN.md.
        case "add_to_cart": {
          const item = await makeCartItem(findProduct(args.product_id) ?? args.product_id, args.quantity);
          setCart(c => [...c.filter(x => x.productId !== item.productId), item]);
          return { added: item.title, variant: item.variantTitle, quantity: item.quantity };
        }
        case "checkout": {
          const items = state.current.cart;
          if (!items.length) return { error: "The cart is empty." };
          setBusy("Building your Shopify checkout…");
          const out = await startCheckout(items);
          setCheckouts(out.checkouts);
          return { stores: out.checkouts.map(c => ({ store: c.storeName, total: c.total })), note: "Checkout is on screen; the shopper confirms and pays there." };
        }
        default:
          return { error: `Unknown tool ${name}.` };
      }
    } catch (problem) {
      setError(problem.message);
      return { error: problem.message };
    } finally {
      setBusy("");
    }
  }

  async function ask(text) {
    setError("");
    add("user", text);
    if (live.current) {
      live.current.say(text);
      return;
    }
    setPending(true);
    try {
      contents.current.push({ role: "user", parts: [{ text }] });
      for (let step = 0; step < 6; step += 1) {
        const turn = await api("/api/turn", { contents: contents.current });
        contents.current.push(turn.content);
        if (turn.text) add("assistant", turn.text);
        if (!turn.functionCalls.length) break;
        const parts = [];
        for (const call of turn.functionCalls) {
          const output = await run(call.name, call.args ?? {});
          parts.push({ functionResponse: { name: call.name, response: { output } } });
        }
        contents.current.push({ role: "user", parts });
      }
    } catch (problem) {
      setError(problem.message);
    } finally {
      setPending(false);
    }
  }

  async function startVoice() {
    if (live.current) return;
    if (!cameraOn) await startCamera();
    const abort = new AbortController();
    liveAbort.current = abort;
    setVoiceStatus("connecting");
    setError("");
    try {
      live.current = await connectLive({
        signal: abort.signal, grabFrame, onTool: run,
        onEvent(event) {
          switch (event.type) {
            case "speaking": setVoiceStatus("speaking"); break;
            case "listening": setVoiceStatus("listening"); break;
            case "thinking": setVoiceStatus("thinking"); break;
            case "user-text": heardUser.current += event.text; break;
            case "ellie-text":
              if (heardUser.current) { add("user", heardUser.current); heardUser.current = ""; }
              setPartial(p => p + event.text);
              break;
            case "turn-complete":
              setPartial(p => { add("assistant", p); return ""; });
              break;
            case "error": setError(event.message); break;
            case "closed": stopVoice(); setError("The live call ended. Tap Talk live to reconnect."); break;
            default: break;
          }
        },
      });
      setVoiceStatus("listening");
      live.current.say("Hi Ellie! I'm showing you my room now.");
    } catch (problem) {
      stopVoice();
      setError(problem.name === "NotAllowedError" ? "Allow the microphone to talk to Ellie." : problem.message);
    }
  }
  function stopVoice() {
    liveAbort.current?.abort();
    liveAbort.current = null;
    live.current = null;
    setVoiceStatus("idle");
    setPartial("");
  }

  return (
    <>
      <Header status={status} />
      <main className="wrap">
        <header className="property-head">
          <div>
            <p className="eyebrow"><span /> SHOP YOUR ROOM ON A VIDEO CALL</p>
            <h1>See it in your room, true to size, before you buy.</h1>
          </div>
        </header>
        <div className="workbench">
          <StageCard videoRef={videoRef} cameraOn={cameraOn} startCamera={startCamera} stopCamera={stopCamera}
            tab={tab} setTab={setTab} build={build} critique={critique} staged={staged} modelRef={modelRef} busy={busy} />
          <Guide messages={messages} partial={partial} pending={pending} status={voiceStatus} error={error} setError={setError}
            ask={ask} startVoice={startVoice} stopVoice={stopVoice} />
        </div>
        <CartBar cart={cart} setCart={setCart} checkouts={checkouts} setCheckouts={setCheckouts} run={run} />
        <Products products={products} room={room} run={run} cart={cart} />
        <Activity trace={trace} />
        <footer className="source-footer">
          <div><span>Products</span> Shopify storefronts <b>·</b> <span>Models</span> Gemini 4 <b>·</b> <span>Built on</span> Ellie (facetime-open-house)</div>
        </footer>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
