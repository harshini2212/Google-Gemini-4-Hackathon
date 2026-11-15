import React, { useEffect, useRef, useState } from "react";
import { AudioLines, ExternalLink, MonitorUp, Video, X } from "lucide-react";

export function CallSetup({ close, openShare, devices, setDevices, start, pending }) {
  const dialog = useRef(null);
  const alive = useRef(true);
  const [choices, setChoices] = useState([]);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    alive.current = true;
    node.showModal();
    return () => {
      alive.current = false;
      node.close();
    };
  }, []);

  async function refreshDevices() {
    setChecking(true);
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try {
        const found = await navigator.mediaDevices.enumerateDevices();
        if (alive.current) setChoices(found);
      } finally {
        stream.getTracks().forEach(track => track.stop());
      }
    } catch {
      if (alive.current) setError("Allow microphone access in Chrome to select audio devices.");
    } finally {
      if (alive.current) setChecking(false);
    }
  }

  const selected = (kind, key, label) => {
    const options = choices.filter(device => device.kind === kind && device.deviceId && device.deviceId !== "default");
    return (
      <label>{label}
        <select value={devices[key]} onChange={event => setDevices({ ...devices, [key]: event.target.value })}>
          <option value="">System default</option>
          {devices[key] && !options.some(device => device.deviceId === devices[key]) &&
            <option value={devices[key]}>Previously selected device</option>}
          {options.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || "Audio device"}</option>)}
        </select>
      </label>
    );
  };

  function connect() {
    const from = choices.find(device => device.kind === "audioinput" && device.deviceId === devices.input);
    const to = choices.find(device => device.kind === "audiooutput" && device.deviceId === devices.output);
    if (from && to && (from.label === to.label || (from.groupId && from.groupId === to.groupId))) {
      setError("Choose two separate loopback devices for FaceTime audio.");
      return;
    }
    close();
    start(devices);
  }

  return (
    <dialog ref={dialog} className="call-dialog" onCancel={close} aria-labelledby="call-title">
      <div className="dialog-head">
        <span className="dialog-icon"><Video size={23} /></span>
        <button type="button" className="icon-button" onClick={close} aria-label="Close FaceTime setup"><X size={21} /></button>
      </div>
      <h2 id="call-title">Share the tour on FaceTime</h2>
      <ol className="call-steps">
        <li>Start a FaceTime call on this Mac.</li>
        <li>Open the tour window and share that window from the FaceTime menu bar.</li>
        <li>For two-way voice, select separate loopback devices for the guest and the guide.</li>
      </ol>
      <div className="dialog-actions">
        <button type="button" className="primary-button" onClick={() => { if (!openShare()) setError("Allow pop-ups to open the tour window."); }}>
          <MonitorUp size={16} /> Open tour window
        </button>
        <a href="https://support.apple.com/en-mz/guide/facetime/fctmdcf2007a/mac" target="_blank" rel="noreferrer">Apple sharing steps <ExternalLink size={13} /></a>
      </div>
      <div className="audio-setup">
        <div className="audio-setup-head">
          <strong><AudioLines size={17} /> Call audio</strong>
          <button type="button" className="text-button" disabled={checking} onClick={refreshDevices}>
            {checking ? "Checking…" : "Find audio devices"}
          </button>
        </div>
        <p>In FaceTime, set Output to the guest loopback and Microphone to the guide loopback. Match those devices below.</p>
        <div className="select-row">
          {selected("audioinput", "input", "Guest → guide")}
          {selected("audiooutput", "output", "Guide → guest")}
        </div>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button type="button" className="secondary-button" onClick={connect} disabled={pending}>Connect guide audio</button>
      </div>
    </dialog>
  );
}
