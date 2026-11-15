import React, { useEffect, useRef } from "react";
import { Compass, MapPin, ParkingSquare, RotateCcw } from "lucide-react";
import { finishes } from "../shared/tour.mjs";
import { Panorama } from "./panorama.jsx";

function drawPlan(canvas, tour, state) {
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const density = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * density);
  canvas.height = Math.round(height * density);
  ctx.scale(density, density);
  ctx.clearRect(0, 0, width, height);
  const points = tour.rooms.flatMap(room => room.polygon);
  const lowX = Math.min(...points.map(point => point[0]));
  const highX = Math.max(...points.map(point => point[0]));
  const lowY = Math.min(...points.map(point => point[1]));
  const highY = Math.max(...points.map(point => point[1]));
  const scale = Math.min((width - 44) / (highX - lowX), (height - 56) / (highY - lowY));
  const project = (x, y) => [width / 2 + (x - (highX + lowX) / 2) * scale,
    height / 2 - (y - (highY + lowY) / 2) * scale];
  const active = tour.stops[state.stop].roomId;
  const roomLabels = Object.fromEntries(Object.values(tour.stops).map(stop => [stop.roomId, stop.label]));
  for (const room of tour.rooms) {
    ctx.beginPath();
    room.polygon.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(...project(x, y));
      else ctx.lineTo(...project(x, y));
    });
    ctx.closePath();
    ctx.fillStyle = room.id === active ? "#cbd9c2" : room.type === "Patio" ? "#e6e9de" : "#faf9f2";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#788373";
    ctx.stroke();
  }
  const sweepById = new Map(tour.sweeps.map(sweep => [sweep.id, sweep]));
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#426346";
  for (const line of state.path) {
    ctx.beginPath();
    line.forEach((id, index) => {
      const sweep = sweepById.get(id);
      if (index === 0) ctx.moveTo(...project(sweep.x, sweep.y));
      else ctx.lineTo(...project(sweep.x, sweep.y));
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const room of tour.rooms) {
    const label = roomLabels[room.id];
    if (!label) continue;
    const vertices = room.polygon.slice(0, -1);
    const [centerX, centerY] = vertices.reduce(([x, y], [px, py]) => [x + px, y + py], [0, 0]);
    const [x, y] = project(centerX / vertices.length, centerY / vertices.length);
    ctx.beginPath();
    ctx.arc(x, y, room.id === active ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = room.id === active ? "#2d5a3d" : "#657665";
    ctx.fill();
    ctx.font = `${room.id === active ? 700 : 600} ${width < 440 ? 10 : 12}px DM Sans Variable, sans-serif`;
    ctx.textAlign = "center";
    ctx.strokeStyle = "#f8f8ee";
    ctx.lineWidth = 3.2;
    ctx.strokeText(label, x, y - 9);
    ctx.fillStyle = "#233b2a";
    ctx.fillText(label, x, y - 9);
  }
}

function FloorPlan({ tour, state }) {
  const canvas = useRef(null);
  useEffect(() => {
    const node = canvas.current;
    const paint = () => drawPlan(node, tour, state);
    const observer = new ResizeObserver(paint);
    observer.observe(node);
    paint();
    return () => observer.disconnect();
  }, [tour, state]);
  return (
    <div className="floor-plan">
      <canvas ref={canvas} role="img" aria-label="Matterport room boundaries with the current room and indoor route highlighted" />
    </div>
  );
}

function SiteMap({ tour }) {
  const { image, size, anchor, parking } = tour.site;
  const deltaX = (parking[0] - anchor[0]) * size[0];
  const deltaY = (parking[1] - anchor[1]) * size[1];
  const pin = coords => ({ left: `${coords[0] * 100}%`, top: `${coords[1] * 100}%` });
  return (
    <div className="site-map">
      <div className="site-image" style={{ "--map-ratio": size[0] / size[1] }}>
        <img src={image} alt="Vexcel aerial showing the apartment roof and parking along the driveway" />
        <span className="site-line" aria-hidden="true" style={{
          ...pin(anchor), width: `${Math.hypot(deltaX, deltaY) / size[0] * 100}%`,
          rotate: `${Math.atan2(deltaY, deltaX)}rad`,
        }} />
        <span className="site-pin" style={pin(anchor)}><MapPin size={18} /><b>A5 scan</b></span>
        <span className="site-pin parking-pin" style={pin(parking)}><ParkingSquare size={19} /><b>Parking row</b></span>
      </div>
    </div>
  );
}

export function Stage({ tour, state, resetCount, reset, pose, onPose, share = false }) {
  const stop = tour.stops[state.stop];
  const interior = state.mode === "interior";
  const site = state.mode === "site";
  const styled = state.stop === "living" && state.finish !== "original";
  const capture = new Date(tour.site.capture);
  const siteSource = Number.isNaN(capture.valueOf()) ? "Vexcel aerial" :
    "Vexcel · " + capture.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const title = interior ? stop.label : site ? "Parking & arrival" : `The ${tour.floor.name} floor plan`;
  const subtitle = interior
    ? (styled ? `${finishes[state.finish].label} · fireplace wall` : stop.detail)
    : site ? `About ${tour.site.distanceFt} ft straight-line from the registered scan point`
      : `${tour.floor.scanAreaSqft} sq ft of measured indoor scan area`;
  return (
    <div className={`stage stage-${state.mode}`}>
      {interior && (
        <Panorama label={title} yaw={stop.yaw} pitch={stop.pitch} resetCount={resetCount} viewPose={pose} onPose={onPose}
          source={styled ? `/tour-media/living-${state.finish}.webp` : stop.pano}
          poster={styled ? `/tour-media/living-${state.finish}-poster.webp` : stop.poster} />
      )}
      {site && <SiteMap tour={tour} />}
      {state.mode === "plan" && <FloorPlan tour={tour} state={state} />}
      <div className="stage-top">
        <span className="stage-tag"><span />{interior ? (styled ? "Paint preview" : "Matterport · 360° scan") : site ? siteSource : "Matterport · measured layout"}</span>
        {site && <span className="map-north"><Compass size={14} /> N</span>}
      </div>
      <div className="stage-bottom">
        <div className="stage-caption"><h2>{title}</h2><p>{subtitle}</p></div>
        {interior && !share && (
          <button type="button" className="stage-reset" onClick={reset} title="Reset view" aria-label="Reset view">
            <RotateCcw size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
