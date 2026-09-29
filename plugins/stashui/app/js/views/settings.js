// Settings: all Stash options, sorted into understandable sections. Titles and intros below are
// translated when shown (the English text is the key).
// Fields and types come live from Stash; unknown options end up under "More options".

import { esc, icon, toast, errorToast, store, confirmDialog, fmtDate } from "../ui.js";
import { t, locale, LANGS, chosen, choose } from "../i18n.js";
import { gql } from "../api.js";
import { typeInfo, selection, fieldHtml, readFields, unwrap } from "../forms.js";
import { go } from "../main.js";
import { pokeJobs } from "../jobs.js";

const AREAS = {
  general: { result: "ConfigGeneralResult", input: "ConfigGeneralInput", mutation: "configureGeneral" },
  interface: { result: "ConfigInterfaceResult", input: "ConfigInterfaceInput", mutation: "configureInterface" },
  dlna: { result: "ConfigDLNAResult", input: "ConfigDLNAInput", mutation: "configureDLNA" },
  scraping: { result: "ConfigScrapingResult", input: "ConfigScrapingInput", mutation: "configureScraping" },
};

const SECTIONS = [
  { id: "library", title: "Library", intro: "Which folders Stash scans and which files belong to the library.", area: "general",
    fields: ["stashes", "createGalleriesFromFolders", "galleryCoverRegex", "writeImageThumbnails", "createImageClipsFromVideos", "videoExtensions", "imageExtensions", "galleryExtensions", "excludes", "imageExcludes", "calculateMD5", "videoFileNamingAlgorithm"] },
  { id: "previews", title: "Previews", intro: "How hover previews and timeline images are generated.", area: "general",
    fields: ["parallelTasks", "previewSegments", "previewSegmentDuration", "previewExcludeStart", "previewExcludeEnd", "previewPreset", "previewAudio", "useCustomSpriteInterval", "spriteInterval", "minimumSprites", "maximumSprites", "spriteScreenshotSize"] },
  { id: "playback", title: "Playback", intro: "Transcoding videos the browser can't play directly.", area: "general",
    fields: ["maxStreamingTranscodeSize", "maxTranscodeSize", "transcodeHardwareAcceleration", "ffmpegPath", "ffprobePath", "transcodeInputArgs", "transcodeOutputArgs", "liveTranscodeInputArgs", "liveTranscodeOutputArgs", "drawFunscriptHeatmapRange"] },
  { id: "paths", title: "Paths", intro: "Where Stash keeps its database, backups and generated files. Changes here usually take effect after restarting Stash.", area: "general",
    fields: ["databasePath", "backupDirectoryPath", "deleteTrashPath", "generatedPath", "metadataPath", "cachePath", "blobsStorage", "blobsPath", "scrapersPath", "pluginsPath", "customPerformerImageLocation", "pythonPath"] },
  { id: "login", title: "Login", intro: "With a username and password, Stash asks for a login when opened.", area: "general", fields: ["username", "password", "maxSessionAge"], apiKey: true },
  { id: "log", title: "Log", intro: "What Stash logs – and the latest entries.", area: "general", fields: ["logLevel", "logFile", "logOut", "logAccess", "logFileMaxSize"], logs: true },
  { id: "classic-ui", title: "Classic interface", intro: "Applies to classic Stash, not to this interface.", area: "interface", fields: "*" },
  { id: "dlna", title: "DLNA", intro: "Makes the library visible to TVs and other devices on your home network.", area: "dlna", fields: "*" },
  { id: "scraper", title: "Scraper", intro: "Connection settings for scrapers. Manage the scrapers themselves and Stash-Box logins in classic Stash.", area: "scraping", fields: "*", classic: "/settings?tab=metadata-providers" },
  { id: "more", title: "More options", intro: "Everything that isn't sorted in anywhere else.", area: "general", fields: "rest" },
  { id: "database", title: "Database", intro: "Back up, optimize, clean up.", custom: "system" },
  { id: "this-ui", title: "This interface", intro: "Home page, thumbnail size, player.", custom: "app" },
];

