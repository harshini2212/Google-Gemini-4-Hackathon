import React, { useEffect, useRef, useState } from "react";

const vertex = `#version 300 es
void main() {
  vec2 points[3] = vec2[3](vec2(-1, -1), vec2(3, -1), vec2(-1, 3));
  gl_Position = vec4(points[gl_VertexID], 0, 1);
}`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 size;
uniform vec3 pose;
uniform sampler2D panorama;
out vec4 pixel;
void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - size) / size.y * tan(pose.z / 2.0);
  float z = cos(pose.y) - uv.y * sin(pose.y);
  vec3 ray = normalize(vec3(
    uv.x * cos(pose.x) + z * sin(pose.x),
    uv.y * cos(pose.y) + sin(pose.y),
    z * cos(pose.x) - uv.x * sin(pose.x)
  ));
  vec2 sphere = vec2(0.5 + atan(ray.x, ray.z) / 6.2831853, 0.5 - asin(ray.y) / 3.14159265);
  pixel = texture(panorama, sphere);
}`;

function initRenderer(canvas) {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
  if (!gl) throw new Error("WebGL is unavailable.");
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const size = gl.getUniformLocation(program, "size");
  const pose = gl.getUniformLocation(program, "pose");
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  return {
    draw(yaw, pitch) {
      const scale = Math.min(window.devicePixelRatio || 1, 1.7);
      const width = Math.max(1, Math.round(canvas.clientWidth * scale));
      const height = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(size, width, height);
      gl.uniform3f(pose, yaw * Math.PI / 180, pitch * Math.PI / 180, Math.PI / 3);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    upload(image) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); },
    destroy() { gl.deleteTexture(texture); gl.deleteProgram(program); },
  };
}

export function Panorama({ source, poster, label, yaw, pitch, resetCount, viewPose, onPose }) {
  const canvas = useRef(null);
  const renderer = useRef(null);
  const angle = useRef({ yaw, pitch });
  const dragged = useRef(null);
  const [loaded, setLoaded] = useState("");

  useEffect(() => {
    const node = canvas.current;
    let active;
    try {
      active = initRenderer(node);
    } catch {
      return;
    }
    renderer.current = active;
    const observer = new ResizeObserver(() => active.draw(angle.current.yaw, angle.current.pitch));
    observer.observe(node);
    function lost(event) {
      event.preventDefault();
      renderer.current = null;
      setLoaded("");
    }
    node.addEventListener("webglcontextlost", lost);
    return () => {
      observer.disconnect();
      node.removeEventListener("webglcontextlost", lost);
      active.destroy();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!renderer.current) return;
    const image = new Image();
    let cancelled = false;
    image.onload = () => {
      if (cancelled || !renderer.current) return;
      renderer.current.upload(image);
      renderer.current.draw(angle.current.yaw, angle.current.pitch);
      setLoaded(source);
    };
    image.src = source;
    return () => { cancelled = true; };
  }, [source]);

  useEffect(() => {
    angle.current = { yaw, pitch };
    renderer.current?.draw(yaw, pitch);
  }, [yaw, pitch, resetCount]);

  useEffect(() => {
    if (!viewPose) return;
    angle.current = viewPose;
    renderer.current?.draw(viewPose.yaw, viewPose.pitch);
  }, [viewPose]);

  function look(nextYaw, nextPitch) {
    angle.current = { yaw: nextYaw % 360, pitch: Math.max(-70, Math.min(70, nextPitch)) };
    renderer.current?.draw(angle.current.yaw, angle.current.pitch);
    onPose?.(angle.current);
  }

  return (
    <div className="pano">
      <img src={poster} alt={label + " from the Matterport scan"} className="pano-poster" />
      <canvas
        ref={canvas}
        className={loaded === source ? "pano-live ready" : "pano-live"}
        tabIndex={loaded === source && onPose ? 0 : -1}
        aria-label={label + " panoramic view. Use arrow keys to look around."}
        onPointerDown={onPose ? event => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragged.current = { x: event.clientX, y: event.clientY };
        } : undefined}
        onPointerMove={event => {
          if (!dragged.current) return;
          const { x, y } = dragged.current;
          dragged.current = { x: event.clientX, y: event.clientY };
          look(angle.current.yaw - (event.clientX - x) * 0.19, angle.current.pitch + (event.clientY - y) * 0.19);
        }}
        onLostPointerCapture={() => { dragged.current = null; }}
        onKeyDown={event => {
          const delta = { ArrowLeft: [-7, 0], ArrowRight: [7, 0], ArrowUp: [0, 7], ArrowDown: [0, -7] }[event.key];
          if (!delta) return;
          event.preventDefault();
          look(angle.current.yaw + delta[0], angle.current.pitch + delta[1]);
        }}
      />
    </div>
  );
}
