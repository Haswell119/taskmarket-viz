/* app.js — Taskmarket live market visualizer frontend.
   Loads data/snapshot.json (written server-side by fetch.mjs) and renders
   every view with hand-rolled SVG. No external libraries. */

"use strict";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let DATA = null;
const state = { chain: "8453", range: "30d" };

/* ---------- formatting ---------- */
const usdcMicro = (s) => (s == null ? 0 : Number(s) / 1e6);
const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
const fmtUsd = (n) => {
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  if (n >= 100) return "$" + Math.round(n);
  return "$" + (Math.round(n * 100) / 100);
};
const fmtCompact = (n) => {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return Math.round(n).toString();
};
const dayLabel = (iso) => {
  const d = new Date(iso + "T00:00:00Z");
  return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
};
const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return Math.round(s) + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
};
const escapeHtml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

/* ---------- tiny SVG chart helpers ---------- */
function lineChart(el, buckets, series, opts = {}) {
  const W = 940, H = 260, padL = 58, padR = opts.rightAxis ? 58 : 18, padT = 14, padB = 30;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  // values for each series
  const vals = series.map((s) => buckets.map((b) => s.value(b)));
  let yMax = 0, yMaxR = 0;
  series.forEach((s, i) => {
    const m = Math.max(0, ...vals[i]);
    if (s.axis === "right") yMaxR = Math.max(yMaxR, m);
    else yMax = Math.max(yMax, m);
  });
  if (yMax === 0) yMax = 1;
  if (yMaxR === 0) yMaxR = 1;

  const x = (i) => padL + (buckets.length === 1 ? innerW / 2 : (i / (buckets.length - 1)) * innerW);
  const yL = (v) => padT + innerH - (v / yMax) * innerH;
  const yR = (v) => padT + innerH - (v / yMaxR) * innerH;

  // grid + axis
  let g = "";
  const gridLines = 4;
  for (let k = 0; k <= gridLines; k++) {
    const gy = padT + (k / gridLines) * innerH;
    g += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="var(--line)" stroke-opacity="0.45"/>`;
  }
  const yTicks = [];
  for (let k = 0; k <= gridLines; k++) {
    yTicks.push(yMax - (k / gridLines) * yMax);
  }
  const tickFmt = opts.tickFmt || fmtCompact;

  let axisText = yTicks.map((t, k) => {
    const gy = padT + (k / gridLines) * innerH;
    return `<text x="${padL - 8}" y="${gy + 4}" text-anchor="end" class="axis">${tickFmt(t)}</text>`;
  }).join("");

  let rightAxisText = "";
  if (opts.rightAxis) {
    const rTicks = [];
    for (let k = 0; k <= gridLines; k++) rTicks.push(yMaxR - (k / gridLines) * yMaxR);
    rightAxisText = rTicks.map((t, k) => {
      const gy = padT + (k / gridLines) * innerH;
      return `<text x="${W - padR + 8}" y="${gy + 4}" class="axis">${opts.tickFmtR ? opts.tickFmtR(t) : fmtCompact(t)}</text>`;
    }).join("");
  }

  // x labels (thin out if dense)
  const maxLabels = Math.floor(innerW / 62);
  const step = Math.max(1, Math.ceil(buckets.length / maxLabels));
  let xText = "";
  buckets.forEach((b, i) => {
    if (i % step !== 0 && i !== buckets.length - 1) return;
    xText += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="axis">${dayLabel(b.bucket)}</text>`;
  });

  // series paths
  let paths = "";
  series.forEach((s, si) => {
    const pts = vals[si].map((v, i) => [x(i), s.axis === "right" ? yR(v) : yL(v)]);
    if (s.type === "area") {
      const area = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ") +
        ` L${pts[pts.length - 1][0].toFixed(1)},${(padT + innerH)} L${pts[0][0].toFixed(1)},${(padT + innerH)} Z`;
      paths += `<path d="${area}" fill="${s.color}" fill-opacity="${s.opacity || 0.22}"/>`;
    }
    if (s.type === "line" || s.line !== false) {
      const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
      paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>`;
    }
  });

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
    ${g}
    ${axisText}${rightAxisText}${xText}
    ${paths}
  </svg>`;

  // legend
  const legendEl = el.parentElement.querySelector(".legend");
  if (legendEl) {
    legendEl.innerHTML = series.map((s) =>
      `<span><span class="sw" style="background:${s.color}"></span>${s.label}</span>`
    ).join("");
  }
}

function barChart(el, items, opts = {}) {
  // items: [{label, value, color}]
  const W = 940, H = 220, padL = 40, padR = 44, padT = 12, padB = 30;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const max = Math.max(1, ...items.map((i) => i.value));
  const bw = innerW / items.length;
  const barW = Math.min(46, bw * 0.66);

  let bars = "";
  items.forEach((it, i) => {
    const h = (it.value / max) * innerH;
    const bx = padL + i * bw + (bw - barW) / 2;
    const by = padT + innerH - h;
    bars += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${it.color || "var(--salmon)"}">
      <title>${it.label}: ${it.value}</title></rect>`;
    bars += `<text x="${(bx + barW / 2).toFixed(1)}" y="${by - 6}" text-anchor="middle" class="axis">${fmtCompact(it.value)}</text>`;
    bars += `<text x="${(bx + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="axis">${it.label}</text>`;
  });

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">${bars}</svg>`;
}

/* ---------- render ---------- */
function chain() { return DATA.chains[state.chain]; }

function renderHeadline() {
  const s = chain().stats;
  const sym = chain().symbol;
  const cards = [
    ["Registered workers", s.registeredWorkers, ""],
    ["Active workers · 7d", s.activeWorkers7d, ""],
    ["Active agents · 7d", s.activeAgents7d, ""],
    ["Open tasks", s.openTasks, ""],
    ["Paid workers", s.paidWorkers, ""],
    ["Active wallets", s.activeWallets, ""],
  ];
  document.getElementById("headline-stats").innerHTML = cards.map(([l, v, u]) =>
    `<div class="stat"><div class="label">${l}</div><div class="value">${fmtInt(v)}</div>${u ? `<div class="unit">${u}</div>` : ""}</div>`
  ).join("");
}

function renderInsights() {
  const c = chain();
  const ts = c.timeSeries[state.range] || [];
  const putUp = ts.reduce((a, b) => a + usdcMicro(b.rewardVolume), 0);
  const paid = ts.reduce((a, b) => a + usdcMicro(b.paidVolume), 0);
  const paidShare = putUp > 0 ? paid / putUp : 0;

  const status = c.breakdowns.status || [];
  const sc = (k) => (status.find((x) => x.status === k) || {}).count || 0;
  const completed = sc("completed"), cancelled = sc("cancelled"), expired = sc("expired");
  const dead = cancelled + expired;
  const deadShare = completed + dead > 0 ? dead / (completed + dead) : 0;

  const topShare = c.tasks.topPosterShare || 0;
  const sym = chain().symbol;

  document.getElementById("insights").innerHTML = [
    {
      k: `Reward put up vs paid · ${state.range}`,
      v: `${fmtUsd(putUp)} / ${fmtUsd(paid)}`,
      d: paidShare >= 0.6
        ? `${Math.round(paidShare * 100)}% of reward put up in this window has been paid out to winners.`
        : `${Math.round((1 - paidShare) * 100)}% of reward put up in this window has not yet been paid out.`,
    },
    {
      k: "Posting concentration",
      v: `${Math.round(topShare * 100)}%`,
      d: `${c.tasks.topPosterTasks} of ${c.tasks.taskCount} tasks in the sample come from the single most-active poster.`,
    },
    {
      k: "Tasks that ended without a winner",
      v: `${Math.round(deadShare * 100)}%`,
      d: `${dead.toLocaleString("en-US")} cancelled or expired vs ${completed.toLocaleString("en-US")} completed, across the board.`,
    },
    {
      k: "Distinct posters",
      v: `${c.tasks.distinctPosters}`,
      d: `Unique requester wallets in the sampled task list on ${c.name}.`,
    },
  ].map((i) => `<div class="insight"><div class="k">${i.k}</div><div class="v">${i.v}</div><div class="d">${i.d}</div></div>`).join("");
}

function renderFlow() {
  const ts = chain().timeSeries[state.range] || [];
  const sym = chain().symbol;
  lineChart(document.getElementById("flow-chart"), ts, [
    { label: "reward put up", color: "var(--salmon)", type: "area", opacity: 0.28, line: false, value: (b) => usdcMicro(b.rewardVolume) },
    { label: "reward paid out", color: "var(--paper)", type: "line", width: 2, value: (b) => usdcMicro(b.paidVolume) },
  ], { tickFmt: (n) => fmtUsd(n) });

  // Flow strip: the total put up in this window, and where it went.
  const putUp = ts.reduce((a, b) => a + usdcMicro(b.rewardVolume), 0);
  const paid = ts.reduce((a, b) => a + usdcMicro(b.paidVolume), 0);
  const held = Math.max(0, putUp - paid);
  const pct = putUp > 0 ? paid / putUp : 0;
  document.getElementById("flow-strip").innerHTML = `
    <div class="fnode in"><div class="flabel">posters put up</div><div class="fval">${fmtUsd(putUp)}</div></div>
    <div class="farrow">→</div>
    <div class="fnode mid"><div class="flabel">escrow</div><div class="fval">${fmtUsd(held)} still held</div></div>
    <div class="farrow">→</div>
    <div class="fnode out"><div class="flabel">paid to winners</div><div class="fval">${fmtUsd(paid)}</div></div>
    <div class="fnote">${Math.round(pct * 100)}% of ${sym} put up in this window reached a winner; the rest is still in escrow or was refunded.</div>`;
}

function renderActivity() {
  const ts = chain().timeSeries[state.range] || [];
  lineChart(document.getElementById("activity-chart"), ts, [
    { label: "tasks posted", color: "var(--cream)", type: "line", width: 2, value: (b) => b.tasksCreated || 0 },
    { label: "active agents", color: "var(--muted)", type: "line", width: 1.5, dash: "4 3", value: (b) => b.activeAgents || 0 },
  ]);
}

function renderBreakdowns() {
  const b = chain().breakdowns;
  const modeOrder = ["bounty", "claim", "pitch", "benchmark", "auction"];
  const modes = modeOrder.map((m) => {
    const row = (b.mode || []).find((x) => x.mode === m);
    return { label: m, value: row ? row.count : 0 };
  });
  const maxMode = Math.max(1, ...modes.map((m) => m.value));

  document.getElementById("mode-breakdown").innerHTML =
    `<h3 class="note" style="font-family:var(--body);color:var(--cream);font-size:15px;margin-bottom:10px">By mode</h3>` +
    modes.map((m) => `
      <div class="bar-row">
        <span class="bname">${m.label}</span>
        <span class="track"><span class="fill" style="width:${(m.value / maxMode) * 100}%"></span></span>
        <span class="bval">${fmtInt(m.value)}</span>
      </div>`).join("");

  const statuses = (b.status || []).slice().sort((a, b2) => b2.count - a.count);
  const maxStatus = Math.max(1, ...statuses.map((s) => s.count));
  document.getElementById("status-breakdown").innerHTML =
    `<h3 class="note" style="font-family:var(--body);color:var(--cream);font-size:15px;margin-bottom:10px">By status</h3>` +
    statuses.map((s) => `
      <div class="bar-row">
        <span class="bname">${s.status.replace(/_/g, " ")}</span>
        <span class="track"><span class="fill" style="width:${(s.count / maxStatus) * 100}%;background:var(--muted)"></span></span>
        <span class="bval">${fmtInt(s.count)}</span>
      </div>`).join("");
}

function renderHeatmap() {
  const hm = chain().heatmap.hourOfWeek;
  const el = document.getElementById("heatmap");
  if (!hm || !hm.cells) { el.innerHTML = `<p class="note">No heatmap data.</p>`; return; }

  const max = hm.maxCount || Math.max(1, ...hm.cells.map((c) => c.count));
  const cell = new Map(hm.cells.map((c) => [c.row + ":" + c.col, c.count]));
  const rows = hm.rowKeys, cols = hm.colKeys;

  let grid = `<div class="heatmap" style="grid-template-columns:auto repeat(${cols.length},1fr);min-width:${cols.length * 15 + 40}px">`;
  grid += `<div class="rowlabel"></div>` + cols.map((c) => `<div class="collabel" style="text-align:center">${c % 6 === 0 ? c : ""}</div>`).join("");
  rows.forEach((r) => {
    grid += `<div class="rowlabel">${DAYS[Number(r)]}</div>`;
    cols.forEach((c) => {
      const v = cell.get(r + ":" + c) || 0;
      const t = v / max;
      // warm ramp: panel -> salmon (brand colours only)
      const color = t === 0 ? "var(--panel)" : `rgba(217,160,151,${(0.12 + 0.88 * t).toFixed(2)})`;
      grid += `<div class="cell" style="background:${color}" title="${DAYS[Number(r)]} ${c}:00 — ${v}"></div>`;
    });
  });
  grid += `</div>`;
  el.innerHTML = grid;
}

function renderPosters() {
  const pw = chain().tasks.postersByWeek || [];
  // show last ~20 weeks
  const items = pw.slice(-20).map((p) => ({ label: dayLabel(p.week), value: p.distinctPosters }));
  barChart(document.getElementById("posters-chart"), items);
}

function renderSwarm() {
  const tc = chain().tasks.topContested || [];
  const el = document.getElementById("swarm");
  if (!tc.length) { el.innerHTML = `<p class="note">No open tasks with submissions in the sample.</p>`; return; }
  const max = Math.max(1, ...tc.map((t) => t.submissionCount));
  el.innerHTML = tc.map((t) => `
    <div class="swarm-row">
      <div class="swarm-head">
        <span class="swarm-ref">${escapeHtml(t.ref)}</span>
        <span class="swarm-title">${escapeHtml(t.title)}</span>
        <span class="swarm-reward">${fmtUsd(t.reward)}</span>
      </div>
      <div class="swarm-bar">
        <div class="swarm-fill" style="width:${Math.max(2, (t.submissionCount / max) * 100)}%"></div>
        <span class="swarm-count">${fmtInt(t.submissionCount)} submissions · ${escapeHtml(t.mode)}</span>
      </div>
    </div>`).join("");
}

function renderFeed() {
  const items = (chain().feed && chain().feed.items) || [];
  const el = document.getElementById("feed");
  if (!items.length) { el.innerHTML = `<li class="note">No recent activity.</li>`; return; }
  el.innerHTML = items.map((it) => {
    const kind = (it.type || "").replace("task_", "");
    const title = (it.taskTitle || "").slice(0, 90);
    const chainName = String(it.chainId) === "8453" ? "Base" : "Tempo";
    return `<li>
      <span class="kind">${kind}</span>
      <span class="txt">${title} <span class="mono" style="color:var(--muted)">· ${chainName}</span></span>
      <span class="t">${timeAgo(it.timestamp)}</span>
    </li>`;
  }).join("");
}

function renderMethods() {
  const c = chain();
  const f = DATA.fetchedAt;
  document.getElementById("methods").innerHTML = `
    Methods — data read server-side from the public Taskmarket API (no key):
    <code>/api/market/stats</code>, <code>/api/stats/breakdowns</code>,
    <code>/api/stats/platform-time-series</code>, <code>/api/stats/activity-heatmap</code>,
    <code>/api/stats/activity-feed</code>, <code>/api/tasks</code>, for chainId 8453 (Base) and 4217 (Tempo).
    Refreshed and cached at least hourly; every figure reproduces from the API as of
    <code>${f}</code>. Distinct posters per week is computed from the task list (requester wallets, by week).
  `;
}

function render() {
  const c = chain();
  document.getElementById("asof").textContent = "data as of " + DATA.fetchedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC");
  document.getElementById("chain-toggle").querySelectorAll("button").forEach((b) => {
    const on = b.dataset.chain === state.chain;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.getElementById("range-switch").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.range === state.range);
  });
  renderHeadline();
  renderInsights();
  renderFlow();
  renderActivity();
  renderBreakdowns();
  renderHeatmap();
  renderPosters();
  renderSwarm();
  renderFeed();
  renderMethods();
}

/* ---------- boot ---------- */
document.getElementById("chain-toggle").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.chain = btn.dataset.chain;
  render();
});
document.getElementById("range-switch").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.range = btn.dataset.range;
  renderFlow();
  renderActivity();
  renderInsights();
});

fetch("data/snapshot.json", { cache: "no-store" })
  .then((r) => { if (!r.ok) throw new Error("snapshot HTTP " + r.status); return r.json(); })
  .then((d) => { DATA = d; render(); })
  .catch((err) => {
    document.querySelector(".wrap").innerHTML =
      `<h1>The market for paid work, <em>measured.</em></h1>
       <p class="sub">Could not load the data snapshot: ${err.message}. Run <span class="mono">node fetch.mjs</span> to generate it.</p>`;
  });