// Fields never edited here (own tools or read-only)
const SKIP = new Set(["stashBoxes", "scraperPackageSources", "pluginPackageSources", "apiKey", "configFilePath"]);

export async function render(main, params) {
  const sec = SECTIONS.find((s) => s.id === params.section) || SECTIONS[0];
  main.innerHTML = `
    <header class="kb-head"><div class="kb-head-title">
      <nav class="kb-crumbs"><span><a href="#/settings">${t("Settings")}</a></span></nav>
      <h1 class="kb-h1">${esc(t(sec.title))}</h1>
      <p class="kb-sub">${esc(t(sec.intro))}</p>
    </div></header>
    <div class="kb-settings">
      <nav class="kb-set-nav" aria-label="${t("Sections")}">${SECTIONS.map((s) => `<a href="#/settings/${s.id}" class="${s === sec ? "is-active" : ""}">${esc(t(s.title))}</a>`).join("")}
        <a href="#/extern/classic-settings">${t("Open in classic Stash")}</a></nav>
      <div class="kb-set-body" data-body><div class="kb-loading">${t("Loading …")}</div></div>
    </div>`;
  const body = main.querySelector("[data-body]");
  try {
    if (sec.custom === "system") return renderSystem(body);
    if (sec.custom === "app") return renderApp(body);
    return await renderArea(body, sec);
  } catch (e) {
    body.innerHTML = `<div class="kb-empty"><b>${t("Couldn't load settings")}</b><p>${esc(e.message)}</p></div>`;
  }
}

async function renderArea(body, sec) {
  const a = AREAS[sec.area];
  const [inputT, sel] = await Promise.all([typeInfo(a.input), selection(a.result)]);
  const d = await gql(`query { configuration { ${sec.area} { ${sel} } } }`);
  const cur = d.configuration[sec.area];
  const inputFields = new Map(inputT.inputFields.map((f) => [f.name, f]));

  let names;
  if (sec.fields === "*") names = inputT.inputFields.map((f) => f.name);
  else if (sec.fields === "rest") {
    const used = new Set(SECTIONS.filter((s) => s.area === "general" && Array.isArray(s.fields)).flatMap((s) => s.fields));
    names = inputT.inputFields.map((f) => f.name).filter((n) => !used.has(n));
  } else names = sec.fields;
  names = names.filter((n) => inputFields.has(n) && !SKIP.has(n));

  const parts = [];
  for (const n of names) {
    if (n === "stashes") parts.push(stashesHtml(cur.stashes || []));
    else parts.push(await fieldHtml(n, inputFields.get(n).type, cur[n]));
  }
  body.innerHTML = `
    <form class="kb-set-form" data-form>${parts.join("") || `<p class="kb-hint">${t("Nothing else to set here.")}</p>`}
      ${sec.apiKey ? apiKeyHtml(cur.apiKey) : ""}
      ${sec.classic ? `<p><a class="kb-btn" href="#/extern/classic-settings?path=${encodeURIComponent(sec.classic)}">${icon("door")}${t("Open in classic Stash")}</a></p>` : ""}
      <div class="kb-set-save" data-save hidden><span>${t("Unsaved changes")}</span><button type="button" class="kb-btn" data-reset>${t("Discard")}</button><button type="submit" class="kb-btn is-primary">${t("Save")}</button></div>
    </form>
    ${sec.logs ? '<section class="kb-logs" data-logs></section>' : ""}`;
  const form = body.querySelector("[data-form]");
  const saveBar = body.querySelector("[data-save]");
  const dirty = () => (saveBar.hidden = false);
  form.addEventListener("input", dirty);
  form.addEventListener("change", dirty);
  bindStashes(form, dirty);
  body.querySelector("[data-reset]").onclick = () => renderArea(body, sec);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const input = readFields(form);
    if (names.includes("stashes")) input.stashes = readStashes(form);
    try {
      await gql(`mutation($i: ${a.input}!) { ${a.mutation}(input: $i) { __typename } }`, { i: input });
      toast(sec.id === "paths" ? t("Saved – takes effect after restarting Stash") : t("Saved"), "ok");
      saveBar.hidden = true;
    } catch (err) {
      errorToast(err, "Saving failed");
    }
  };
  if (sec.apiKey) bindApiKey(body);
  if (sec.logs) renderLogs(body.querySelector("[data-logs]"));
}

