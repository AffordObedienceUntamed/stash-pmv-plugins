// Stash UI – app frame: router, navigation rail, overlays.

import { esc, icon, store, errorToast, fmtNum, $ } from "./ui.js";
import { t, initLang } from "./i18n.js";
import { gql, loadFolders, favoriteTagId, stats } from "./api.js";

// ---------- Routes ----------
// Base views replace the content; overlays (player, image viewer) sit on top.

const ROUTES = [
  { re: /^$/, view: "home" },
  { re: /^folders$/, view: "folder" },
  { re: /^folder\/(\d+)$/, view: "folder", keys: ["id"] },
  { re: /^scenes$/, view: "list", params: { kind: "scene" } },
  { re: /^images$/, view: "list", params: { kind: "image" } },
  { re: /^galleries$/, view: "list", params: { kind: "gallery" } },
  { re: /^gallery\/(\d+)$/, view: "gallery", keys: ["id"] },
  { re: /^tags$/, view: "tags" },
  { re: /^tag\/(\d+)$/, view: "tag", keys: ["id"] },
  { re: /^search$/, view: "search" },
  { re: /^history$/, view: "history" },
  { re: /^queue$/, view: "queue" },
  { re: /^tasks$/, view: "tasks" },
  { re: /^settings$/, view: "settings" },
  { re: /^settings\/([a-z-]+)$/, view: "settings", keys: ["section"] },
  { re: /^plugins$/, view: "plugins" },
  { re: /^extern\/([a-z-]+)$/, view: "embed", keys: ["name"] },
  { re: /^scene\/(\d+)$/, view: "player", keys: ["id"], overlay: true },
  { re: /^image\/(\d+)$/, view: "viewer", keys: ["id"], overlay: true },
];

export const app = {
  favId: null,
  base: null, // { key, cleanup }
  overlay: null,
  context: null, // list an overlay was opened from (for next/previous)
};

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs] = raw.split("?");
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) {
      const params = Object.assign({}, r.params);
      (r.keys || []).forEach((k, i) => (params[k] = m[i + 1]));
      return { path, query, view: r.view, params, overlay: !!r.overlay };
    }
  }
  return { path, query, view: "home", params: {}, overlay: false };
}

