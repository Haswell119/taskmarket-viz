#!/usr/bin/env node
// fetch.mjs — Taskmarket live market visualizer: data pipeline.
// Fetches every public stats endpoint (both chains) SERVER-SIDE, derives a few
// extra metrics, and writes data/snapshot.json. Pure Node stdlib — no deps.
//
// Run:  node fetch.mjs            (one-shot, writes data/snapshot.json)
// The server (server.mjs) re-runs this logic on a timer for its cache.

const BASE = "https://api.taskmarket.dev";
const CHAINS = [
  { id: 8453, name: "Base", symbol: "USDC" },
  { id: 4217, name: "Tempo", symbol: "OUSD" },
];

async function get(path) {
  const res = await fetch(BASE + path, {
    headers: { "User-Agent": "taskmarket-viz/1.0 (bounty entry)" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

// micro-units (6 decimals) -> number of whole tokens
function usdc(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n / 1e6 : null;
}

async function fetchChainStats(id) {
  const [stats, breakdowns] = await Promise.all([
    get(`/api/market/stats?chainId=${id}`),
    get(`/api/stats/breakdowns?chainId=${id}`),
  ]);
  return { stats, breakdowns };
}

async function fetchTimeSeries(id) {
  // 7d/30d/90d/all x day/week -> keep 7d & 30d & 90d day + all week for range switch
  const ranges = ["7d", "30d", "90d"];
  const out = {};
  for (const r of ranges) {
    try {
      out[r] = await get(`/api/stats/platform-time-series?chainId=${id}&range=${r}&bucket=day`);
    } catch (e) {
      out[r] = null;
    }
  }
  try {
    out.all = await get(`/api/stats/platform-time-series?chainId=${id}&range=all&bucket=week`);
  } catch (e) {
    out.all = null;
  }
  return out;
}

async function fetchHeatmap(id) {
  const out = {};
  for (const dim of ["hourOfWeek", "mode"]) {
    try {
      out[dim] = await get(`/api/stats/activity-heatmap?chainId=${id}&range=30d&dimension=${dim}`);
    } catch (e) {
      out[dim] = null;
    }
  }
  return out;
}

async function fetchFeed(id, limit = 50) {
  // limit is capped at 50 by the API (validated: <=50).
  try {
    return await get(`/api/stats/activity-feed?chainId=${id}&limit=${limit}`);
  } catch (e) {
    return { items: [] };
  }
}

async function fetchTasks(id) {
  // Paginate newest-first to build the poster-per-week + concentration series.
  const tasks = [];
  let cursor = null;
  const seen = new Set();
  const MAX_PAGES = 12;
  for (let p = 0; p < MAX_PAGES; p++) {
    const q = `/api/tasks?chainId=${id}&sort=newest&limit=100` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    let d;
    try {
      d = await get(q);
    } catch (e) {
      break;
    }
    const batch = d.tasks || [];
    let added = 0;
    for (const t of batch) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        tasks.push(t);
        added++;
      }
    }
    if (!d.hasMore || !d.nextCursor || added === 0) break;
    cursor = d.nextCursor;
  }
  // Distinct posters per week (from task createdAt), anchored to the Monday of
  // each week so the buckets are stable and reproducible.
  const weekPosters = new Map(); // "YYYY-MM-DD" (Monday) -> Set(address)
  const mondayKey = (iso) => {
    const d = new Date(iso);
    const diff = (d.getUTCDay() + 6) % 7; // 0 = Monday
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
    return m.toISOString().slice(0, 10);
  };
  for (const t of tasks) {
    const created = t.createdAt;
    if (!created) continue;
    const key = mondayKey(created);
    if (!weekPosters.has(key)) weekPosters.set(key, new Set());
    if (t.requester) weekPosters.get(key).add(t.requester);
  }
  const postersByWeek = [...weekPosters.entries()]
    .map(([week, set]) => ({ week, distinctPosters: set.size }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // Posting concentration: share of tasks from the top poster in the window.
  const reqCount = new Map();
  for (const t of tasks) {
    if (t.requester) reqCount.set(t.requester, (reqCount.get(t.requester) || 0) + 1);
  }
  const sorted = [...reqCount.entries()].sort((a, b) => b[1] - a[1]);
  const totalReq = tasks.filter((t) => t.requester).length;
  const topPosterShare = totalReq && sorted.length ? sorted[0][1] / totalReq : null;
  const distinctPosters = sorted.length;

  // Most-contested open tasks: where the swarm is converging right now.
  const topContested = tasks
    .filter((t) => t.status === "open" && (t.submissionCount || 0) > 0)
    .sort((a, b) => (b.submissionCount || 0) - (a.submissionCount || 0))
    .slice(0, 8)
    .map((t) => ({
      ref: t.referenceCode,
      title: (t.title || t.referenceCode || "").slice(0, 70),
      reward: usdc(t.reward),
      submissionCount: t.submissionCount,
      mode: t.mode,
      requester: t.requester,
    }));

  return {
    taskCount: tasks.length,
    distinctPosters,
    topPosterShare,
    topPosterTasks: sorted.length ? sorted[0][1] : 0,
    postersByWeek,
    topContested,
    recentTasks: tasks.slice(0, 20).map((t) => ({
      title: (t.title || t.referenceCode || "").slice(0, 90),
      ref: t.referenceCode,
      mode: t.mode,
      chainId: t.chainId,
      reward: usdc(t.reward),
      createdAt: t.createdAt,
      status: t.status,
      submissionCount: t.submissionCount,
      requester: t.requester,
    })),
  };
}

async function collectSnapshot() {
  const out = { fetchedAt: new Date().toISOString(), chains: {} };
  for (const c of CHAINS) {
    const [s, ts, hm, feed, tasks] = await Promise.all([
      fetchChainStats(c.id),
      fetchTimeSeries(c.id),
      fetchHeatmap(c.id),
      fetchFeed(c.id),
      fetchTasks(c.id),
    ]);
    out.chains[c.id] = {
      name: c.name,
      symbol: c.symbol,
      ...s,
      timeSeries: ts,
      heatmap: hm,
      feed: feed,
      tasks: tasks,
    };
  }
  return out;
}

export { collectSnapshot };

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = here + "/data";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

// Allow running as `node fetch.mjs` from the repo root.
if (isMain) {
  mkdirSync(dataDir, { recursive: true });
  collectSnapshot()
    .then((out) => {
      writeFileSync(dataDir + "/snapshot.json", JSON.stringify(out));
      const b = out.chains["8453"];
      const t = out.chains["4217"];
      console.log(
        `fetchedAt=${out.fetchedAt}\n` +
          `  base: open=${b.stats.openTasks} paidWorkers=${b.stats.paidWorkers} tasks=${b.tasks.taskCount} posters=${b.tasks.distinctPosters}\n` +
          `  tempo: open=${t.stats.openTasks} paidWorkers=${t.stats.paidWorkers} tasks=${t.tasks.taskCount} posters=${t.tasks.distinctPosters}`
      );
    })
    .catch((e) => {
      console.error("fetch failed:", e.message);
      process.exit(1);
    });
}