// ---------- Library folders ----------

function stashRow(s) {
  return `<div class="kb-stash-row" data-stash>
    <input class="kb-field" data-spath value="${esc(s.path || "")}" placeholder="${t("Folder path")}" spellcheck="false">
    <label class="kb-check"><input type="checkbox" data-snovid${s.excludeVideo ? " checked" : ""}>${t("no videos")}</label>
    <label class="kb-check"><input type="checkbox" data-snoimg${s.excludeImage ? " checked" : ""}>${t("no images")}</label>
    <button type="button" class="kb-btn is-icon is-ghost" data-srm aria-label="${t("Remove folder")}">${icon("close")}</button>
  </div>`;
}
function stashesHtml(list) {
  return `<div class="kb-set"><div class="kb-set-label"><b>${t("Library folders")}</b><small>${t("Folders Stash scans. “no videos/images” ignores that kind of media in the folder.")}</small></div>
    <div class="kb-stashes" data-stashes>${list.map(stashRow).join("")}</div>
    <button type="button" class="kb-btn" data-sadd>${icon("plus")}${t("Add folder")}</button></div>`;
}
function bindStashes(form, dirty) {
  form.addEventListener("click", (e) => {
    if (e.target.closest("[data-sadd]")) {
      form.querySelector("[data-stashes]").insertAdjacentHTML("beforeend", stashRow({}));
      dirty();
    }
    const rm = e.target.closest("[data-srm]");
    if (rm) {
      rm.closest("[data-stash]").remove();
      dirty();
    }
  });
}
function readStashes(form) {
  return [...form.querySelectorAll("[data-stash]")]
    .map((r) => ({ path: r.querySelector("[data-spath]").value.trim(), excludeVideo: r.querySelector("[data-snovid]").checked, excludeImage: r.querySelector("[data-snoimg]").checked }))
    .filter((s) => s.path);
}

// ---------- API key ----------

function apiKeyHtml(key) {
  return `<div class="kb-set"><div class="kb-set-label"><b>${t("API key")}</b><small>${t("For external programs. Generating a new one invalidates the old one.")}</small></div>
    <div class="kb-apikey"><code data-key>${key ? esc(key) : t("no key")}</code>
    <button type="button" class="kb-btn" data-genkey>${t("Generate new")}</button>${key ? `<button type="button" class="kb-btn is-ghost" data-clearkey>${t("Remove")}</button>` : ""}</div></div>`;
}
function bindApiKey(body) {
  body.addEventListener("click", async (e) => {
    const gen = e.target.closest("[data-genkey]");
    const clr = e.target.closest("[data-clearkey]");
    if (!gen && !clr) return;
    const r = await confirmDialog({ title: gen ? t("Generate a new API key?") : t("Remove the API key?"), text: t("Programs using the old key lose access."), ok: gen ? t("Generate") : t("Remove"), danger: !!clr });
    if (!r.ok) return;
    try {
      const d = await gql(`mutation($c: Boolean) { generateAPIKey(input: { clear: $c }) }`, { c: !!clr });
      body.querySelector("[data-key]").textContent = d.generateAPIKey || t("no key");
      toast(t("API key changed"), "ok");
    } catch (err) {
      errorToast(err, "API key");
    }
  });
}

// ---------- Log ----------

