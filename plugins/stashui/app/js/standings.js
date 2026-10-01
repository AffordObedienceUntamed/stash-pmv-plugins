// Versus standings (kept in Stash UI's plugin settings) as "best of" lists for other parts:
// the best moments (markers) for the player and the PMV Generator, the top scenes for a remix.

import { pluginConfig } from "./api.js";

let cache = null; // { at, data }
const MIN_GAMES = 3;

export async function loadStandings(force) {
  if (!force && cache && Date.now() - cache.at < 60000) return cache.data;
  let data = {};
  try {
    data = JSON.parse((await pluginConfig("stashui")).versus || "{}") || {};
  } catch (e) {
    data = cache ? cache.data : {};
  }
  cache = { at: Date.now(), data };
  best = null;
  return data;
}

// The ones that won their place: the upper quarter of those with 3+ matches → Map(id → 0..1, 1 = the best)
function topOf(rows) {
  const judged = Object.entries(rows || {}).filter(([, r]) => r[1] + r[2] >= MIN_GAMES).sort((a, b) => b[1][0] - a[1][0]);
  const n = judged.length >= 4 ? Math.ceil(judged.length / 4) : judged.filter(([, r]) => r[1] > r[2]).length;
  const out = new Map();
  judged.slice(0, n).forEach(([id], i) => out.set(id, n > 1 ? 1 - i / (n - 1) / 2 : 1));
  return out;
}

let best = null;
// Best moments – async (loads the standings), and synchronous from what's loaded already (or null)
export async function bestMarkers(force) {
  const data = await loadStandings(force);
  if (!best) best = topOf(data.marker);
  return best;
}
export const bestMarkersNow = () => (cache ? best || (best = topOf(cache.data.marker)) : null);

// Scenes by standing, best first (only judged ones) → [{ id, elo, games }]
export async function rankedScenes(limit = 60) {
  const data = await loadStandings();
  return Object.entries(data.scene || {})
    .filter(([, r]) => r[1] + r[2] >= MIN_GAMES)
    .sort((a, b) => b[1][0] - a[1][0])
    .slice(0, limit)
    .map(([id, r]) => ({ id, elo: r[0], games: r[1] + r[2] }));
}
