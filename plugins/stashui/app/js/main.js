// Stash UI – app frame: router, navigation rail, overlays.

import { esc, icon, store, errorToast, fmtNum, $, folderMode, setRatingSystem } from "./ui.js";
import { t, initLang } from "./i18n.js";
import { gql, loadFolders, favoriteTagId, stats } from "./api.js";
import { applyTheme, initAmbient } from "./theme.js";
import { LATEST } from "./changelog.js";

applyTheme(); // chosen colors before anything is drawn
initAmbient();

// Install as an app: the worker only exists so browsers offer "Install" (needs https or localhost).
// The install prompt comes early, Settings → General picks it up later.
if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch(() => {});
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  window.kbInstall = e;
  window.dispatchEvent(new Event("kb-installable"));
});

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
  { re: /^performers$/, view: "performers" },
  { re: /^performer\/(\d+)$/, view: "performer", keys: ["id"] },
  { re: /^search$/, view: "search" },
  { re: /^history$/, view: "history" },
  { re: /^stats$/, view: "stats" },
  { re: /^playlists$/, view: "playlists" },
  { re: /^whatsnew$/, view: "whatsnew" },
  { re: /^versus$/, view: "versus" },
  { re: /^versus\/ranking$/, view: "versus", params: { tab: "ranking" } },
  { re: /^duplicates$/, view: "dupes" },
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
  pmvPlugin: undefined, // PMV Generator's plugin ID once known (null = not installed)
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
  performers: () => import("./views/performers.js"),
  performer: () => import("./views/performer.js"),
  search: () => import("./views/search.js"),
  history: () => import("./views/history.js"),
  stats: () => import("./views/stats.js"),
  versus: () => import("./views/versus.js"),
  playlists: () => import("./views/playlists.js"),
  whatsnew: () => import("./views/whatsnew.js"),
  dupes: () => import("./views/dupes.js"),
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
    { href: "performers", label: "Performers", icon: "person", match: /^performer/, count: "performer_count" },
    { href: "tags", label: "Tags", icon: "tag", match: /^tag/, count: "tag_count" },
  ] },
  { group: "Watch", items: [
    { href: "queue", label: "Queue", icon: "queue", match: /^queue/, count: "queue" },
    { href: "playlists", label: "Playlists", icon: "slides", match: /^playlists/ },
    { href: "history", label: "History", icon: "history", match: /^history/ },
    { href: "versus", label: "Versus", icon: "trophy", match: /^versus/ },
    { action: "storm", label: "Media Storm", icon: "bolt", plugin: "mediaStorm" },
    { action: "pmv", label: "PMV Generator", icon: "music", plugin: "pmvGenerator" },
  ] },
  { group: "Manage", items: [
    { href: "tasks", label: "Tasks", icon: "tasks", match: /^tasks/, count: "jobs" },
    { href: "stats", label: "Statistics", icon: "chart", match: /^stats/ },
    { href: "duplicates", label: "Duplicates", icon: "copies", match: /^duplicates/ },
    { href: "settings", label: "Settings", icon: "gear", match: /^settings/ },
    { href: "plugins", label: "Plugins", icon: "plug", match: /^plugins/ },
    { href: "whatsnew", label: "What's new", icon: "info", match: /^whatsnew/, count: "news" },
    { href: "extern/classic", label: "Classic Stash", icon: "door", match: /^extern\/classic/ },
  ] },
];

const folderOpen = new Set(store.get("folderOpen", []));

// Group headings fold their group away (remembered) – handy with many plugins under Extensions
const railClosed = new Set(store.get("railClosed", []));
const groupHead = (key, extra = "") =>
  `<button type="button" class="kb-rail-group${railClosed.has(key) ? " is-closed" : ""}" data-railgrp="${key}" aria-expanded="${!railClosed.has(key)}">${t(key)}${extra}<i class="kb-rail-caret"></i></button>`;
function paintRailGroups() {
  document.querySelectorAll("#rail [data-railbody]").forEach((b) => (b.hidden = railClosed.has(b.dataset.railbody)));
}