export function go(path, replace) {
  const h = "#/" + path.replace(/^#?\/?/, "");
  if (replace) {
    history.replaceState(null, "", h);
    route();
  } else if (location.hash === h) route();
  else location.hash = h; // triggers hashchange → route()
}

// Change query parameters of the current page without re-rendering (for filters/sorting)
export function setQuery(patch) {
  const r = parseHash();
  const q = Object.assign({}, r.query, patch);
  Object.keys(q).forEach((k) => (q[k] === "" || q[k] == null || q[k] === false) && delete q[k]);
  const qs = new URLSearchParams(q).toString();
  history.replaceState(null, "", "#/" + r.path + (qs ? "?" + qs : ""));
}

// Close an overlay: go back if it was opened over a page, otherwise to the home page
export function closeOverlay() {
  if (app.overlay && app.overlay.pushed) history.back();
  else go(app.base ? app.base.hash.replace(/^#\/?/, "") : "", true);
}

const loaders = {
  home: () => import("./views/home.js"),
  folder: () => import("./views/folder.js"),
  list: () => import("./views/list.js"),
  gallery: () => import("./views/gallery.js"),
  tags: () => import("./views/tags.js"),
  tag: () => import("./views/tag.js"),
  search: () => import("./views/search.js"),
  history: () => import("./views/history.js"),
  queue: () => import("./views/queue.js"),
  tasks: () => import("./views/tasks.js"),
  settings: () => import("./views/settings.js"),
  plugins: () => import("./views/plugins.js"),
  embed: () => import("./views/embed.js"),
  player: () => import("./views/player.js"),
  viewer: () => import("./views/viewer.js"),
};

const hashNow = () => (location.hash && location.hash !== "#" ? location.hash : "#/");

let routeSeq = 0;
async function route() {
  const r = parseHash();
  const seq = ++routeSeq;
  const main = document.getElementById("main");
  const overlayRoot = document.getElementById("overlay-root");

  if (r.overlay) {
    // Keep the base page; if it's missing (direct call), put the home page underneath
    if (!app.base) {
      await mountBase({ view: "home", params: {}, query: {}, path: "" }, main, seq);
      app.base.hash = "#/";
      app.base.direct = true; // closing leads to the home page instead of out of the app
    }
    if (app.overlay) {
      app.overlay.cleanup && app.overlay.cleanup();
      app.overlay.el.remove();
    }
    const el = document.createElement("div");
    el.className = "kb-overlay-host";
    overlayRoot.appendChild(el);
    const pushed = !!(app.overlay ? app.overlay.pushed : app.base && app.base.hash !== hashNow() && !app.base.direct);
    app.overlay = { el, pushed, key: r.view + r.path };
    try {
      const mod = await loaders[r.view]();
      if (seq !== routeSeq) return;
      app.overlay.cleanup = await mod.render(el, r.params, r.query, r);
    } catch (e) {
      errorToast(e, "Couldn't open");
    }
    return;
  }

  if (app.overlay) {
    app.overlay.cleanup && app.overlay.cleanup();
    app.overlay.el.remove();
    app.overlay = null;
    document.body.classList.remove("kb-noscroll");
    // Back on the same page: don't rebuild
    if (app.base && app.base.hash === hashNow()) return;
  }
  await mountBase(r, main, seq);
}

async function mountBase(r, main, seq) {
  if (app.base && app.base.cleanup) app.base.cleanup();
  app.base = { hash: hashNow(), cleanup: null };
  document.getElementById("app").classList.remove("is-rail-open");
  markRail(r);
  // Every page gets a fresh element: event handlers of the previous page (e.g. "change" on main)
  // would otherwise keep running and react to the fields of the new page.
  const fresh = main.cloneNode(false);
  main.replaceWith(fresh);
  main = fresh;
  scrollTo(0, 0);
  try {
    const mod = await loaders[r.view]();
    if (seq !== routeSeq) return;
    app.base.cleanup = await mod.render(main, r.params, r.query, r);
  } catch (e) {
    main.innerHTML = `<div class="kb-empty"><b>${t("That didn't work")}</b><p>${esc(e.message || e)}</p><a class="kb-btn" href="#/">${t("Go to the home page")}</a></div>`;
    console.error("[Stash UI]", e);
  }
}

// ---------- Navigation rail ----------

const NAV = [
  { group: null, items: [
    { href: "", label: "Start", icon: "home", match: /^$/ },
    { href: "search", label: "Search", icon: "search", match: /^search/ },
  ] },
  { group: "Library", items: [
    { href: "scenes", label: "Scenes", icon: "film", match: /^scene/, count: "scene_count" },
    { href: "images", label: "Images", icon: "image", match: /^image/, count: "image_count" },
    { href: "galleries", label: "Galleries", icon: "book", match: /^galler/, count: "gallery_count" },
    { href: "tags", label: "Tags", icon: "tag", match: /^tag/, count: "tag_count" },
  ] },
  { group: "Watch", items: [
    { href: "queue", label: "Queue", icon: "queue", match: /^queue/, count: "queue" },
    { href: "history", label: "History", icon: "history", match: /^history/ },
    { action: "storm", label: "Media Storm", icon: "bolt", plugin: "mediaStorm" },
    { action: "pmv", label: "PMV Generator", icon: "music", plugin: "pmvGenerator" },
  ] },
  { group: "Manage", items: [
    { href: "tasks", label: "Tasks", icon: "tasks", match: /^tasks/, count: "jobs" },
    { href: "settings", label: "Settings", icon: "gear", match: /^settings/ },
    { href: "plugins", label: "Plugins", icon: "plug", match: /^plugins/ },
    { href: "extern/classic", label: "Classic Stash", icon: "door", match: /^extern\/classic/ },
  ] },
];

const folderOpen = new Set(store.get("folderOpen", []));

function renderRail() {
  const rail = document.getElementById("rail");
  rail.innerHTML =
    `<a class="kb-mark" href="#/" aria-label="${t("Stash, home page")}"><span>Stash</span></a>` +
    NAV.map((g) =>
      (g.group ? `<div class="kb-rail-group">${t(g.group)}</div>` : "") +
      `<nav class="kb-nav">` +
      g.items.map((it) =>
        it.action
          ? `<button type="button" data-action="${it.action}"${it.plugin ? ` data-plugin="${it.plugin}"` : ""}>${icon(it.icon)}<span>${t(it.label)}</span></button>`
          : `<a href="#/${it.href}" data-match="${it.match.source}">${icon(it.icon)}<span>${t(it.label)}</span>${it.count ? `<span class="kb-count" data-count="${it.count}"></span>` : ""}</a>`
      ).join("") +
      `</nav>` +
      (g.group === "Library" && store.get("railFolders", true) ? `<div class="kb-rail-group">${t("Folders")}</div><div class="kb-tree" id="tree"><div class="kb-rail-foot">${t("Loading …")}</div></div>` : "")
    ).join("") +
    `<div class="kb-rail-foot" id="rail-foot"></div>`;

  rail.addEventListener("click", (e) => {
    const c = e.target.closest("[data-fold]");
    if (c) {
      e.preventDefault();
      const id = c.dataset.fold;
      folderOpen.has(id) ? folderOpen.delete(id) : folderOpen.add(id);
      store.set("folderOpen", [...folderOpen]);
      renderTree();
      return;
    }
    const a = e.target.closest("[data-action]");
    if (a) document.getElementById("app").classList.remove("is-rail-open");
    if (a && a.dataset.action === "storm") openStorm();
    if (a && a.dataset.action === "pmv") location.href = PMV_PAGE;
  });
  renderTree();
  refreshCounts();
  refreshPluginLinks();
}

// Menu entries of companion plugins (Media Storm, PMV Generator) only show when they're installed and on
const PMV_PAGE = "/plugin/pmvGenerator/assets/index.html?from=stashui"; // so its links lead back here
async function refreshPluginLinks() {
  // Matched by ID or name, ignoring case and separators – a copy installed under another folder
  // name (e.g. "MediaStorm", "media-storm") is still found
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  let on;
  try {
    const d = await gql(`query { plugins { id name enabled } }`);
    on = new Set(d.plugins.filter((p) => p.enabled).flatMap((p) => [norm(p.id), norm(p.name)]));
  } catch (e) {
    return; // unknown – leave the entries visible
  }
  document.querySelectorAll("#rail [data-plugin]").forEach((b) => (b.hidden = !on.has(norm(b.dataset.plugin))));
}
window.addEventListener("stash:plugins-changed", refreshPluginLinks);

let treeData = null;
window.addEventListener("stash:library-changed", () => {
  treeData = null;
  renderTree();
  refreshCounts();
});
async function renderTree() {
  const box = document.getElementById("tree");
  if (!box) return;
  try {
    treeData = treeData || (await loadFolders());
  } catch (e) {
    box.innerHTML = `<div class="kb-rail-foot">${t("Couldn't load folders")}</div>`;
    return;
  }
  const cur = parseHash();
  const activeId = cur.view === "folder" ? cur.params.id : null;
  // Always show a single root folder expanded
  if (treeData.roots.length === 1 && !store.get("folderOpenInit", false)) {
    folderOpen.add(treeData.roots[0].id);
    store.set("folderOpenInit", true);
    store.set("folderOpen", [...folderOpen]);
  }
  // Expand the path to the active folder automatically
  if (activeId) {
    let n = treeData.nodes.get(activeId);
    while (n && n.parent) {
      folderOpen.add(n.parent);
      n = treeData.nodes.get(n.parent);
    }
  }
  const row = (n, d) => {
    const open = folderOpen.has(n.id);
    const caret = n.kids.length
      ? `<button class="kb-tree-caret${open ? " is-open" : ""}" data-fold="${n.id}" aria-label="${open ? t("Collapse") : t("Expand")}" aria-expanded="${open}">▸</button>`
      : '<span class="kb-tree-caret"></span>';
    return (
      `<div class="kb-tree-row" style="--d:${d}">${caret}<a href="#/folder/${n.id}" class="${n.id === activeId ? "is-active" : ""}" title="${esc(n.path)}">${esc(n.name)}</a></div>` +
      (open ? n.kids.map((k) => row(k, d + 1)).join("") : "")
    );
  };
  box.innerHTML = treeData.roots.map((r) => row(r, 0)).join("");
}

function markRail(r) {
  document.querySelectorAll(".kb-nav a[data-match]").forEach((a) => {
    a.classList.toggle("is-active", new RegExp(a.dataset.match).test(r.path));
  });
  renderTree();
}

export async function refreshCounts() {
  try {
    const s = await stats();
    document.querySelectorAll("[data-count]").forEach((c) => {
      const k = c.dataset.count;
      if (k === "queue") c.textContent = (store.get("queue", []).length || "") + "";
      else if (k === "jobs") return;
      else c.textContent = s[k] != null ? fmtNum(s[k]) : "";
    });
    const foot = document.getElementById("rail-foot");
    if (foot) foot.textContent = t("{h} h of video, {gb} GB", { h: fmtNum(Math.round(s.scenes_duration / 3600)), gb: fmtNum(Math.round(s.images_size / 1e9 + s.scenes_size / 1e9)) });
  } catch (e) { /* counts are just extras */ }
}

export function setQueueCount() {
  const c = document.querySelector('[data-count="queue"]');
  if (c) c.textContent = (store.get("queue", []).length || "") + "";
}

export function setJobCount(n) {
  const c = document.querySelector('[data-count="jobs"]');
  if (c) c.textContent = n ? String(n) : "";
}

// ---------- Media Storm ----------
// Media Storm asks for the current page here (source "current page")
window.StashUIContext = () => {
  const r = parseHash();
  if (r.view === "tag") return { field: "tags", id: r.params.id };
  if (r.view === "gallery") return { field: "galleries", id: r.params.id };
  return null;
};

let stormLoaded = null;
export function openStorm() {
  if (!stormLoaded) {
    stormLoaded = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "/plugin/mediaStorm/css";
      document.head.appendChild(css);
      const s = document.createElement("script");
      s.src = "/plugin/mediaStorm/javascript";
      s.onload = resolve;
      s.onerror = () => reject(new Error(t("Media Storm is not installed")));
      document.head.appendChild(s);
    });
  }
  stormLoaded
    .then(() => window.MediaStorm && window.MediaStorm.openPanel())
    .catch((e) => errorToast(e, "Media Storm"));
}

// ---------- Start ----------

async function init() {
  // Language first: "auto" follows the interface language set in Stash
  let stashLang = "";
  try {
    stashLang = (await gql(`query { configuration { interface { language } } }`)).configuration.interface.language || "";
  } catch (e) { /* older Stash or no answer – the browser language decides */ }
  await initLang(stashLang);
  document.getElementById("rail").setAttribute("aria-label", t("Navigation"));
  document.body.insertAdjacentHTML("beforeend", `<button class="kb-btn is-icon kb-menu-btn" id="menu-btn" aria-label="${t("Open navigation")}">${icon("menu")}</button>`);
  // Mobile menu: the button opens it; tapping the dimmed page next to it or Esc closes it
  const appEl = document.getElementById("app");
  appEl.insertAdjacentHTML("beforeend", `<div class="kb-rail-scrim" data-rail-scrim aria-hidden="true"></div>`);
  const setRail = (open) => {
    appEl.classList.toggle("is-rail-open", open);
    $("#menu-btn").setAttribute("aria-expanded", open);
  };
  $("#menu-btn").onclick = () => setRail(!appEl.classList.contains("is-rail-open"));
  appEl.querySelector("[data-rail-scrim]").addEventListener("click", () => setRail(false));
  document.addEventListener("keydown", (e) => e.key === "Escape" && appEl.classList.contains("is-rail-open") && setRail(false));
  renderRail();
  try {
    app.favId = await favoriteTagId(false);
  } catch (e) { /* works without the favorite tag too */ }
  window.addEventListener("hashchange", route);
  route();
  import("./jobs.js").then((m) => m.watchJobs()).catch(() => {});
}

init();
