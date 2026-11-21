import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chatStep, liveToken, MODELS, ProviderError, recentTrace } from "./gemini.mjs";
import { searchProducts, stores } from "./shopify.mjs";
import { commerceRoutes } from "./commerce.mjs";
import { buildModel, critiqueModel, fillSpecs, rankProducts, scanRoom, stageInRoom } from "./home.mjs";
import { homeInstructions, homeTools } from "../shared/home-tools.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

async function body(req, max = 6_000_000) {
  try {
    return JSON.parse(await readBody(req, max));
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(400, "Send a JSON body.");
  }
}

const frameOf = value => {
  const data = String(value || "").replace(/^data:image\/\w+;base64,/, "");
  if (data.length < 1000) throw new ProviderError(400, "Turn the camera on first so Ellie can see the room.");
  return data;
};

const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2", ".woff": "font/woff",
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

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

const routes = {
  "GET /api/status": async () => ({
    ready: Boolean(process.env.GEMINI_API_KEY),
    models: Object.fromEntries(Object.entries(MODELS).map(([role, id]) => [role, id()])),
    stores: stores(),
  }),
  "GET /api/trace": async () => ({ trace: recentTrace() }),
  "POST /api/live-token": async () => liveToken(),
  "POST /api/scan": async req => {
    const { frame, goal } = await body(req);
    return scanRoom({ frame: frameOf(frame), goal: String(goal || "").slice(0, 300) });
  },
  "POST /api/products": async req => {
    const { query, max_price, space_width_cm, room } = await body(req, 200_000);
    if (typeof query !== "string" || !query.trim()) throw new ProviderError(400, "Say what kind of product to look for.");
    const found = await searchProducts(query.trim().slice(0, 80), { maxPrice: Number(max_price) || undefined });
    const space = Number(space_width_cm) ? { width_cm: Number(space_width_cm) } : room?.open_spaces?.[0] ?? null;
    const pool = await fillSpecs(found.slice(0, 16));
    const ranked = await rankProducts({ products: pool, request: query, room, space });
    return { products: ranked.slice(0, 6), space, searched: stores().length };
  },
  "POST /api/model3d": async req => {
    const { productId } = await body(req, 10_000);
    return buildModel(String(productId));
  },
  "POST /api/critique": async req => {
    const { productId, render, model } = await body(req);
    return critiqueModel({ productId: String(productId), render: frameOf(render), model });
  },
  "POST /api/stage": async req => {
    const { frame, productId, where } = await body(req);
    return stageInRoom({ frame: frameOf(frame), productId: String(productId), where: String(where || "").slice(0, 200) });
  },
  // Commerce routes live in server/commerce.mjs (Shopify teammate owns them).
  ...commerceRoutes({ body }),
  "POST /api/turn": async req => {
    const { contents } = await body(req, 400_000);
    if (!Array.isArray(contents) || !contents.length) throw new ProviderError(400, "Send the conversation so far.");
    return chatStep({ contents: contents.slice(-24), system: homeInstructions, tools: homeTools });
  },
};

async function handle(req, res) {
  const host = req.headers.host ?? "";
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(res, 403, { error: "Use a localhost address." });
  if (req.headers.origin && req.headers.origin !== `http://${host}`) {
    return json(res, 403, { error: "Open Ellie on the same localhost address." });
  }
  const pathname = new URL(req.url, `http://${host}`).pathname;
  const route = routes[`${req.method} ${pathname}`];
  if (route) return json(res, 200, await route(req));
  if (pathname.startsWith("/api/")) return json(res, 404, { error: "Unknown route." });
  if (vite) return vite.middlewares(req, res);
  if (req.method !== "GET") return json(res, 405, { error: "Method unavailable." });
  const file = resolve(dist, "." + pathname);
  if (pathname === "/") return fileResponse(res, join(dist, "index.html"));
  if (file.startsWith(dist + sep + "assets" + sep)) return fileResponse(res, file, true);
  return json(res, 404, { error: "Page unavailable." });
}

const server = createServer((req, res) => handle(req, res).catch(error => {
  if (error instanceof ProviderError) return json(res, error.status, { error: error.message });
  console.error("Request failed", error.code ?? error.name, error.message);
  return json(res, 500, { error: "Ellie could not complete this request." });
}));

if (isDev) {
  const { createServer: createVite } = await import("vite");
  vite = await createVite({ root, server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
}
server.listen(port, "127.0.0.1", () => console.log(`Ellie Home · http://localhost:${port}`));
