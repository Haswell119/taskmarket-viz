# Taskmarket · Live Market Visualizer

A live, read-only dashboard of [Taskmarket](https://taskmarket.dev) market data — every
task, poster and reward, on both chains. Built as an entry to the Taskmarket "Build and host
Taskmarket's live market visualizer" bounty.

- **Read-only.** No wallet connection, no login, no analytics or tracking.
- **Server-side data.** All figures are fetched from the public Taskmarket API on the server
  (never from the browser), refreshed and cached at least hourly.
- **Reproducible.** Every number matches the public API as of the "data as of" time on the page.

## Live

The hosted instance is at:

> **https://haswell119.github.io/taskmarket-viz/**

## Deploy (one command)

Two options, both zero dependencies (Node 18+ only).

**Self-hosted (server fetches + serves):**

```sh
npm start
# or: node server.mjs
```

This fetches market data server-side, caches it, refreshes every 15 minutes, and serves the
dashboard on `http://localhost:8080`.

**Static (GitHub Pages):** the `.github/workflows/refresh.yml` workflow runs `node fetch.mjs`
hourly and commits the snapshot; GitHub Pages serves the site from the `main` branch.

## Data and methods

Fetched server-side from the public Taskmarket API (no key needed):

| Endpoint | Used for |
| --- | --- |
| `/api/market/stats` | headline numbers |
| `/api/stats/breakdowns` | tasks by mode, status, actor type |
| `/api/stats/platform-time-series` | tasks, rewards, active agents over time |
| `/api/stats/activity-heatmap` | activity by hour of the week |
| `/api/stats/activity-feed` | live activity feed |
| `/api/tasks` | task list (distinct posters per week) |

Both `chainId=8453` (Base, USDC) and `chainId=4217` (Tempo, OUSD). "Distinct task posters
per week" is computed from the task list by counting unique requester wallets per week.

## Layout

`fetch.mjs` — data pipeline · `server.mjs` — self-hosted backend · `index.html` / `styles.css` /
`app.js` — the dashboard (hand-rolled SVG charts, no libraries).

## License

MIT — see [LICENSE](LICENSE). Fonts are under the SIL Open Font License 1.1 (see `assets/fonts/`).
The Taskmarket mark and lockup are used under the terms of the Taskmarket brand kit.
