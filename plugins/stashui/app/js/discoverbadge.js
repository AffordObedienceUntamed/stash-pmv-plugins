// The badge of the Discover entry in the menu: how many new releases the performers you follow (Discover → Overview → Following) have.
// The check is the one of the plugin stashDiscover (by ufousox007): when Stash opens it asks only for the followed performers, at most
// every six hours (his "dpPollFollowed"), and keeps the number in the browser; opening the Overview corrects it.

const UNREAD = "SSD:dp:unread.v1";
const FOLLOW = "SSD:dp:follow.v1";
const MUTED = "SSD:dp:notify"; // "0" = muted (Discover → Settings)

const muted = () => {
  try {
    return localStorage.getItem(MUTED) === "0";
  } catch (e) {
    return false;
  }
};

function cached() {
  try {
    const o = JSON.parse(localStorage.getItem(UNREAD) || "null");
    return o && typeof o.n === "number" ? o.n : 0;
  } catch (e) {
    return 0;
  }
}

export function setBadge(n) {
  const v = muted() || !n ? "" : n > 99 ? "99+" : String(n);
  document.querySelectorAll('[data-count="discover"]').forEach((c) => (c.textContent = v));
  window.__discoverBadge = n;
}

const follows = () => {
  try {
    return Object.keys(((JSON.parse(localStorage.getItem(FOLLOW) || "{}") || {}).performers) || {}).length;
  } catch (e) {
    return 0;
  }
};

let started = false;
export async function startBadge() {
  if (started) return;
  started = true;
  setBadge(cached());
  window.addEventListener("ssd:unread-changed", (e) => setBadge((e && e.detail) || 0));
  window.addEventListener("ssd:notify-changed", () => setBadge(cached()));
  window.addEventListener("stash:rail-changed", () => setTimeout(() => window.__discoverBadge != null && setBadge(window.__discoverBadge), 50));
  // nobody followed: nothing to ask (and his code isn't even loaded)
  if (!follows() || muted()) return;
  try {
    const SSD = await (await import("./views/ssdpage.js")).prepare(false);
    SSD.pollFollowed(); // throttled to once in six hours inside; sets the badge through the event above
  } catch (e) {
    /* no backend / no stash-box: the cached number stays */
  }
}