function renderRail() {
  const rail = document.getElementById("rail");
  rail.innerHTML =
    `<a class="kb-mark" href="#/" aria-label="${t("Stash, home page")}"><span>Stash</span></a>` +
    NAV.map((g) =>
      (g.group ? groupHead(g.group) : "") +
      `<nav class="kb-nav"${g.group ? ` data-railbody="${g.group}"` : ""}>` +
      g.items.map((it) =>
        it.action
          ? `<button type="button" data-action="${it.action}"${it.plugin ? ` data-plugin="${it.plugin}"` : ""}>${icon(it.icon)}<span>${t(it.label)}</span></button>`
          : `<a href="#/${it.href}" data-match="${it.match.source}">${icon(it.icon)}<span>${t(it.label)}</span>${it.count ? `<span class="kb-count" data-count="${it.count}"></span>` : ""}</a>`
      ).join("") +
      `</nav>` +
      (g.group === "Watch" ? `<div data-extplugins hidden>${groupHead("Extensions", '<span class="kb-rail-n" data-extn></span>')}<nav class="kb-nav" data-extlist data-railbody="Extensions"></nav></div>` : "") +
      (g.group === "Library" && folderMode() === "all" ? `${groupHead("Folders")}<div class="kb-tree" id="tree" data-railbody="Folders"><div class="kb-rail-foot">${t("Loading …")}</div></div>` : "")
    ).join("") +
    `<div class="kb-rail-foot" id="rail-foot"></div>`;

  paintRailGroups();
  setNewsDot();
  rail.addEventListener("click", (e) => {
    const gh = e.target.closest("[data-railgrp]");
    if (gh) {
      const k = gh.dataset.railgrp;
      railClosed.has(k) ? railClosed.delete(k) : railClosed.add(k);
      store.set("railClosed", [...railClosed]);
      gh.classList.toggle("is-closed", railClosed.has(k));
      gh.setAttribute("aria-expanded", !railClosed.has(k));
      return paintRailGroups();
    }
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
export const PMV_PAGE = "/plugin/pmvGenerator/assets/index.html?from=stashui"; // so its links lead back here
async function refreshPluginLinks() {
  // Matched by ID or name, ignoring case and separators – a copy installed under another folder
  // name (e.g. "MediaStorm", "media-storm") is still found
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  let on;
  let plugins;
  try {
    // paths only exists on newer Stash versions – without it, only own pages are found
    plugins = (await gql(`query { plugins { id name version enabled tasks { name } settings { name } paths { javascript } } }`).catch(() => gql(`query { plugins { id name version enabled tasks { name } settings { name } } }`))).plugins;
    on = new Set(plugins.filter((p) => p.enabled).flatMap((p) => [norm(p.id), norm(p.name)]));
    // Its backend cuts sound out of videos – the real ID is needed, the folder may be named differently
    const pmv = plugins.find((p) => p.enabled && (norm(p.id) === "pmvgenerator" || norm(p.name) === "pmvgenerator"));
    app.pmvPlugin = pmv ? pmv.id : null;
  } catch (e) {
    return; // unknown – leave the entries visible
  }
  document.querySelectorAll("#rail [data-plugin]").forEach((b) => (b.hidden = !on.has(norm(b.dataset.plugin))));
  paintExtensions(plugins.filter((p) => p.enabled && !OWN.has(norm(p.id))));
}

// ---------- Other people's plugins ----------
// Every enabled plugin gets a menu entry, pointing to the best place it has:
// 1. its own web page in its assets (e.g. Stash TV's /plugin/stash-tv/assets/app/) – opened directly
// 2. a page it registers inside classic Stash (PluginApi.register.route) – opened embedded
// 3. only tasks/settings – its card on the Plugins page, unfolded
// 4. only additions to classic Stash with a menu button there (e.g. an overlay) – classic Stash, where it runs
// What was found is kept per plugin version.
const OWN = new Set(["stashui", "mediastorm", "pmvgenerator"]);
const EXT_KEY = "extPlugins5"; // v4: every plugin, routes also via variables

// A real page – not a folder listing: Stash's file server answers ".../index.html" of a folder without
// that file by listing the folder (a bare <pre> with links, no head, body or scripts)
async function pageExists(url) {
  try {
    const r = await fetch(url, { method: "GET", cache: "no-store" });
    if (!r.ok || !/html/.test(r.headers.get("content-type") || "")) return false;
    const html = (await r.text()).slice(0, 4000);
    const listing = /<pre>\s*(<a href=[^>]*>[^<]*<\/a>\s*)*<\/pre>/i.test(html) && !/<(head|body|script|title|div)\b/i.test(html);
    return !listing && /<(html|head|body|script|div|title)\b/i.test(html);
  } catch (e) {
    return false;
  }
}

async function findPages(p) {
  const base = `/plugin/${encodeURIComponent(p.id)}/assets/`;
  const pages = [];
  // Folders are asked for directly: Stash then delivers their index.html (or a listing, which doesn't
  // count). ".../app/index.html" itself doesn't work – Stash redirects it to a wrong relative address.
  for (const dir of ["app/", "dist/", "ui/", "web/", ""]) {
    const probe = base + dir;
    const open = probe;
    if (await pageExists(probe)) {
      // Cross-check: if a page that can't exist also "exists", the server answers everything with its
      // own start page – then this one doesn't count either
      if (!(await pageExists(base + "kb-no-such-page-" + Date.now() + ".html"))) pages.push({ kind: "page", url: open });
      break;
    }
  }
  // Pages registered in classic Stash: found in the plugin's own JavaScript
  let navButton = false; // puts a button into classic Stash's menu
  for (const js of ((p.paths && p.paths.javascript) || []).slice(0, 4)) {
    try {
      const src = await (await fetch(js)).text();
      if (/MainNavBar|navbar-nav|nav-link|navbar-buttons/.test(src)) navButton = true;
      // register.route("/plugin/x", …) – or with the path in a variable: then the "/plugin/x" strings
      // of a script that registers routes at all
      const re = /register\.route\(\s*["'`](\/[^"'`\s]+)["'`]/g;
      const loose = /register\.route\(/.test(src) ? /["'`](\/plugins?\/[A-Za-z0-9_-]+)["'`]/g : null;
      let m;
      for (const r of [re, loose].filter(Boolean)) {
        while ((m = r.exec(src)) && pages.length < 4) {
          if (!pages.some((x) => x.route === m[1])) pages.push({ kind: "route", route: m[1] });
        }
      }
    } catch (e) { /* not readable */ }
  }
  if (!pages.length && ((p.tasks && p.tasks.length) || (p.settings && p.settings.length))) pages.push({ kind: "card" });
  // Only additions to classic Stash with a menu button of their own (e.g. an overlay you switch on there) –
  // not libraries, font loaders or themes
  else if (!pages.length && navButton && !/theme/i.test(p.name)) pages.push({ kind: "classic" });
  return pages;
}

async function paintExtensions(list) {
  const box = document.querySelector("#rail [data-extplugins]");
  if (!box) return;
  const cache = store.get(EXT_KEY, {});
  const found = [];
  for (const p of list) {
    const key = p.id + "@" + (p.version || "");
    if (!cache[key]) cache[key] = await findPages(p);
    cache[key].forEach((pg, i) => found.push({ name: p.name + (i && pg.route ? " – " + pg.route.split("/").pop() : ""), id: p.id, ...pg }));
  }
  // Only keep what belongs to installed versions
  const keep = new Set(list.map((p) => p.id + "@" + (p.version || "")));
  Object.keys(cache).forEach((k) => keep.has(k) || delete cache[k]);
  store.set(EXT_KEY, cache);
  try {
    ["stashui.extPlugins", "stashui.extPlugins2", "stashui.extPlugins3", "stashui.extPlugins4"].forEach((k) => localStorage.removeItem(k)); // older results
  } catch (e) { /* blocked */ }
  const href = (f) =>
    f.kind === "page" ? f.url
    : f.kind === "route" ? "#/extern/classic?path=" + encodeURIComponent(f.route)
    : f.kind === "card" ? "#/plugins?focus=" + encodeURIComponent(f.id)
    : "#/extern/classic";
  // Settings → This interface can hide the whole group or single plugins
  store.set("extFound", found.map((f) => ({ id: f.id, name: f.name })));
  const off = new Set(store.get("extHidden", []));
  const shown = found.filter((f) => !off.has(f.id));
  box.querySelector("[data-extlist]").innerHTML = shown
    .map((f) => `<a href="${esc(href(f))}" data-ext="${esc(f.id)}" title="${esc(f.name)}">${icon("plug")}<span>${esc(f.name)}</span></a>`)
    .join("");
  const n = box.querySelector("[data-extn]");
  if (n) n.textContent = shown.length;
  box.hidden = !shown.length || store.get("extMode", "show") === "hide";
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

// A dot at "What's new" while there are patch notes you haven't opened yet
export function setNewsDot() {
  const c = document.querySelector('[data-count="news"]');
  if (c) c.classList.toggle("is-dot", store.get("newsSeen", "") !== LATEST);
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
    // with it: the rating system chosen in Stash (stars, half stars … or 0–10)
    const c = (await gql(`query { configuration { interface { language } ui } }`)).configuration;
    stashLang = c.interface.language || "";
    setRatingSystem((c.ui || {}).ratingSystemOptions);
    import("./standings.js").then((m) => m.bestMarkers()).catch(() => {}); // best moments, for the player
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