async function renderLogs(box) {
  const level = store.get("logLevel", "Info");
  box.innerHTML = `<h2 class="kb-h2">${t("Latest entries")}
    <select class="kb-field" data-lvl>${["Debug", "Info", "Warning", "Error"].map((l) => `<option value="${l}"${l === level ? " selected" : ""}>${t(l)}</option>`).join("")}</select>
    <button class="kb-btn is-ghost" data-refresh>${t("Refresh")}</button></h2><div class="kb-loglist" data-list>${t("Loading …")}</div>`;
  const order = { Trace: 0, Debug: 1, Info: 2, Progress: 2, Warning: 3, Error: 4 };
  const load = async () => {
    try {
      const d = await gql(`query { logs { time level message } }`);
      const min = order[box.querySelector("[data-lvl]").value];
      const rows = d.logs.filter((l) => (order[l.level] ?? 2) >= min).slice(-400).reverse();
      box.querySelector("[data-list]").innerHTML = rows.length
        ? rows.map((l) => `<div class="kb-log is-${l.level.toLowerCase()}"><time>${esc(new Date(l.time).toLocaleTimeString(locale()))}</time><b>${esc(l.level)}</b><span>${esc(l.message)}</span></div>`).join("")
        : `<p class="kb-hint">${t("No entries at this level.")}</p>`;
    } catch (e) {
      box.querySelector("[data-list]").textContent = t("Couldn't load the log:") + " " + e.message;
    }
  };
  box.querySelector("[data-lvl]").onchange = (e) => {
    store.set("logLevel", e.target.value);
    load();
  };
  box.querySelector("[data-refresh]").onclick = load;
  load();
}

// ---------- Database & system ----------

async function renderSystem(body) {
  const cg = await typeInfo("CleanGeneratedInput");
  body.innerHTML = `
    <div class="kb-cards">
      <section class="kb-card"><h2>${t("Back up database")}</h2><p>${t("Stores a copy of the database in the backup folder.")}</p>
        <label class="kb-check"><input type="checkbox" data-blobs>${t("Include image data")}</label>
        <button class="kb-btn is-primary" data-backup>${t("Back up now")}</button></section>
      <section class="kb-card"><h2>${t("Optimize database")}</h2><p>${t("Tidies up the database internally and makes it smaller. Runs as a background task.")}</p>
        <button class="kb-btn" data-optimise>${t("Optimize")}</button></section>
      <section class="kb-card"><h2>${t("Clean up generated files")}</h2><p>${t("Removes previews, sprites and other generated files that no longer belong to a scene or image.")}</p>
        <form data-cleangen>${(await Promise.all(cg.inputFields.map((f) => fieldHtml(f.name, f.type, f.name === "dryRun")))).join("")}
        <button class="kb-btn" type="submit">${t("Start clean-up")}</button></form></section>
    </div>`;
  body.querySelector("[data-backup]").onclick = async () => {
    try {
      const d = await gql(`mutation($b: Boolean) { backupDatabase(input: { download: false, includeBlobs: $b }) }`, { b: body.querySelector("[data-blobs]").checked });
      toast(t("Backed up") + (d.backupDatabase ? ": " + d.backupDatabase : ""), "ok");
    } catch (e) {
      errorToast(e, "Backup failed");
    }
  };
  body.querySelector("[data-optimise]").onclick = async () => {
    try {
      await gql(`mutation { optimiseDatabase }`);
      pokeJobs();
      toast(t("Optimizing – see Tasks"), "ok");
    } catch (e) {
      errorToast(e, "Optimize");
    }
  };
  body.querySelector("[data-cleangen]").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await gql(`mutation($i: CleanGeneratedInput!) { metadataCleanGenerated(input: $i) }`, { i: readFields(e.target) });
      pokeJobs();
      toast(t("Cleaning up – see Tasks"), "ok");
    } catch (err) {
      errorToast(err, "Clean-up");
    }
  };
}

// ---------- This interface ----------

