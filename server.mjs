// server.mjs — self-hosted backend for the Taskmarket live market visualizer.
// One command:  node server.mjs   (fetches data server-side, caches, serves).
// Pure Node stdlib — no dependencies. Serves the static dashboard and the data
// snapshot, refetching from the public API every 15 minutes (>= the hourly
// requirement) and caching responses for 60 seconds.

import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectSnapshot } from "./fetch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const REFRESH_MS = 15 * 60 * 1000; // 15 minutes

let snapshot = null;
let lastFetchAt = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

async function refresh() {
  try {
    snapshot = await collectSnapshot();
    lastFetchAt = new Date().toISOString();
    // Also persist so the repo/static hosting has the latest data.
    await mkdir(join(HERE, "data"), { recursive: true });
    await writeFile(join(HERE, "data", "snapshot.json"), JSON.stringify(snapshot));
    console.log(`[${lastFetchAt}] snapshot refreshed`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] refresh failed: ${e.message}`);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, lastFetchAt, fetchedAt: snapshot && snapshot.fetchedAt }));
    return;
  }

  if (pathname === "/data/snapshot.json") {
    if (!snapshot) { res.writeHead(503, { "Content-Type": "application/json" }); res.end('{"error":"not ready"}'); return; }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" });
    res.end(JSON.stringify(snapshot));
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  // Prevent path traversal: resolve within HERE.
  const file = normalize(join(HERE, pathname));
  if (!file.startsWith(HERE)) { res.writeHead(403); res.end("forbidden"); return; }

  try {
    const body = await readFile(file);
    const ext = extname(file).toLowerCase();
    const cache = ext === ".html" ? "no-cache" : "public, max-age=3600";
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": cache });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
});

await refresh();
server.listen(PORT, () => console.log(`serving on http://localhost:${PORT}`));
setInterval(refresh, REFRESH_MS).unref();
