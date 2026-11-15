import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { askGuide, openVoiceSession, ProviderError } from "./openai.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const media = join(root, "data/demo");
const dist = join(root, "dist");
const port = Number(process.env.OPEN_HOUSE_PORT || 5180);
const isDev = process.argv.includes("--dev");
let vite;

function send(res, status, body, contentType) {
  res.writeHead(status, { "Content-Type": contentType, "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

async function readBody(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > max) {
      req.resume();
      throw new ProviderError(413, "The request is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

async function demo() {
  try {
    return JSON.parse(await readFile(join(media, "tour.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new ProviderError(503, "Run npm run prepare:demo to load the property data.");
  }
}

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff",
  ".webp": "image/webp" };

async function fileResponse(res, path, immutable = false) {
  try {
    const bytes = await readFile(path);
    res.setHeader("Cache-Control", immutable ? "private, max-age=31536000, immutable" : "no-cache");
    send(res, 200, bytes, types[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream");
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
    json(res, 404, { error: "File unavailable." });
  }
}

async function handle(req, res) {
  const host = req.headers.host ?? "";
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(res, 403, { error: "Use a localhost address." });
  if (req.headers.origin && req.headers.origin !== `http://${host}`) {
    return json(res, 403, { error: "Open the tour on the same localhost address." });
  }
  const pathname = new URL(req.url, `http://${host}`).pathname;
  if (req.method === "GET" && pathname === "/api/tour") return json(res, 200, await demo());
  if (req.method === "GET" && /^\/tour-media\/[a-z0-9-]+\.webp$/.test(pathname)) {
    return fileResponse(res, join(media, pathname.slice("/tour-media/".length)));
  }
  if (req.method === "POST" && pathname === "/api/ask") {
    let body;
    try {
      body = JSON.parse(await readBody(req, 20_000));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      return json(res, 400, { error: "The guide requires a JSON question." });
    }
    if (typeof body?.question !== "string" || !body.question.trim() || body.question.length > 700) {
      return json(res, 400, { error: "Enter a question up to 700 characters." });
    }
    return json(res, 200, await askGuide(await demo(), body));
  }
  if (req.method === "POST" && pathname === "/api/voice") {
    const sdp = await readBody(req, 64_000);
    if (!sdp.startsWith("v=0") || !sdp.includes("m=audio") || !sdp.includes("m=application")) {
      return json(res, 400, { error: "A microphone and valid WebRTC offer are required." });
    }
    await demo();
    res.setHeader("Cache-Control", "no-store");
    return send(res, 200, await openVoiceSession(sdp), "application/sdp");
  }
  if (pathname.startsWith("/api/") || pathname.startsWith("/tour-media/")) return json(res, 404, { error: "Unknown route." });
  if (vite) return vite.middlewares(req, res);
  if (req.method !== "GET") return json(res, 405, { error: "Method unavailable." });
  const file = resolve(dist, "." + pathname);
  if (pathname === "/") return fileResponse(res, join(dist, "index.html"));
  if (file.startsWith(dist + sep + "assets" + sep)) return fileResponse(res, file, true);
  return json(res, 404, { error: "Page unavailable." });
}

const server = createServer((req, res) => handle(req, res).catch(error => {
  if (error instanceof ProviderError) return json(res, error.status, { error: error.message });
  console.error("Request failed", error.code ?? error.name);
  return json(res, 500, { error: "The tour could not complete this request." });
}));

if (isDev) {
  const { createServer: createVite } = await import("vite");
  vite = await createVite({ root, server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
}
server.listen(port, "127.0.0.1", () => console.log(`Open House · http://localhost:${port}`));