async function renderApp(body) {
  const d = await gql(`query { configuration { plugins(include: ["stashui"]) } }`);
  const cfg = (d.configuration.plugins && d.configuration.plugins.stashui) || {};
  const player = store.get("player", {});
  body.innerHTML = `
    <form class="kb-set-form" data-form>
      <label class="kb-set"><span class="kb-set-label"><b>${t("Language")}</b><small>${t("“Automatic” follows the language set in Stash (classic Stash → Settings → Interface).")}</small></span>
        <select class="kb-field" data-lang><option value="auto">${t("Automatic")}</option>${LANGS.map(([code, name]) => `<option value="${code}">${esc(name)}</option>`).join("")}</select></label>
      <label class="kb-set kb-set-bool"><span class="kb-set-label"><b>${t("Folders in the navigation and on the home page")}</b><small>${t("Counting the folders reads the whole library once (then it's remembered). Off = folders only load when you open “Folders”.")}</small></span>
        <span class="kb-switch"><input type="checkbox" data-railfolders${store.get("railFolders", true) ? " checked" : ""}><i></i></span></label>
      <label class="kb-set kb-set-bool"><span class="kb-set-label"><b>${t("This interface as home page")}</b><small>${t("Opening Stash goes straight to this interface. Off = classic Stash stays the home page.")}</small></span>
        <span class="kb-switch"><input type="checkbox" data-home${cfg.keepClassicHome ? "" : " checked"}><i></i></span></label>
      <label class="kb-set"><span class="kb-set-label"><b>${t("Thumbnail size")}</b><small>${t("How tall a row in the lists is.")}</small></span>
        <input type="range" min="130" max="480" step="10" data-rowh value="${store.get("rowHeight", 250)}"></label>
      <label class="kb-set kb-set-bool"><span class="kb-set-label"><b>${t("Autoplay next in the player")}</b><small>${t("Start the next scene when one ends.")}</small></span>
        <span class="kb-switch"><input type="checkbox" data-auto${player.auto === false ? "" : " checked"}><i></i></span></label>
      <div class="kb-set"><div class="kb-set-label"><b>${t("Favorites")}</b><small>${t("The heart is the Stash tag “Favorite”. You'll find it in classic Stash too.")}</small></div></div>
      <div class="kb-set"><div class="kb-set-label"><b>${t("Reset saved view")}</b><small>${t("Expanded folders, player and viewer settings, thumbnail size.")}</small></div>
        <button type="button" class="kb-btn" data-resetlocal>${t("Reset")}</button></div>
    </form>`;
  // Language: applies after reloading, so the menu and every page switch at once
  const langSel = body.querySelector("[data-lang]");
  langSel.value = chosen();
  langSel.onchange = () => {
    choose(langSel.value);
    location.reload();
  };
  body.querySelector("[data-home]").onchange = async (e) => {
    try {
      await gql(`mutation($i: Map!) { configurePlugin(plugin_id: "stashui", input: $i) }`, { i: Object.assign({}, cfg, { keepClassicHome: !e.target.checked }) });
      localStorage.setItem("stashui.keepClassicHome", String(!e.target.checked));
      toast(t("Saved"), "ok");
    } catch (err) {
      errorToast(err, "Save");
    }
  };
  body.querySelector("[data-railfolders]").onchange = (e) => {
    store.set("railFolders", e.target.checked);
    location.reload(); // the navigation is built once – rebuild it with or without folders
  };
  body.querySelector("[data-rowh]").onchange = (e) => store.set("rowHeight", Number(e.target.value));
  body.querySelector("[data-auto]").onchange = (e) => store.set("player", Object.assign(store.get("player", {}), { auto: e.target.checked }));
  body.querySelector("[data-resetlocal]").onclick = () => {
    Object.keys(localStorage).filter((k) => k.startsWith("stashui.") && k !== "stashui.queue").forEach((k) => localStorage.removeItem(k));
    toast(t("Reset"), "ok");
    go("settings/this-ui", true);
  };
}
