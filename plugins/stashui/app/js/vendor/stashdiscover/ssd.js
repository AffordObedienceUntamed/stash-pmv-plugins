/* stashDiscover – shared core ("SSD"), taken from the plugin stashDiscover 2.2.1 by ufousox007
 * https://github.com/k6cc/stash-jav-tools/tree/main/stashDiscover  (used in Stash UI with the author's permission)
 *
 * Changes for Stash UI (everything else is the original code):
 *  - no React / PluginApi: the language comes from window.__ssdLocale, the page is mounted by Stash UI
 *  - stash-box requests (callBoxGQL) go through Stash UI's plugin backend (mode box_gql), which holds the API key –
 *    the key never reaches the page
 *  - plugin settings (Jackett, downloader, windows …) live in the stashui plugin config (key "ssd")
 *  - Jackett search / downloader push (runPluginTask) call the backend modes ssd_search / ssd_push
 *  - the performer-page tab, the nav entry and the route shell of the original are not part of this file
 */
(function () {
  "use strict";

  if (window.__ssdLoaded) return;
  window.__ssdLoaded = true;

  var PLUGIN_ID = "stashDiscover";
  var PLUGIN_VERSION = "2.2.1";
  var TASK_SEARCH = "Search Resources";
  var TASK_PUSH = "Push to Downloader";
  var RESULT_MARKER = "[SSD_RESULT]";
  var ERROR_MARKER = "[SSD_ERROR]";
  // DOM event fired after a discover-page scene is saved to the library;
  // discover.js listens and drops the card from its results
  var SCENE_SAVED_EVENT = "ssd:scene-saved";

  // Brand display names for known stash-box hosts (simplified badges)
  var BRAND_MAP = {
    "javstash.org": "JAVStash",
    "stashdb.org": "StashDB",
    "theporndb.net": "TPDB",
  };

  // ─── i18n (Stash UI sets window.__ssdLocale; the original read it from Stash's Intl) ───

  function isZh() {
    return /^zh/i.test(String(window.__ssdLocale || document.documentElement.lang || ""));
  }

  function tc(zh, en) {
    return isZh() ? zh : en;
  }

  // ─── Box request failures (kind → status label) ──────────────────────────

  // A hung box request must never leave the tab spinning (the "looks frozen"
  // forum report) — every call is aborted after this timeout.
  var BOX_TIMEOUT_MS = 15000;

  var BOX_ERR_TEXT = {
    timeout: ["请求超时", "Timed out"],
    network: ["无法连接", "Unreachable"],
    auth: ["鉴权失败", "Auth failed"],
    blocked: ["请求被拒绝", "Rejected"],
    graphql: ["接口报错", "API error"],
    parse: ["响应异常", "Bad response"],
    unknown: ["未知错误", "Unknown error"],
  };

  function boxErrText(kind, zh) {
    var pair = BOX_ERR_TEXT[kind] || BOX_ERR_TEXT.unknown;
    return zh ? pair[0] : pair[1];
  }

  // Error carrying a kind so the caller can classify failures (box vs config)
  function ssdError(kind, message) {
    var e = new Error(message || "");
    e.ssdKind = kind;
    return e;
  }

  // ─── GraphQL helpers ─────────────────────────────────────────────────────

  function callGQL(query, variables) {
    var payload = { query: query };
    if (variables) payload.variables = variables;
    return fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.errors) throw new Error(JSON.stringify(data.errors));
        return data.data;
      });
  }

  // ─── stash-box + settings through Stash UI's backend ──────────────────────

  function ssdBackend(args) {
    var fn = window.__ssdBackend;
    if (!fn) return Promise.reject(new Error("backend not available"));
    return fn(args);
  }

  // The backend asks the stash-box with the API key Stash has for it (only boxes set up in Stash, only queries)
  function callBoxGQL(endpoint, apiKey, query, variables, timeoutMs) {
    return ssdBackend({ mode: "box_gql", endpoint: endpoint, query: query, variables: variables || {}, timeout: Math.round((timeoutMs || BOX_TIMEOUT_MS) / 1000) })
      .then(function (r) {
        if (!r) throw ssdError("unknown", "no answer");
        if (r.kind) throw ssdError(r.kind, r.message || r.kind);
        if (r.errors) throw ssdError("graphql", JSON.stringify(r.errors));
        return r.data;
      }).catch(function (e) {
        if (e && e.ssdKind) throw e;
        throw ssdError("unknown", (e && e.message) || String(e));
      });
  }

  // ─── Config ───────────────────────────────────────────────────────────────

  var _boxConfig = null;

  function getStashBoxes() {
    if (_boxConfig) return Promise.resolve(_boxConfig);
    // (the API key is not asked for: the backend adds it)
    return callGQL("query { configuration { general { stashBoxes { name endpoint } } } }")
      .then(function (data) {
        var boxes = (((data.configuration || {}).general || {}).stashBoxes) || [];
        _boxConfig = boxes.filter(function (b) { return b && b.endpoint; });
        return _boxConfig;
      });
  }

  // The settings of the original plugin (recentDays, previewDays, jackettUrl, …) are one JSON string in the stashui plugin config
  function getPluginSettings() {
    return callGQL("query{configuration{plugins}}")
      .then(function (data) {
        var plugins = (data.configuration || {}).plugins || {};
        var raw = (plugins.stashui || {}).ssd;
        try { return (typeof raw === "string" ? JSON.parse(raw) : raw) || {}; } catch (_) { return {}; }
      });
  }

  function savePluginSettings(patch) {
    return getPluginSettings().then(function (cur) {
      var next = Object.assign({}, cur, patch);
      return window.__ssdSaveConfig ? window.__ssdSaveConfig("ssd", JSON.stringify(next)).then(function () { return next; }) : next;
    });
  }

  // ─── Rate limiter (box queries) ──────────────────────────────────────────

  function createRateLimiter(maxConcurrent, minIntervalMs) {
    var queue = [], active = 0, lastDispatch = 0;
    function tryDispatch() {
      if (queue.length === 0 || active >= maxConcurrent) return;
      var now = Date.now();
      var wait = Math.max(0, lastDispatch + minIntervalMs - now);
      if (wait > 0) { setTimeout(tryDispatch, wait); return; }
      var task = queue.shift();
      active++; lastDispatch = Date.now();
      task.fn().then(function (r) { active--; task.resolve(r); tryDispatch(); })
        .catch(function (e) { active--; task.reject(e); tryDispatch(); });
    }
    return {
      submit: function (fn) {
        return new Promise(function (resolve, reject) {
          queue.push({ fn: fn, resolve: resolve, reject: reject });
          tryDispatch();
        });
      }
    };
  }

  var _boxRateLimiter = createRateLimiter(3, 300);

  // ─── Date helpers (local calendar date, not UTC) ────────────────────────

  function localDateStr(d) {
    var y = d.getFullYear();
    var m = pad(d.getMonth() + 1);
    var day = pad(d.getDate());
    return y + "-" + m + "-" + day;
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  // recentDays: 0=unlimited, N=cutoff = today - N days. Scenes older than cutoff excluded.
  function recentCutoffDate(recentDays) {
    if (!recentDays || recentDays <= 0) return null;
    return localDateStr(new Date(Date.now() - recentDays * 86400000));
  }

  // previewDays: -1=hide all future (cutoff=today), 0=unlimited(null), N=cutoff=today+N days
  function previewCutoffDate(previewDays) {
    if (previewDays === 0 || previewDays == null) return null;
    if (previewDays === -1) return localDateStr(new Date());
    return localDateStr(new Date(Date.now() + previewDays * 86400000));
  }

  var _state = {
    performerId: null,
    performerName: "",
    entityType: "performer",  // "performer" | "studio"（P7 工作室 tab 复用同一条渲染管线）
    localStashIds: {},
    localSceneKeys: {},
    loading: false,
    loadError: "",
    // ── fallback state panel ──
    viewState: "",             // "" | loading | content | empty | net-fail | no-ids | no-box | fatal | no-match
    errorKind: "",             // fatal | no-box | no-ids (message lives in loadError)
    loadInitiated: false,      // a load already ran for this performer (no silent re-scan on tab re-entry)
    allBoxes: [],              // every configured stash-box (incl. ones the performer has no ID for)
    performerStashIds: [],     // local performer's stash_ids [{endpoint, stash_id}]
    boxFailed: {},             // endpoint -> failed this round (retried on the next load)
    boxStatus: {},             // endpoint -> { ok:bool, kind:string }
    boxFetched: {},            // endpoint -> scenes fetched this round (loading panel rows)
    droppedByWindow: 0,        // scenes dropped by the recent/preview window this round
    windowRelaxed: false,      // "unlimited time range (this session)"
    preferredFallback: false,  // preferred box had no ID → queried the others instead
    preferredBoxLabel: "",     // brand/raw name of the preferred box (notice text)
    cfgRecentDays: 180,        // configured values = restore target
    cfgPreviewDays: 7,
    findOpen: false,           // "find on source" block expanded
    findState: "idle",         // idle | loading | done | empty | fail
    findResults: [],           // [{box, boxName, candidate}]
    findTerm: "",
    findFailures: [],          // [{name, kind}]
    findMessage: "",           // result/notice line shown inside the block
    findExpandedKey: "",       // accordion: row key of the one expanded result
    findImageIdx: 0,           // image index of the expanded result (last viewed = selected)
    findBusyKey: "",           // row key with an in-flight link/overwrite write
    findRowMsg: {},            // row key -> {kind, text} (per-row action feedback)
    editWatching: false,       // waiting for the native edit panel to add a stash_id
    editWatchMissing: false,   // native edit button not found — guidance only
    _editTimer: null,
    modal: null,
    modalDetail: null,
    modalLoading: false,
    // pagination
    perPage: 40,
    currentPage: 1,
    sortDir: "DESC",           // DESC | ASC (pushed to box query as sort:DATE)
    zoom: 1,                   // card size 0-3 (native SceneCardGrid zoomWidths)
    displayMode: "grid",       // grid | list — seeded from localStorage below
    refocusSearch: false,      // restore search-input focus after re-render
    searchCaret: null,         // caret offset to restore with focus
    recentDays: 180,
    previewDays: 7,
    queryBoxes: [],            // [{name,endpoint,api_key}]
    boxStashIds: {},           // endpoint -> box performer stash_id
    boxCursors: {},            // endpoint -> next page to fetch (1-based)
    boxExhausted: {},          // endpoint -> true
    boxPageSize: 100,          // dynamic per-page for box queries (adjusted by missing density)
    boxFetchedTotal: 0,        // scenes fetched from boxes so far (density denominator)
    boxTotalCount: 0,          // sum of box count fields (approx, includes owned)
    cachedMissing: [],         // fetched + deduped + window-filtered missing scenes
    allLoaded: false,          // all box pages exhausted
    loadingPage: false,        // currently fetching more pages
    searchQuery: "",           // client-side filter text
    localPerformerMaps: {},    // endpoint(lower) -> box performer id(lower) -> {id,name,image_path}
  };

  // Persisted display mode (grid | list) — survives tab re-entry
  try {
    if (localStorage.getItem("ssdDisplayMode") === "list") _state.displayMode = "list";
  } catch (e) { /* localStorage unavailable — stay grid */ }

  // ─── Box web URL (origin from GraphQL endpoint) ──────────────────────────

  function boxWebBase(endpoint) {
    try {
      return new URL(endpoint).origin;
    } catch (e) {
      return endpoint.replace(/\/graphql\/?$/, "").replace(/\/+$/, "");
    }
  }

  function boxSceneUrl(endpoint, sceneId) {
    return boxWebBase(endpoint) + "/scenes/" + sceneId;
  }

  // Brand name for a stash-box endpoint (e.g. https://javstash.org/graphql →
  // "JAVStash"). Falls back to `fallback` (box config name) or the host.
  function brandNameForEndpoint(endpoint, fallback) {
    var host = "";
    try { host = new URL(endpoint).host; } catch (e) { host = String(endpoint || ""); }
    return BRAND_MAP[host] || fallback || host;
  }

  // stash-box scene fields — flat images[] array
  var BOX_SCENE_FIELDS =
    "id title code details release_date duration " +
    "urls { url site { name } } " +
    "studio { id name } " +
    "performers { as performer { id name images { url } } } " +
    "tags { id name } " +
    "images { url }";

  var BOX_SCENE_DETAIL_FIELDS =
    "id title details release_date production_date code director duration " +
    "urls { url site { name } } " +
    "studio { id name } " +
    "performers { as performer { id name gender images { url } } } " +
    "tags { id name } " +
    "images { url }";

  function fetchBoxSceneDetail(box, sceneId) {
    return _boxRateLimiter.submit(function () {
      return callBoxGQL(
        box.endpoint, box.api_key,
        "query($id:ID!){findScene(id:$id){" + BOX_SCENE_DETAIL_FIELDS + "}}",
        { id: sceneId }
      );
    }).then(function (data) {
      var sc = data && data.findScene;
      if (!sc) return null;
      return {
        scene: sc,
        images: (sc.images || []).map(function (img) { return { url: img.url, type: "image" }; }),
      };
    });
  }

  function isSceneOwned(item, keys) {
    var sc = item.scene;
    var owned = keys || _state.localSceneKeys;
    var epKey = item.endpoint.toLowerCase() + ":" + String(sc.id).toLowerCase();
    if (owned[epKey]) return true;
    if (sc.code) {
      var codeKey = "code:" + String(sc.code).trim().toLowerCase();
      if (owned[codeKey]) return true;
    }
    return false;
  }


  // ─── Local performer/studio mapping by stash_id ──────────────────────────

  function buildLocalPerformerStashIdMap(endpoint) {
    return callGQL(
      "query{findPerformers(filter:{per_page:-1}){performers{id name image_path stash_ids{endpoint stash_id}}}}"
    ).then(function (data) {
      var map = {};
      var performers = ((data.findPerformers || {}).performers) || [];
      performers.forEach(function (p) {
        (p.stash_ids || []).forEach(function (sid) {
          if (sid.endpoint && sid.endpoint.toLowerCase() === endpoint.toLowerCase() && sid.stash_id) {
            map[String(sid.stash_id).toLowerCase()] = { id: p.id, name: p.name, image_path: p.image_path };
          }
        });
      });
      return map;
    });
  }

  function findLocalStudioByStashId(endpoint, stashId) {
    return callGQL(
      "query{findStudios(filter:{per_page:-1}){studios{id stash_ids{endpoint stash_id}}}}"
    ).then(function (data) {
      var studios = ((data.findStudios || {}).studios) || [];
      for (var i = 0; i < studios.length; i++) {
        var s = studios[i];
        for (var j = 0; j < (s.stash_ids || []).length; j++) {
          var sid = s.stash_ids[j];
          if (sid.endpoint && sid.endpoint.toLowerCase() === endpoint.toLowerCase() &&
              sid.stash_id && String(sid.stash_id).toLowerCase() === String(stashId).toLowerCase()) {
            return s.id;
          }
        }
      }
      return null;
    });
  }

  // ─── Tab injection ────────────────────────────────────────────────────────

  var ICON_WARN = "M256 32c14.2 0 27.3 7.5 34.5 19.8l216 368c7.3 12.4 7.3 27.7 .2 40.1S486.3 480 472 480L40 480c-14.3 0-27.6-7.7-34.7-20.1s-7-27.8 .2-40.1l216-368C228.7 39.5 241.8 32 256 32zm0 128c-13.3 0-24 10.7-24 24l0 112c0 13.3 10.7 24 24 24s24-10.7 24-24l0-112c0-13.3-10.7-24-24-24zm32 224a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z";
  var ICON_INFO = "M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336l24 0 0-64-24 0c-13.3 0-24-10.7-24-24s10.7-24 24-24l48 0c13.3 0 24 10.7 24 24l0 88 8 0c13.3 0 24 10.7 24 24s-10.7 24-24 24l-80 0c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z";
  var ICON_DANGER = "M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-384c13.3 0 24 10.7 24 24l0 112c0 13.3-10.7 24-24 24s-24-10.7-24-24l0-112c0-13.3 10.7-24 24-24zM224 352a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z";

  function sourceLabel(box) {
    return brandNameForEndpoint(box.endpoint, box.name || box.endpoint);
  }

  function makeChip(text, kind) {
    var el = document.createElement("span");
    el.className = "ssd-chip" + (kind ? " ssd-chip--" + kind : "");
    el.textContent = text;
    return el;
  }

  function makePanelBtn(label, kind, size) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ssd-btn " + (size === "sm" ? "ssd-btn-sm" : (size === "md" ? "ssd-btn-md" : "ssd-btn-lg"))
      + " ssd-btn-" + (kind || "secondary");
    b.textContent = label;
    return b;
  }

  function panelIcon(kind) {
    var path = kind === "warn" ? ICON_WARN : (kind === "danger" ? ICON_DANGER : ICON_INFO);
    var span = document.createElement("span");
    span.className = "ssd-panel-icon ssd-panel-icon--" + kind;
    span.innerHTML = '<svg viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="'
      + path + '"></path></svg>';
    return span;
  }

  function panelDesc(text) {
    var el = document.createElement("div");
    el.className = "ssd-panel-desc";
    el.textContent = text;
    return el;
  }

  function panelNote(text, withSpinner, isError) {
    var el = document.createElement("div");
    el.className = "ssd-find-note" + (isError ? " ssd-find-note--error" : "");
    if (withSpinner) {
      var sp = document.createElement("div");
      sp.className = "ssd-spinner ssd-spinner-sm";
      el.appendChild(sp);
    }
    var t = document.createElement("span");
    t.textContent = text;
    el.appendChild(t);
    return el;
  }

  // One row per source: dot + name + status text
  function buildSourceRow(name, dotKind, statusText, statusWarn) {
    var row = document.createElement("div");
    row.className = "ssd-src-row";
    var dot = document.createElement("span");
    dot.className = "ssd-src-dot ssd-src-dot--" + dotKind;
    var nm = document.createElement("span");
    nm.className = "ssd-src-name";
    nm.textContent = name;
    var st = document.createElement("span");
    st.className = "ssd-src-status" + (statusWarn ? " ssd-src-status--warn" : "");
    st.textContent = statusText;
    row.appendChild(dot);
    row.appendChild(nm);
    row.appendChild(st);
    return row;
  }


  var FIND_EXT_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>' +
    '<polyline points="15 3 21 3 21 9"></polyline>' +
    '<line x1="10" y1="14" x2="21" y2="3"></line></svg>';

  // Append the external-link glyph after a button's label
  function appendExtIcon(btn) {
    var ic = document.createElement("span");
    ic.className = "ssd-btn-icon";
    ic.innerHTML = FIND_EXT_SVG;
    btn.appendChild(ic);
    return btn;
  }


  // Native SceneCardGrid zoom formula:
  //   maxUsable = containerWidth - 30
  //   cols      = ceil(maxUsable / zoomWidths[zoom])
  //   cardWidth = maxUsable / cols - 10   (cards carry 5px margins → 10px gap)
  var ZOOM_WIDTHS = [280, 340, 480, 640];

  // Layout every rendered card grid (performer tab + discover page). Each
  // grid records its own zoom in data-zoom at render time, so one call —
  // including from the window resize handler — relayouts them all.
  function layoutCardGrid() {
    document.querySelectorAll(".ssd-card-grid").forEach(function (grid) {
      var zoom = parseInt(grid.getAttribute("data-zoom"), 10);
      if (isNaN(zoom)) zoom = _state.zoom;
      var maxUsable = Math.max(120, grid.clientWidth - 30);
      var cols = Math.max(1, Math.ceil(maxUsable / ZOOM_WIDTHS[zoom]));
      var cardW = maxUsable / cols - 10;
      var cards = grid.querySelectorAll(".scene-card");
      for (var i = 0; i < cards.length; i++) {
        cards[i].style.width = cardW + "px";
      }
    });
  }

  // ── List view — 1:1 native .table-list.scene-table (scene list table) ──
  // Structure captured from the native scenes page list mode; themes apply
  // automatically via native class names. No select-col (no bulk operations).
  function buildSceneTable(pageItems) {
    var wrap = document.createElement("div");
    wrap.className = "table-list scene-table ssd-scene-table";

    var table = document.createElement("table");
    table.className = "table table-striped table-bordered";

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    [
      ["cover_image", tc("封面图片", "Cover")],
      ["title", tc("标题", "Title")],
      ["date", tc("日期", "Date")],
      ["scene_code", tc("工作室代码", "Studio Code")],
      ["duration", tc("时长", "Duration")],
      ["studio", tc("工作室", "Studio")],
      ["performers", tc("演员", "Performers")],
      ["tags", tc("标签", "Tags")],
    ].forEach(function (col) {
      var th = document.createElement("th");
      th.className = col[0] + "-head";
      th.textContent = col[1];
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    var borderRow = document.createElement("tr");
    var borderTh = document.createElement("th");
    borderTh.className = "border-row";
    borderTh.colSpan = 100;
    borderRow.appendChild(borderTh);
    thead.appendChild(borderRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    pageItems.forEach(function (item) {
      tbody.appendChild(buildSceneRow(item));
    });
    table.appendChild(tbody);

    wrap.appendChild(table);
    return wrap;
  }

  function buildSceneRow(item) {
    var sc = item.scene;
    var tr = document.createElement("tr");

    // Cover — click opens the same detail modal as grid cards
    var coverTd = document.createElement("td");
    coverTd.className = "cover_image-data";
    var coverLink = document.createElement("a");
    coverLink.href = "javascript:void(0)";
    coverLink.onclick = function () { openModal(item); };
    if (item.images.length > 0) {
      var img = document.createElement("img");
      img.loading = "lazy";
      img.className = "image-thumbnail";
      img.alt = sc.title || sc.code || "";
      img.src = item.images[0].url;
      img.onerror = function () { this.style.visibility = "hidden"; };
      coverLink.appendChild(img);
    }
    coverTd.appendChild(coverLink);
    tr.appendChild(coverTd);

    // Title — opens the stash-box scene page in a new tab (does NOT open the modal)
    var titleTd = document.createElement("td");
    titleTd.className = "title-data";
    var titleLink = document.createElement("a");
    titleLink.href = boxSceneUrl(item.endpoint, sc.id);
    titleLink.target = "_blank";
    titleLink.rel = "noopener noreferrer";
    titleLink.title = sc.title || sc.code || "";
    var titleSpan = document.createElement("span");
    titleSpan.className = "ellips-data";
    titleSpan.textContent = sc.title || sc.code || tc("无标题", "Untitled");
    titleLink.appendChild(titleSpan);
    titleTd.appendChild(titleLink);
    tr.appendChild(titleTd);

    // Date / studio code / duration — plain cells
    var dateTd = document.createElement("td");
    dateTd.className = "date-data";
    dateTd.textContent = sc.release_date || "";
    tr.appendChild(dateTd);

    var codeTd = document.createElement("td");
    codeTd.className = "scene_code-data";
    codeTd.textContent = sc.code || "";
    tr.appendChild(codeTd);

    var durTd = document.createElement("td");
    durTd.className = "duration-data";
    durTd.textContent = sc.duration ? formatDuration(sc.duration) : "";
    tr.appendChild(durTd);

    // Studio — plain ellips-data (plugin rows have no filter-target pages)
    var studioTd = document.createElement("td");
    studioTd.className = "studio-data";
    if (sc.studio && sc.studio.name) {
      var studioSpan = document.createElement("span");
      studioSpan.className = "ellips-data";
      studioSpan.textContent = sc.studio.name;
      studioTd.appendChild(studioSpan);
    }
    tr.appendChild(studioTd);

    // Performers — native comma-list, plain <li><span> (no filter links)
    var perfTd = document.createElement("td");
    perfTd.className = "performers-data";
    var perfUl = document.createElement("ul");
    perfUl.className = "comma-list overflowable";
    (sc.performers || []).forEach(function (p) {
      var name = (p && p.performer && p.performer.name) || "";
      if (!name) return;
      var li = document.createElement("li");
      var span = document.createElement("span");
      span.textContent = name;
      li.appendChild(span);
      perfUl.appendChild(li);
    });
    perfTd.appendChild(perfUl);
    tr.appendChild(perfTd);

    // Tags — same comma-list structure
    var tagTd = document.createElement("td");
    tagTd.className = "tags-data";
    var tagUl = document.createElement("ul");
    tagUl.className = "comma-list overflowable";
    (sc.tags || []).forEach(function (t) {
      var name = (t && t.name) || "";
      if (!name) return;
      var li = document.createElement("li");
      var span = document.createElement("span");
      span.textContent = name;
      li.appendChild(span);
      tagUl.appendChild(li);
    });
    tagTd.appendChild(tagUl);
    tr.appendChild(tagTd);

    return tr;
  }

  // ctx (optional): view state override for the discover page —
  // { zoom, queryBoxes, localPerformerMaps }. Defaults to the performer tab's.
  function buildSceneCard(item, idx, ctx) {
    var st = ctx || _state;
    var sc = item.scene;

    // Native Stash grid-card structure (themes apply automatically):
    //   .scene-card.grid-card.card > .video-section (.scene-card-preview +
    //   .studio-overlay + .scene-specs-overlay) + .card-section (title/date/desc)
    var card = document.createElement("div");
    card.className = "scene-card zoom-" + st.zoom + " grid-card card ssd-scene-card";

    var videoSection = document.createElement("div");
    videoSection.className = "video-section thumbnail-section";

    var preview = document.createElement("div");
    preview.className = "scene-card-preview";

    if (item.images.length > 0) {
      var img = document.createElement("img");
      img.className = "scene-card-preview-image";
      img.loading = "lazy";
      img.src = item.images[0].url;
      img.alt = sc.title || sc.code || "";
      img.onerror = function () { this.style.visibility = "hidden"; };
      preview.appendChild(img);
    }

    // Box source pill — bottom-left corner (native has no fixed content there),
    // only meaningful with multiple stash-boxes
    if (st.queryBoxes.length > 1) {
      var boxBadge = document.createElement("span");
      boxBadge.className = "ssd-overlay-box";
      boxBadge.textContent = item.boxName;
      preview.appendChild(boxBadge);
    }

    // Preview pill for future-dated scenes — top-left corner
    if (sc.release_date && sc.release_date > localDateStr(new Date())) {
      var prevBadge = document.createElement("span");
      prevBadge.className = "ssd-overlay-preview";
      prevBadge.textContent = tc("预告", "Preview");
      preview.appendChild(prevBadge);
    }

    videoSection.appendChild(preview);

    // Studio name — top-right (native .studio-overlay)
    if (sc.studio && sc.studio.name) {
      var studioEl = document.createElement("div");
      studioEl.className = "studio-overlay";
      var studioLink = document.createElement("a");
      studioLink.href = "javascript:void(0)";
      studioLink.textContent = sc.studio.name;
      studioEl.appendChild(studioLink);
      videoSection.appendChild(studioEl);
    }

    // Duration — bottom-right (native .scene-specs-overlay)
    if (sc.duration) {
      var specs = document.createElement("div");
      specs.className = "scene-specs-overlay";
      var dur = document.createElement("span");
      dur.className = "overlay-duration";
      dur.textContent = formatDuration(sc.duration);
      specs.appendChild(dur);
      videoSection.appendChild(specs);
    }

    card.appendChild(videoSection);

    // Below cover: title / date / intro (native .card-section layout)
    var cardSection = document.createElement("div");
    cardSection.className = "card-section";

    var title = document.createElement("h5");
    title.className = "card-section-title flex-aligned";
    var titleText = document.createElement("div");
    titleText.className = "TruncatedText";
    titleText.style.setProperty("-webkit-line-clamp", "2");
    titleText.textContent = sc.title || sc.code || tc("无标题", "Untitled");
    title.appendChild(titleText);
    cardSection.appendChild(title);

    var details = document.createElement("div");
    details.className = "scene-card__details";

    if (sc.release_date) {
      var date = document.createElement("span");
      date.className = "scene-card__date";
      date.textContent = sc.release_date;
      details.appendChild(date);
    }

    if (sc.details) {
      var desc = document.createElement("div");
      desc.className = "TruncatedText scene-card__description";
      desc.style.setProperty("-webkit-line-clamp", "3");
      desc.textContent = sc.details;
      details.appendChild(desc);
    }

    cardSection.appendChild(details);

    // Native-style popover badges below the text: tag count + performer count
    var performers = (sc.performers || []).map(function (p) { return p.performer; }).filter(Boolean);
    var tags = (sc.tags || []).filter(Boolean);
    if (performers.length > 0 || tags.length > 0) {
      cardSection.appendChild(document.createElement("hr"));

      var popovers = document.createElement("div");
      popovers.setAttribute("role", "group");
      popovers.className = "card-popovers btn-group";

      if (tags.length > 0) {
        var tagCount = document.createElement("div");
        tagCount.className = "tag-count";
        var tagBtn = document.createElement("button");
        tagBtn.type = "button";
        tagBtn.className = "minimal btn btn-primary";
        tagBtn.title = tc("标签", "Tags");
        tagBtn.innerHTML = SSD_ICON_TAG + "<span>" + tags.length + "</span>";
        attachHoverPopover(tagBtn, function () { return buildTagPopoverContent(tags); });
        tagCount.appendChild(tagBtn);
        popovers.appendChild(tagCount);
      }

      if (performers.length > 0) {
        var perfCount = document.createElement("div");
        perfCount.className = "performer-count";
        var perfBtn = document.createElement("button");
        perfBtn.type = "button";
        perfBtn.className = "minimal btn btn-primary";
        perfBtn.title = tc("演员", "Performers");
        perfBtn.innerHTML = SSD_ICON_USER + "<span>" + performers.length + "</span>";
        attachHoverPopover(perfBtn, function () {
          return buildPerformerPopoverContent(performers, item.endpoint, st.localPerformerMaps);
        });
        perfCount.appendChild(perfBtn);
        popovers.appendChild(perfCount);
      }

      cardSection.appendChild(popovers);
    }

    card.appendChild(cardSection);

    card.onclick = function () { openModal(item); };
    return card;
  }

  // ─── Hover popovers on card badges (mimics native .hover-popover-content) ──

  var SSD_ICON_TAG =
    '<svg data-prefix="fas" data-icon="tag" class="svg-inline--fa fa-tag fa-icon" role="img" viewBox="0 0 512 512" aria-hidden="true">' +
    '<path fill="currentColor" d="M32.5 96l0 149.5c0 17 6.7 33.3 18.7 45.3l192 192c25 25 65.5 25 90.5 0L483.2 333.3c25-25 25-65.5 0-90.5l-192-192C279.2 38.7 263 32 246 32L96.5 32c-35.3 0-64 28.7-64 64zm112 16a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"></path></svg>';
  var SSD_ICON_USER =
    '<svg data-prefix="fas" data-icon="user" class="svg-inline--fa fa-user fa-icon" role="img" viewBox="0 0 448 512" aria-hidden="true">' +
    '<path fill="currentColor" d="M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z"></path></svg>';

  // Show a hover-only popover under `el`; `buildContent()` returns a Node.
  // The popover is hoverable (mouse can rest on it without hiding) but fully
  // inert — clicks are swallowed so the scene modal never opens.
  function attachHoverPopover(el, buildContent) {
    var pop = null;
    var hideTimer = null;

    function show() {
      clearTimeout(hideTimer);
      if (pop && pop.parentNode) return;
      pop = document.createElement("div");
      pop.className = "popover hover-popover-content bs-popover-bottom show";
      pop.setAttribute("role", "tooltip");
      // Hoverable so the popover stays visible while the mouse is on it,
      // but no interaction is possible (display-only, never clickable)
      pop.style.pointerEvents = "auto";
      pop.style.cursor = "default";
      var arrow = document.createElement("div");
      arrow.className = "arrow";
      // Bootstrap's .arrow has no `left` and `margin: 0 .5rem` → it sits on
      // the left edge; center it on the popover's top edge instead
      arrow.style.left = "50%";
      arrow.style.margin = "0";
      arrow.style.transform = "translateX(-50%)";
      pop.appendChild(arrow);
      // Native hover popovers wrap content in .popover-body (padding, themed text)
      var body = document.createElement("div");
      body.className = "popover-body";
      body.appendChild(buildContent());
      pop.appendChild(body);
      document.body.appendChild(pop);

      var r = el.getBoundingClientRect();
      var pw = pop.offsetWidth;
      var left = r.left + r.width / 2 - pw / 2 + window.scrollX;
      left = Math.max(8, Math.min(left,
        window.scrollX + document.documentElement.clientWidth - pw - 8));
      pop.style.left = left + "px";
      pop.style.top = (r.bottom + window.scrollY + 6) + "px";

      // Keep the popover open while the mouse rests on it; the 150ms grace
      // period in hide() covers the badge → popover crossing
      pop.addEventListener("mouseenter", function () { clearTimeout(hideTimer); });
      pop.addEventListener("mouseleave", hide);
      pop.addEventListener("click", function (e) { e.stopPropagation(); });
    }

    function hide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
        pop = null;
      }, 150);
    }

    el.addEventListener("mouseenter", show);
    el.addEventListener("mouseleave", hide);
    // Badge clicks must not open the scene modal
    el.addEventListener("click", function (e) { e.stopPropagation(); });
  }

  function buildTagPopoverContent(tags) {
    var frag = document.createDocumentFragment();
    tags.forEach(function (t) {
      var span = document.createElement("span");
      span.className = "tag-item tag-link badge badge-secondary";
      span.textContent = t.name || "";
      frag.appendChild(span);
    });
    return frag;
  }

  function buildPerformerPopoverContent(performers, endpoint, localMaps) {
    var frag = document.createDocumentFragment();
    var localMap = (localMaps || _state.localPerformerMaps || {})[(endpoint || "").toLowerCase()] || {};

    var local = [];
    var remote = [];
    performers.forEach(function (p) {
      var lp = localMap[String(p.id).toLowerCase()];
      if (lp) local.push({ p: p, lp: lp });
      else remote.push(p);
    });

    function localRow(p, lp) {
      var row = document.createElement("div");
      row.className = "performer-tag-container row";
      var imgWrap = document.createElement("div");
      imgWrap.className = "performer-tag col m-auto zoom-2";
      var img = document.createElement("img");
      img.className = "image-thumbnail";
      img.alt = p.name || "";
      img.src = "/performer/" + lp.id + "/image";
      imgWrap.appendChild(img);
      row.appendChild(imgWrap);
      var name = document.createElement("span");
      name.className = "tag-item tag-link d-block badge badge-secondary";
      name.textContent = p.name || "";
      row.appendChild(name);
      return row;
    }

    function remoteRow(p) {
      var name = document.createElement("span");
      // No d-block: names flow side by side like the native tag popover badges
      name.className = "tag-item tag-link badge badge-secondary";
      name.textContent = p.name || "";
      return name;
    }

    // Local performers first (avatar + name), then non-local (name only)
    local.forEach(function (x) { frag.appendChild(localRow(x.p, x.lp)); });
    remote.forEach(function (p) { frag.appendChild(remoteRow(p)); });
    return frag;
  }

  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return "";
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    if (h > 0) return h + ":" + pad(m) + ":" + pad(s);
    return m + ":" + pad(s);
  }

  // ─── Modal ────────────────────────────────────────────────────────────────

  var _modalEl = null;
  var _carouselIdx = 0;
  var _modalImages = []; // current open modal's image URL list (cover + DMM shots)
  var _modalGalleryDone = false;
  var _searchPage = 1;
  var _searchPerPage = 20;
  var _searchResults = [];

  function openModal(item) {
    _state.modal = item;
    _state.modalDetail = null;
    _state.modalLoading = true;
    hidePerformerCard();
    _carouselIdx = 0;
    _modalImages = (item.images || []).map(function (i) { return i.url; });
    _modalGalleryDone = false;
    _searchPage = 1;
    _searchResults = [];
    buildModal(item);

    // Fetch full detail in background
    fetchBoxSceneDetail(item.box, item.scene.id).then(function (detail) {
      if (detail) {
        _state.modalDetail = detail;
        _state.modalLoading = false;
        updateModalDetail(detail);
        // Then probe DMM for screenshots (box images only carry the cover)
        probeModalGallery(detail, item);
      } else {
        _state.modalLoading = false;
      }
    }).catch(function (e) {
      console.warn("[SSD] scene detail fetch failed:", e);
      _state.modalLoading = false;
    });
  }

  function closeModal() {
    hidePerformerCard();
    if (_modalEl) { _modalEl.remove(); _modalEl = null; }
    _state.modal = null;
    _state.modalDetail = null;
    _state.modalLoading = false;
  }

  function buildModal(item) {
    if (_modalEl) _modalEl.remove();

    var overlay = document.createElement("div");
    overlay.className = "ssd-modal-overlay";
    overlay.onclick = function (e) { if (e.target === overlay) closeModal(); };

    var modal = document.createElement("div");
    modal.className = "ssd-modal";

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "ssd-modal-close";
    closeBtn.innerHTML = "&times;";
    closeBtn.onclick = closeModal;
    modal.appendChild(closeBtn);

    // Section 1: Carousel (cover + screenshots)
    var carouselSection = document.createElement("div");
    carouselSection.className = "ssd-modal-section";
    carouselSection.style.padding = "0";
    carouselSection.appendChild(buildCarousel(_modalImages, item.scene));
    modal.appendChild(carouselSection);

    // Section 2: Action buttons
    var actionSection = document.createElement("div");
    actionSection.className = "ssd-modal-section";
    var btnRow = document.createElement("div");
    btnRow.className = "ssd-action-row";

    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ssd-btn ssd-btn-primary ssd-btn-lg";
    saveBtn.textContent = tc("加入库", "Add to Library");
    saveBtn.onclick = function () { handleSaveScene(item, saveBtn); };
    btnRow.appendChild(saveBtn);

    var openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "ssd-btn ssd-btn-secondary ssd-btn-lg";
    openBtn.textContent = brandNameForEndpoint(item.endpoint);
    appendExtIcon(openBtn);
    openBtn.setAttribute("data-ssd-open-btn", "");
    openBtn.onclick = function () { handleOpenInBox(item); };
    btnRow.appendChild(openBtn);

    var searchBtn = document.createElement("button");
    searchBtn.type = "button";
    searchBtn.className = "ssd-btn ssd-btn-accent ssd-btn-lg";
    searchBtn.textContent = tc("搜索资源", "Search Resources");
    searchBtn.onclick = function () { handleSearchResources(item, searchBtn); };
    btnRow.appendChild(searchBtn);

    actionSection.appendChild(btnRow);
    modal.appendChild(actionSection);

    // Section 3: Details (placeholder — filled by updateModalDetail)
    var details = document.createElement("div");
    details.className = "ssd-modal-section";
    details.setAttribute("data-ssd-details", "");
    renderDetailsInto(details, item.scene, item);
    modal.appendChild(details);

    // Section 4: Search results
    var searchSection = document.createElement("div");
    searchSection.className = "ssd-modal-section";
    searchSection.setAttribute("data-ssd-search", "");
    modal.appendChild(searchSection);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    _modalEl = overlay;

    updateOpenButtonLabel(item);

    document.addEventListener("keydown", function onEsc(e) {
      if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", onEsc); }
    });
  }

  function updateOpenButtonLabel(item) {
    var btn = document.querySelector("[data-ssd-open-btn]");
    if (!btn) return;
    var brand = brandNameForEndpoint(item.endpoint);
    // textContent wipes any children, so the trailing glyph has to be rebuilt
    // every time the label changes (otherwise the icon is silently dropped)
    btn.textContent = brand;
    appendExtIcon(btn);
  }

  // ─── DMM gallery screenshot probing ──────────────────────────────────────
  // stash-box scenes only carry the cover in images[]; screenshots live on the
  // DMM CDN. contentId comes from the r18.dev URL in scene.urls (only reliable
  // source — some labels can't be derived from the code).
  var DMM_GALLERY_BASE = "https://awsimgsrc.dmm.com/dig/digital/video";
  var R18_JSON_BASE = "https://r18.dev/videos/vod/movies/detail/-/combined";
  var DMM_MAX_IMAGES = 60;
  var DMM_PROBE_BATCH = 6;
  var DMM_CONFIRM_BATCH = 3;
  var _dmmGalleryCache = {}; // contentId -> Promise<string[]>

  function contentIdFromR18Url(url) {
    var m = String(url || "").match(
      /r18\.dev\/videos\/vod\/movies\/detail\/-\/id=([A-Za-z0-9]+)/
    );
    return m ? m[1] : null;
  }

  function deriveContentId(code) {
    if (!code) return null;
    var m = String(code).trim().match(/^([A-Za-z]{2,10})-(\d{2,6})$/);
    if (!m) return null;
    return padDmmContentId(m[1] + m[2]);
  }

  // DMM content ids zero-pad the numeric part to 5 digits ("OFJE-614" →
  // "ofje00614"). r18.dev ids drop that padding, and an unpadded id makes every
  // CDN shot number resolve to DMM's 90px "no image" placeholder.
  function padDmmContentId(id) {
    var m = String(id || "").match(/^([A-Za-z]+)(\d+)$/);
    return m ? m[1].toLowerCase() + m[2].padStart(5, "0") : String(id || "");
  }

  function dmmGalleryUrl(contentId, n) {
    return DMM_GALLERY_BASE + "/" + contentId + "/" + contentId + "jp-" + n + ".jpg";
  }

  // r18's gallery entries point at "<host>/<dir>/<cid>(jp)?-<n>.jpg" — the real
  // full-size shots are always "<host>/<dir>/<cid>jp-<n>.jpg" beside them, while
  // the id r18 was queried with is not reliable (r18 drops the CDN's zero
  // padding: "ofje614" resolves every shot to DMM's 90px placeholder). So rebuild
  // each shot from the entry's own directory + content id + number, which keeps
  // the host/path right for every service and always carries the padding.
  // Returns "" when the entry carries no shot name to work from.
  function dmmShotUrl(entry) {
    var u = String((entry && (entry.image_full || entry.image_thumb)) || "");
    var m = u.match(/^(.*\/)(.+?)(?:jp)?-(\d+)\.jpg(\?.*)?$/i);
    if (!m) return "";
    return m[1] + m[2] + "jp-" + m[3] + ".jpg" + (m[4] || "");
  }

  // Primary: r18.dev JSON returns gallery[] in one request (CORS *).
  function fetchDmmGalleryJson(contentId) {
    var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    return fetch(R18_JSON_BASE + "=" + contentId + "/json",
      ctrl ? { signal: ctrl.signal } : {})
      .then(function (res) { if (!res.ok) return null; return res.json(); })
      .then(function (data) {
        if (timer) clearTimeout(timer);
        var gallery = data && data.gallery;
        if (!Array.isArray(gallery) || gallery.length === 0) return null;
        var urls = [];
        for (var i = 0; i < gallery.length; i++) {
          var shot = dmmShotUrl(gallery[i]);
          if (shot) urls.push(shot);
        }
        // Nothing derivable → let the enumeration fallback probe the CDN instead
        return urls.length ? urls : null;
      })
      .catch(function () { if (timer) clearTimeout(timer); return null; });
  }

  // Single-image probe via Image(); DMM returns a 90px placeholder with HTTP 200
  // for missing numbers, so filter by natural dimensions (real shots ≥300px).
  function probeDmmImage(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      var done = false;
      var timer = setTimeout(function () {
        if (done) return; done = true;
        img.src = ""; resolve(false);
      }, 10000);
      img.onload = function () {
        if (done) return; done = true;
        clearTimeout(timer);
        resolve(img.naturalWidth >= 300 && img.naturalHeight >= 200);
      };
      img.onerror = function () {
        if (done) return; done = true;
        clearTimeout(timer); resolve(false);
      };
      img.src = url;
    });
  }

  // Fallback: enumerate {id}jp-N.jpg in adaptive batches.
  function probeDmmByEnumeration(contentId, onImage) {
    var found = [];
    var n = 1;
    var batch = DMM_PROBE_BATCH;
    function step() {
      if (n > DMM_MAX_IMAGES) return Promise.resolve(found);
      var nums = [];
      for (var k = 0; k < batch && n + k <= DMM_MAX_IMAGES; k++) nums.push(n + k);
      return Promise.all(nums.map(function (num) {
        return probeDmmImage(dmmGalleryUrl(contentId, num)).then(function (ok) {
          return { num: num, ok: ok };
        });
      })).then(function (results) {
        var anyOk = false, anyMiss = false;
        results.forEach(function (r) {
          if (r.ok) {
            anyOk = true;
            var u = dmmGalleryUrl(contentId, r.num);
            found.push(u);
            if (onImage) onImage(u);
          } else {
            anyMiss = true;
          }
        });
        if (!anyOk) return found;
        batch = anyMiss ? DMM_CONFIRM_BATCH : DMM_PROBE_BATCH;
        n += nums.length;
        return step();
      });
    }
    return step();
  }

  // Two-channel probe with session cache.
  function probeDmmGallery(contentId, onImage) {
    if (_dmmGalleryCache[contentId]) return _dmmGalleryCache[contentId];
    // The enumeration fallback hits the CDN path directly, which keeps the zero
    // padding r18 dropped. It size-filters every candidate, so a wrong padding
    // guess can only lose shots — it can never add placeholder slides.
    var dmmId = padDmmContentId(contentId);
    var p = fetchDmmGalleryJson(contentId).then(function (viaJson) {
      if (viaJson && viaJson.length) return viaJson;
      return probeDmmByEnumeration(dmmId, onImage);
    });
    _dmmGalleryCache[contentId] = p;
    return p;
  }

  // images: array of URL strings (lazy-loaded, only the current one is fetched)
  function buildCarousel(images, sc) {
    var carousel = document.createElement("div");
    carousel.className = "ssd-carousel";
    carousel.setAttribute("data-ssd-carousel", "");

    if (images.length > 0) {
      if (_carouselIdx >= images.length) _carouselIdx = 0;
      var startIdx = _carouselIdx;
      var hero = document.createElement("div");
      hero.className = "ssd-carousel-hero";
      hero.setAttribute("data-ssd-carousel-hero", "");
      // Lazy: only load current image; honor current index so
      // progressive gallery remounts don't snap the viewer back to the cover.
      hero.style.backgroundImage = "url('" + images[startIdx] + "')";

      // Always show nav buttons (disabled when only 1 image); gallery probe may add more
      var prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "ssd-carousel-nav ssd-carousel-prev";
      prevBtn.innerHTML = "&#10094;";
      prevBtn.disabled = images.length <= 1;
      prevBtn.onclick = function (e) {
        e.stopPropagation();
        if (images.length <= 1) return;
        _carouselIdx = (_carouselIdx - 1 + images.length) % images.length;
        updateCarouselImage(images);
      };
      hero.appendChild(prevBtn);

      var nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "ssd-carousel-nav ssd-carousel-next";
      nextBtn.innerHTML = "&#10095;";
      nextBtn.disabled = images.length <= 1;
      nextBtn.onclick = function (e) {
        e.stopPropagation();
        if (images.length <= 1) return;
        _carouselIdx = (_carouselIdx + 1) % images.length;
        updateCarouselImage(images);
      };
      hero.appendChild(nextBtn);

      var counter = document.createElement("span");
      counter.className = "ssd-carousel-counter";
      counter.setAttribute("data-ssd-counter", "");
      counter.textContent = (startIdx + 1) + " / " + images.length;
      hero.appendChild(counter);

      carousel.appendChild(hero);
    } else {
      var noImg = document.createElement("div");
      noImg.className = "ssd-carousel-hero-empty";
      noImg.textContent = tc("无封面图片", "No cover image");
      carousel.appendChild(noImg);
    }
    return carousel;
  }

  function updateCarouselImage(images) {
    var hero = document.querySelector("[data-ssd-carousel-hero]");
    if (hero && images[_carouselIdx]) {
      // Load image on demand — browser fetches only when backgroundImage is set
      hero.style.backgroundImage = "url('" + images[_carouselIdx] + "')";
    }
    var counter = document.querySelector("[data-ssd-counter]");
    if (counter) counter.textContent = (_carouselIdx + 1) + " / " + images.length;
  }

  // Replace the mounted carousel with one built from _modalImages, preserving
  // the viewed index (clamped). Used after detail load and gallery probing.
  function remountCarousel() {
    var oldCarousel = document.querySelector("[data-ssd-carousel]");
    if (!oldCarousel) return;
    if (_carouselIdx >= _modalImages.length) _carouselIdx = 0;
    var fresh = buildCarousel(_modalImages, _state.modal && _state.modal.scene);
    oldCarousel.parentNode.replaceChild(fresh, oldCarousel);
  }

  // After detail loads, probe DMM for screenshots and merge into the carousel.
  function probeModalGallery(detail, item) {
    if (_modalGalleryDone) return;
    _modalGalleryDone = true;

    // Seed with box detail images (cover)
    var boxUrls = (detail.images || []).map(function (i) { return i.url; }).filter(Boolean);
    if (boxUrls.length) {
      _modalImages = dedupeUrls(boxUrls);
      remountCarousel();
    }

    var sc = detail.scene || {};
    var contentId = null;
    (sc.urls || []).forEach(function (u) {
      if (!contentId && u.url) contentId = contentIdFromR18Url(u.url);
    });
    if (!contentId) contentId = deriveContentId(sc.code);
    if (!contentId) return; // non-DMM scene: box cover is all we have

    // Progressive merge (enumeration path reports each shot as found)
    var onImage = function (url) {
      if (!_state.modal) return; // modal closed
      if (_modalImages.indexOf(url) === -1) {
        _modalImages.push(url);
        remountCarousel();
      }
    };

    probeDmmGallery(contentId, onImage).then(function (galleryUrls) {
      if (!_state.modal) return;
      var merged = dedupeUrls(_modalImages.concat(galleryUrls || []));
      var changed = merged.length !== _modalImages.length;
      _modalImages = merged;
      if (changed) remountCarousel();
    }).catch(function (e) {
      console.warn("[SSD] DMM gallery probe failed:", e);
    });
  }

  function dedupeUrls(urls) {
    var seen = {};
    var out = [];
    urls.forEach(function (u) {
      if (u && !seen[u]) { seen[u] = 1; out.push(u); }
    });
    return out;
  }

  function updateModalDetail(detail) {
    var details = document.querySelector("[data-ssd-details]");
    if (!details || !_state.modal) return;
    renderDetailsInto(details, detail.scene, _state.modal);
    // Carousel (cover + DMM screenshots) is handled by probeModalGallery().
  }

  function renderDetailsInto(container, sc, item) {
    container.innerHTML = "";

    // Title
    if (sc.title || sc.code) {
      var dTitle = document.createElement("h3");
      dTitle.className = "ssd-modal-title";
      dTitle.textContent = sc.title || sc.code;
      container.appendChild(dTitle);
    }

    // Meta grid
    var metaGrid = document.createElement("div");
    metaGrid.className = "ssd-meta-grid";
    if (sc.code) {
      var codeItem = buildMetaItem(tc("番号", "Code"), sc.code);
      codeItem.className += " ssd-code-copyable";
      // Click the whole item to copy; a brief text color change is the only
      // feedback — no toast text, no animation
      codeItem.addEventListener("click", function () {
        var flashCopied = function () {
          codeItem.classList.add("ssd-copied");
          clearTimeout(codeItem._copyT);
          codeItem._copyT = setTimeout(function () {
            codeItem.classList.remove("ssd-copied");
          }, 800);
        };
        var fallbackCopy = function () {
          var ta = document.createElement("textarea");
          ta.value = sc.code;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          flashCopied();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(sc.code).then(flashCopied, fallbackCopy);
        } else {
          fallbackCopy();
        }
      });
      metaGrid.appendChild(codeItem);
    }
    if (sc.release_date) metaGrid.appendChild(buildMetaItem(tc("发行日期", "Release Date"), sc.release_date));
    if (sc.production_date) metaGrid.appendChild(buildMetaItem(tc("制作日期", "Production Date"), sc.production_date));
    if (sc.duration) metaGrid.appendChild(buildMetaItem(tc("时长", "Duration"), formatDuration(sc.duration)));
    if (sc.director) metaGrid.appendChild(buildMetaItem(tc("导演", "Director"), sc.director));
    if (sc.studio && sc.studio.name) metaGrid.appendChild(buildMetaItem(tc("工作室", "Studio"), sc.studio.name));
    metaGrid.appendChild(buildMetaItem(tc("来源", "Source"), item.boxName));
    container.appendChild(metaGrid);

    // Performers as pills (click → floating avatar card → stash-box page)
    if (sc.performers && sc.performers.length > 0) {
      var perfRow = document.createElement("div");
      perfRow.className = "ssd-detail-row";
      var perfLabel = document.createElement("span");
      perfLabel.className = "ssd-detail-label";
      perfLabel.textContent = tc("演员", "Performers");
      perfRow.appendChild(perfLabel);
      var perfPills = document.createElement("div");
      perfPills.className = "ssd-pill-row";
      sc.performers.forEach(function (p) {
        var pf = p.performer;
        if (!pf || !pf.name) return;
        // Clickable → solid button (interactive = solid; transparent is
        // reserved for non-clickable badges like the tags below)
        var pill = document.createElement("button");
        pill.type = "button";
        pill.className = "ssd-btn ssd-btn-sm ssd-btn-info ssd-pill-performer";
        pill.title = pf.name;
        var pillText = document.createElement("span");
        pillText.className = "ssd-pill-text";
        pillText.textContent = pf.name;
        pill.appendChild(pillText);
        pill.addEventListener("click", function (e) {
          e.stopPropagation();
          showPerformerCard(pill, item, pf);
        });
        perfPills.appendChild(pill);
      });
      perfRow.appendChild(perfPills);
      container.appendChild(perfRow);
    }

    // Tags as pills
    if (sc.tags && sc.tags.length > 0) {
      var tagRow = document.createElement("div");
      tagRow.className = "ssd-detail-row";
      var tagLabel = document.createElement("span");
      tagLabel.className = "ssd-detail-label";
      tagLabel.textContent = tc("标签", "Tags");
      tagRow.appendChild(tagLabel);
      var tagPills = document.createElement("div");
      tagPills.className = "ssd-pill-row";
      sc.tags.forEach(function (t) {
        if (!t.name) return;
        var pill = document.createElement("span");
        pill.className = "ssd-pill";
        pill.textContent = t.name;
        tagPills.appendChild(pill);
      });
      tagRow.appendChild(tagPills);
      container.appendChild(tagRow);
    }

    // Synopsis — full display, no inner scroll (modal body scrolls)
    if (sc.details) {
      var synopsis = document.createElement("div");
      synopsis.className = "ssd-detail-row";
      var synLabel = document.createElement("span");
      synLabel.className = "ssd-detail-label";
      synLabel.textContent = tc("简介", "Synopsis");
      synopsis.appendChild(synLabel);
      var synText = document.createElement("div");
      synText.className = "ssd-synopsis-text";
      synText.textContent = sc.details;
      synopsis.appendChild(synText);
      container.appendChild(synopsis);
    }

    // URLs
    if (sc.urls && sc.urls.length > 0) {
      var urlRow = document.createElement("div");
      urlRow.className = "ssd-detail-row";
      var urlLabel = document.createElement("span");
      urlLabel.className = "ssd-detail-label";
      urlLabel.textContent = tc("链接", "URLs");
      urlRow.appendChild(urlLabel);
      var urlWrap = document.createElement("div");
      urlWrap.style.marginTop = "4px";
      sc.urls.forEach(function (u) {
        if (!u.url) return;
        var a = document.createElement("a");
        a.href = u.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.className = "ssd-detail-link";
        a.textContent = (u.site && u.site.name) ? u.site.name : u.url;
        a.title = u.url;
        urlWrap.appendChild(a);
      });
      urlRow.appendChild(urlWrap);
      container.appendChild(urlRow);
    }
  }

  function buildMetaItem(label, value) {
    var item = document.createElement("div");
    item.className = "ssd-meta-item";
    var l = document.createElement("div");
    l.className = "ssd-meta-label";
    l.textContent = label;
    var v = document.createElement("div");
    v.className = "ssd-meta-value";
    v.textContent = value;
    item.appendChild(l);
    item.appendChild(v);
    return item;
  }

  // ─── Floating performer avatar card ──────────────────────────────────────
  // Click a performer pill → avatar card pops above it. Click the card → open
  // the stash-box performer page; click anywhere else (or scroll) → dismiss.

  var _performerCardEl = null;

  function hidePerformerCard() {
    if (_performerCardEl) { _performerCardEl.remove(); _performerCardEl = null; }
    document.removeEventListener("click", hidePerformerCard);
    var modalEl = document.querySelector(".ssd-modal");
    if (modalEl) modalEl.removeEventListener("scroll", hidePerformerCard);
  }

  function showPerformerCard(pill, item, performer) {
    if (!pill.isConnected) return;
    // Toggle: clicking the pill of a mounted card closes it
    if (_performerCardEl && _performerCardEl._ssdPill === pill) { hidePerformerCard(); return; }
    hidePerformerCard();

    // Local performer avatar when mapped (fast, internal); box image otherwise
    var localMap = (_state.localPerformerMaps || {})[(item.endpoint || "").toLowerCase()] || {};
    var lp = localMap[String(performer.id).toLowerCase()];
    var imgSrc = lp ? ("/performer/" + lp.id + "/image")
      : (((performer.images || [])[0] || {}).url || "");

    // Mount immediately with a fixed-size portrait skeleton (instant feedback);
    // the avatar loads inside the fixed 80x120 frame, so the card size never
    // changes and the mount position is always correct.
    mountPerformerCard(pill, item, performer, lp, imgSrc);
  }

  function mountPerformerCard(pill, item, performer, lp, imgSrc) {
    var boxPerformerUrl = boxWebBase(item.endpoint) + "/performers/" + performer.id;

    var card = document.createElement("div");
    card.className = "ssd-performer-card";
    card.title = tc("在新标签页打开演员页", "Open performer page in a new tab");
    card._ssdPill = pill;
    card.addEventListener("click", function (e) {
      e.stopPropagation();
      window.open(boxPerformerUrl, "_blank", "noopener,noreferrer");
      hidePerformerCard();
    });

    // Avatar with corner overlays: age bottom-left, country flag bottom-right
    var wrap = document.createElement("div");
    wrap.className = "ssd-perf-avatar-wrap";
    if (imgSrc) {
      var img = document.createElement("img");
      img.className = "ssd-perf-avatar";
      img.alt = "";
      wrap.classList.add("is-loading");
      img.onload = img.onerror = function () { wrap.classList.remove("is-loading"); };
      img.src = imgSrc;
      wrap.appendChild(img);
    }
    var ageEl = document.createElement("span");
    ageEl.className = "ssd-perf-badge ssd-perf-age";
    ageEl.style.display = "none";
    wrap.appendChild(ageEl);
    var flagEl = document.createElement("span");
    flagEl.className = "ssd-perf-badge ssd-perf-flag";
    flagEl.style.display = "none";
    wrap.appendChild(flagEl);
    card.appendChild(wrap);

    document.body.appendChild(card);
    // Position above the pill, centered; flip below when there is no room
    var r = pill.getBoundingClientRect();
    var cw = card.offsetWidth, ch = card.offsetHeight;
    var left = Math.max(8, Math.min(r.left + r.width / 2 - cw / 2, window.innerWidth - cw - 8));
    var top = r.top - ch - 8;
    if (top < 8) top = r.bottom + 8;
    // Keep the card inside the viewport even when the pill sits near the
    // bottom edge (flipped-below placement would overflow)
    if (top + ch > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ch - 8);
    card.style.left = left + "px";
    card.style.top = top + "px";

    _performerCardEl = card;
    // Dismiss on outside click / modal scroll (the card is fixed-positioned
    // and would drift if the modal scrolls under it)
    document.addEventListener("click", hidePerformerCard);
    var modalEl = document.querySelector(".ssd-modal");
    if (modalEl) modalEl.addEventListener("scroll", hidePerformerCard);

    // Age + country are fetched on demand (async, backfilled when ready)
    fetchPerformerAgeCountry(item, performer, lp).then(function (info) {
      if (_performerCardEl !== card || !info) return; // card closed/replaced meanwhile
      if (info.age) {
        ageEl.textContent = tc(info.age + " 岁", info.age + "yo");
        ageEl.style.display = "";
      }
      var cc = String(info.country || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
      if (cc) {
        flagEl.style.display = "";
        var flagImg = document.createElement("img");
        flagImg.src = "https://flagcdn.com/w40/" + cc.toLowerCase() + ".png";
        flagImg.alt = cc;
        flagImg.onerror = function () {
          // Network/CSP fallback: show the country code text instead
          flagEl.textContent = cc;
          flagImg.remove();
        };
        flagEl.appendChild(flagImg);
      }
    });
  }

  function fetchPerformerAgeCountry(item, performer, lp) {
    var fallback = { age: "", country: "" };
    if (lp) {
      // Local performer stores birthdate/country (no direct age field)
      return callGQL(
        "query($id:ID!){findPerformer(id:$id){id birthdate country}}",
        { id: lp.id }
      ).then(function (d) {
        var p = (d && d.findPerformer) || {};
        return { age: birthDateToAge(p.birthdate), country: p.country || "" };
      }).catch(function () { return fallback; });
    }
    // Box performer: derive age from birth_date
    return _boxRateLimiter.submit(function () {
      return callBoxGQL(
        item.endpoint, item.box.api_key,
        "query($id:ID!){findPerformer(id:$id){id birth_date country}}",
        { id: performer.id }
      );
    }).then(function (d) {
      var p = (d && d.findPerformer) || {};
      return { age: birthDateToAge(p.birth_date), country: p.country || "" };
    }).catch(function () { return fallback; });
  }

  function birthDateToAge(birthDate) {
    if (!birthDate) return "";
    var b = new Date(birthDate);
    if (isNaN(b.getTime())) return "";
    var now = new Date();
    var age = now.getFullYear() - b.getFullYear();
    var m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
    return age >= 0 && age < 130 ? String(age) : "";
  }

  // ─── Action: Add to Library (map performers/studio by stash_id) ──────────

  function handleSaveScene(item, btn) {
    // Two-step confirm to prevent misclicks: first click arms the button,
    // second click within 4s executes; otherwise it reverts.
    if (btn.getAttribute("data-ssd-armed") !== "1") {
      btn.setAttribute("data-ssd-armed", "1");
      btn.classList.add("ssd-btn-danger");
      btn.textContent = tc("确认加入库？", "Confirm add?");
      clearTimeout(btn._ssdArmTimer);
      btn._ssdArmTimer = setTimeout(function () {
        if (!btn.isConnected) return;
        btn.removeAttribute("data-ssd-armed");
        btn.classList.remove("ssd-btn-danger");
        btn.textContent = tc("加入库", "Add to Library");
      }, 4000);
      return;
    }
    clearTimeout(btn._ssdArmTimer);
    btn.removeAttribute("data-ssd-armed");
    btn.classList.remove("ssd-btn-danger");

    var sc = _state.modalDetail ? _state.modalDetail.scene : item.scene;
    btn.disabled = true;
    btn.textContent = tc("加入中...", "Adding...");

    var endpoint = item.endpoint;

    // Map all performers from box to local IDs by stash_id
    var perfMapPromise = buildLocalPerformerStashIdMap(endpoint).then(function (map) {
      var ids = [];
      (sc.performers || []).forEach(function (p) {
        if (p.performer && p.performer.id) {
          var localP = map[String(p.performer.id).toLowerCase()];
          if (localP) ids.push(localP.id);
        }
      });
      // Ensure current performer is included even if stash_id mapping misses.
      // Discover-page items (item._dp) have no "current performer" — the
      // scene's own cast mapping is the only attribution source there.
      if (!item._dp && _state.performerId && ids.indexOf(_state.performerId) === -1) {
        ids.push(_state.performerId);
      }
      return ids;
    });

    // Map studio by stash_id
    var studioPromise = Promise.resolve(null);
    if (sc.studio && sc.studio.id) {
      studioPromise = findLocalStudioByStashId(endpoint, sc.studio.id).then(function (id) {
        if (id) return id;
        // Fallback: find or create by name
        return findOrCreateStudio(sc.studio.name);
      });
    } else if (sc.studio && sc.studio.name) {
      studioPromise = findOrCreateStudio(sc.studio.name);
    }

    // Find or create tags
    var tagIdsPromise = Promise.resolve([]);
    if (sc.tags && sc.tags.length > 0) {
      tagIdsPromise = Promise.all(sc.tags.map(function (t) {
        return findOrCreateTag(t.name);
      })).then(function (ids) { return ids.filter(Boolean); });
    }

    Promise.all([perfMapPromise, studioPromise, tagIdsPromise]).then(function (results) {
      var performerIds = results[0];
      var studioId = results[1];
      var tagIds = results[2];

      var boxWebUrl = boxSceneUrl(endpoint, sc.id);
      // SceneCreateInput.urls is a string array (no URLInput objects)
      var urls = [boxWebUrl];
      (sc.urls || []).forEach(function (u) { if (u.url) urls.push(u.url); });

      var input = {
        title: sc.title || undefined,
        code: sc.code || undefined,
        details: sc.details || undefined,
        date: sc.release_date || undefined,
        urls: urls,
        performer_ids: performerIds,
        tag_ids: tagIds,
        // stash_ids is accepted by SceneCreateInput — no
        // second sceneUpdate round-trip needed
        stash_ids: [{ endpoint: endpoint, stash_id: String(sc.id) }],
      };
      if (studioId) input.studio_id = studioId;
      if (sc.director) input.director = sc.director;

      var coverUrl = (item.images[0] || {}).url || "";
      if (coverUrl) input.cover_image = coverUrl;

      return callGQL(
        "mutation($input:SceneCreateInput!){sceneCreate(input:$input){id title code}}",
        { input: input }
      ).then(function (data) {
        var created = data && data.sceneCreate;
        if (!created || !created.id) throw new Error(tc("创建返回空结果", "Create returned empty result"));
        return created;
      });
    }).then(function (created) {
      if (created && created.id) {
        btn.textContent = tc("已加入 ✓", "Added ✓");
        btn.classList.add("ssd-btn-success");
        if (item._dp) {
          // Discover page owns this item — let it drop the card and re-render
          document.dispatchEvent(new CustomEvent(SCENE_SAVED_EVENT, { detail: { item: item } }));
        } else {
          var idx = _state.cachedMissing.indexOf(item);
          if (idx !== -1) _state.cachedMissing.splice(idx, 1);
          setTimeout(function () { if (_modalEl) renderTabContent(); }, 1500);
        }
      }
    }).catch(function (e) {
      console.error("[SSD] save failed:", e);
      btn.disabled = false;
      btn.textContent = tc("加入失败", "Add failed");
      btn.classList.add("ssd-btn-danger");
      showModalNotice(tc("加入失败: ", "Add failed: ") + (e.message || String(e)), "error");
      setTimeout(function () {
        btn.textContent = tc("加入库", "Add to Library");
        btn.classList.remove("ssd-btn-danger");
      }, 3000);
    });
  }

  function findOrCreateStudio(name) {
    return callGQL(
      "query($f:FindFilterType!){findStudios(filter:$f){studios{id name}}}",
      { f: { q: name, per_page: 5 } }
    ).then(function (data) {
      var studios = ((data.findStudios || {}).studios) || [];
      for (var i = 0; i < studios.length; i++) {
        if (studios[i].name.toLowerCase() === name.toLowerCase()) return studios[i].id;
      }
      return callGQL(
        "mutation($input:StudioCreateInput!){studioCreate(input:$input){id}}",
        { input: { name: name } }
      ).then(function (d) { return d.studioCreate ? d.studioCreate.id : null; });
    }).catch(function () { return null; });
  }

  function findOrCreateTag(name) {
    return callGQL(
      "query($f:FindFilterType!){findTags(filter:$f){tags{id name}}}",
      { f: { q: name, per_page: 5 } }
    ).then(function (data) {
      var tags = ((data.findTags || {}).tags) || [];
      for (var i = 0; i < tags.length; i++) {
        if (tags[i].name.toLowerCase() === name.toLowerCase()) return tags[i].id;
      }
      return callGQL(
        "mutation($input:TagCreateInput!){tagCreate(input:$input){id}}",
        { input: { name: name } }
      ).then(function (d) { return d.tagCreate ? d.tagCreate.id : null; });
    }).catch(function () { return null; });
  }

  // ─── Action: Open in box ─────────────────────────────────────────────────

  function handleOpenInBox(item) {
    var url = boxSceneUrl(item.endpoint, item.scene.id);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // ─── Action: Search Resources (Jackett via Python backend) ────────────────

  // Default query: code for JAV scenes, title for western ones (auto-fallback).
  // An editable search bar is mounted above the results so the query can be
  // corrected per scene (long titles, custom keywords, ...).
  function handleSearchResources(item, btn) {
    var sc = _state.modalDetail ? _state.modalDetail.scene : item.scene;
    var defaultQuery = sc.code || sc.title || "";
    if (!defaultQuery) {
      showModalNotice(tc("无法构建搜索词（无番号或标题）", "Cannot build search query (no code or title)"), "error");
      return;
    }

    var section = document.querySelector("[data-ssd-search]");
    if (!section) return;

    ensureSearchBar(section, item, btn, defaultQuery);

    // Second invocation uses the bar's current text (may be user-edited)
    var input = section.querySelector("[data-ssd-search-input]");
    var query = (input ? input.value : defaultQuery).trim() || defaultQuery;
    doSearchResources(section, item, btn, query);
  }

  function ensureSearchBar(section, item, btn, defaultQuery) {
    if (section.querySelector("[data-ssd-search-bar]")) return;

    var bar = document.createElement("div");
    bar.className = "ssd-search-bar";
    bar.setAttribute("data-ssd-search-bar", "");

    var group = document.createElement("div");
    group.className = "clearable-input-group search-term-input";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "clearable-text-field form-control";
    input.setAttribute("data-ssd-search-input", "");
    input.value = defaultQuery;
    input.placeholder = tc("番号 / 标题", "Code / title");
    group.appendChild(input);

    var goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "ssd-btn ssd-btn-accent ssd-btn-sm";
    goBtn.textContent = tc("搜索", "Search");

    function submit() {
      var q = input.value.trim();
      if (!q) { input.focus(); return; }
      doSearchResources(section, item, btn, q);
    }

    goBtn.onclick = submit;
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });

    bar.appendChild(group);
    bar.appendChild(goBtn);
    section.appendChild(bar);
  }

  // Smooth-scroll the modal to its bottom so the search status/results are
  // visible (the search section sits at the end of the modal).
  function scrollModalToBottom() {
    var modalEl = document.querySelector(".ssd-modal");
    if (!modalEl) return;
    try { modalEl.scrollTo({ top: modalEl.scrollHeight, behavior: "smooth" }); }
    catch (e) { modalEl.scrollTop = modalEl.scrollHeight; }
  }

  function doSearchResources(section, item, btn, query) {
    if (!query) return;

    var results = section.querySelector("[data-ssd-search-results]");
    if (!results) {
      results = document.createElement("div");
      results.setAttribute("data-ssd-search-results", "");
      section.appendChild(results);
    }
    results.innerHTML = "";

    btn.disabled = true;
    btn.textContent = tc("搜索中...", "Searching...");
    var loading = document.createElement("div");
    loading.className = "ssd-search-loading";
    loading.textContent = tc("正在通过 Jackett 搜索: ", "Searching via Jackett: ") + query;
    results.appendChild(loading);
    scrollModalToBottom();

    runPluginTask(TASK_SEARCH, [
      { key: "mode", value: { str: "search" } },
      { key: "query", value: { str: query } },
    ]).then(function (jobId) {
      if (!jobId) throw new Error(tc("任务提交失败", "Task submission failed"));
      return pollJob(jobId);
    }).then(function () {
      return fetchSearchResult();
    }).then(function (result) {
      btn.disabled = false;
      btn.textContent = tc("搜索资源", "Search Resources");
      // No re-scroll: results render in place of the loading line, so the
      // viewport already shows the result header and first entries
      renderSearchResults(results, result);
    }).catch(function (e) {
      console.error("[SSD] search error:", e);
      btn.disabled = false;
      btn.textContent = tc("搜索资源", "Search Resources");
      results.innerHTML = "";
      var err = document.createElement("div");
      err.className = "ssd-search-error";
      err.textContent = tc("搜索失败: ", "Search failed: ") + (e.message || String(e));
      results.appendChild(err);
    });
  }

  function runPluginTask(taskName, args) {
    return callGQL(
      "mutation($id:ID!,$t:String!,$a:[PluginArgInput!]){runPluginTask(plugin_id:$id,task_name:$t,args:$a)}",
      { id: PLUGIN_ID, t: taskName, a: args }
    ).then(function (r) { return (r && r.runPluginTask) || null; });
  }

  function pollJob(jobId) {
    var startTime = Date.now();
    var timeout = 60000;
    return new Promise(function (resolve, reject) {
      function tick() {
        callGQL("query($i:FindJobInput!){findJob(input:$i){id status}}", { i: { id: jobId } })
          .then(function (r) {
            var job = r && r.findJob;
            if (!job) { reject(new Error("Job not found")); return; }
            if (job.status === "FINISHED" || job.status === "FAILED" || job.status === "CANCELLED") {
              resolve(job.status); return;
            }
            if (Date.now() - startTime > timeout) { reject(new Error(tc("搜索超时", "Search timed out"))); return; }
            setTimeout(tick, 1500);
          }).catch(function (e) { reject(e); });
      }
      tick();
    });
  }

  function fetchSearchResult() {
    return callGQL("query{logs{level message}}", {}).then(function (r) {
      var logs = (r && r.logs) || [];
      // Stash logs are newest-first: the first marker found is the latest run's
      for (var i = 0; i < logs.length; i++) {
        var msg = (logs[i] || {}).message || "";
        var errIdx = msg.indexOf(ERROR_MARKER);
        if (errIdx !== -1) throw new Error(msg.substring(errIdx + ERROR_MARKER.length).trim());
        var resultIdx = msg.indexOf(RESULT_MARKER);
        if (resultIdx !== -1) {
          var jsonStr = msg.substring(resultIdx + RESULT_MARKER.length).trim();
          try { return JSON.parse(jsonStr); } catch (e) { console.warn("[SSD] result parse failed:", e); }
        }
      }
      return { count: 0, results: [] };
    });
  }

  function renderSearchResults(section, result) {
    section.innerHTML = "";
    _searchResults = result.results || [];
    _searchPage = 1;

    var header = document.createElement("div");
    header.className = "ssd-search-header";
    header.textContent = tc("搜索结果 (", "Search Results (") + (result.count || 0) + ")";
    section.appendChild(header);

    if (_searchResults.length === 0) {
      var empty = document.createElement("div");
      empty.className = "ssd-search-empty";
      empty.textContent = tc("未找到资源", "No resources found");
      section.appendChild(empty);
      return;
    }

    renderSearchPage(section);
  }

  function renderSearchPage(section) {
    // Remove existing list + pager (keep header)
    var oldList = section.querySelector(".ssd-search-list");
    if (oldList) oldList.remove();
    var oldPager = section.querySelector(".ssd-search-pager");
    if (oldPager) oldPager.remove();

    var start = (_searchPage - 1) * _searchPerPage;
    var pageItems = _searchResults.slice(start, start + _searchPerPage);

    var list = document.createElement("div");
    list.className = "ssd-search-list";
    pageItems.forEach(function (res) { list.appendChild(buildSearchResultItem(res)); });
    section.appendChild(list);

    // Pagination controls
    var totalPages = Math.ceil(_searchResults.length / _searchPerPage);
    if (totalPages > 1) {
      var pager = document.createElement("div");
      pager.className = "ssd-search-pager";

      var prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className = "ssd-btn ssd-btn-secondary ssd-btn-sm";
      prevBtn.textContent = "← " + tc("上一页", "Prev");
      prevBtn.disabled = _searchPage <= 1;
      prevBtn.onclick = function () {
        _searchPage--;
        renderSearchPage(section);
      };
      pager.appendChild(prevBtn);

      var pageInfo = document.createElement("span");
      pageInfo.className = "ssd-count-info";
      pageInfo.textContent = tc("第 " + _searchPage + " / " + totalPages + " 页",
        "Page " + _searchPage + " of " + totalPages);
      pager.appendChild(pageInfo);

      var nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "ssd-btn ssd-btn-secondary ssd-btn-sm";
      nextBtn.textContent = tc("下一页", "Next") + " →";
      nextBtn.disabled = _searchPage >= totalPages;
      nextBtn.onclick = function () {
        _searchPage++;
        renderSearchPage(section);
      };
      pager.appendChild(nextBtn);

      section.appendChild(pager);
    }
  }

  function buildSearchResultItem(res) {
    var row = document.createElement("div");
    row.className = "ssd-search-item";

    var info = document.createElement("div");
    info.className = "ssd-search-item-info";
    var title = document.createElement("div");
    title.className = "ssd-search-item-title";
    title.textContent = res.title || tc("无标题", "Untitled");
    title.title = res.title || "";
    info.appendChild(title);
    var meta = document.createElement("div");
    meta.className = "ssd-search-item-meta";
    var metaParts = [];
    if (res.size_human) metaParts.push(res.size_human);
    if (res.seeders >= 0) metaParts.push(tc("种子", "S") + ": " + res.seeders);
    if (res.leechers >= 0) metaParts.push(tc("下载", "L") + ": " + res.leechers);
    if (res.tracker) metaParts.push(res.tracker);
    meta.textContent = metaParts.join(" · ");
    info.appendChild(meta);
    row.appendChild(info);

    var actions = document.createElement("div");
    actions.className = "ssd-search-item-actions";

    if (res.magnet) {
      var copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "ssd-btn ssd-btn-secondary ssd-btn-sm";
      copyBtn.textContent = tc("复制磁力", "Copy Magnet");
      copyBtn.onclick = function () {
        navigator.clipboard.writeText(res.magnet).then(function () {
          copyBtn.textContent = tc("已复制 ✓", "Copied ✓");
          copyBtn.classList.add("ssd-btn-success");
          setTimeout(function () {
            copyBtn.textContent = tc("复制磁力", "Copy Magnet");
            copyBtn.classList.remove("ssd-btn-success");
          }, 2000);
        }).catch(function () {
          var ta = document.createElement("textarea");
          ta.value = res.magnet;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          copyBtn.textContent = tc("已复制 ✓", "Copied ✓");
          setTimeout(function () { copyBtn.textContent = tc("复制磁力", "Copy Magnet"); }, 2000);
        });
      };
      actions.appendChild(copyBtn);
    } else if (res.link) {
      var openLinkBtn = document.createElement("a");
      openLinkBtn.href = res.link;
      openLinkBtn.target = "_blank";
      openLinkBtn.rel = "noopener noreferrer";
      openLinkBtn.className = "ssd-btn ssd-btn-secondary ssd-btn-sm";
      openLinkBtn.textContent = tc("打开链接", "Open Link");
      actions.appendChild(openLinkBtn);
    }

    if (res.magnet) {
      var pushBtn = document.createElement("button");
      pushBtn.type = "button";
      pushBtn.className = "ssd-btn ssd-btn-accent ssd-btn-sm";
      pushBtn.textContent = tc("推送下载", "Push to DL");
      pushBtn.onclick = function () {
        pushBtn.disabled = true;
        pushBtn.textContent = tc("推送中...", "Pushing...");
        runPluginTask(TASK_PUSH, [
          { key: "mode", value: { str: "push_download" } },
          { key: "magnet", value: { str: res.magnet } },
        ]).then(function (jobId) {
          if (!jobId) throw new Error("Task submission failed");
          return pollJob(jobId);
        }).then(function () { return fetchPushResult(); })
        .then(function () {
          pushBtn.textContent = tc("已推送 ✓", "Pushed ✓");
          pushBtn.classList.add("ssd-btn-success");
          setTimeout(function () {
            pushBtn.disabled = false;
            pushBtn.textContent = tc("推送下载", "Push to DL");
            pushBtn.classList.remove("ssd-btn-success");
          }, 2500);
        }).catch(function (e) {
          pushBtn.disabled = false;
          pushBtn.textContent = tc("推送失败", "Failed");
          pushBtn.classList.add("ssd-btn-danger");
          showModalNotice(tc("推送失败: ", "Push failed: ") + (e.message || String(e)), "error");
          setTimeout(function () {
            pushBtn.textContent = tc("推送下载", "Push to DL");
            pushBtn.classList.remove("ssd-btn-danger");
          }, 3000);
        });
      };
      actions.appendChild(pushBtn);
    }

    row.appendChild(actions);
    return row;
  }

  function fetchPushResult() {
    return callGQL("query{logs{level message}}", {}).then(function (r) {
      var logs = (r && r.logs) || [];
      // Stash logs are newest-first (see fetchSearchResult)
      for (var i = 0; i < logs.length; i++) {
        var msg = (logs[i] || {}).message || "";
        if (msg.indexOf(ERROR_MARKER) !== -1) {
          throw new Error(msg.substring(msg.indexOf(ERROR_MARKER) + ERROR_MARKER.length).trim());
        }
        if (msg.indexOf(RESULT_MARKER) !== -1) return true;
      }
      return true;
    });
  }

  function showModalNotice(text, type) {
    var host = document.querySelector("[data-ssd-search-results]")
      || document.querySelector("[data-ssd-search]");
    if (!host) return;
    var notice = document.createElement("div");
    notice.className = "ssd-notice ssd-notice-" + (type || "info");
    notice.textContent = text;
    host.insertBefore(notice, host.firstChild);
    setTimeout(function () { notice.remove(); }, 5000);
  }

  // ─── Resource search / push: the backend does what the original's plugin tasks did ───

  var _ssdJobs = {};
  var _ssdJobSeq = 0;
  var _lastSearchResult = null;
  var _lastPushResult = null;

  function runPluginTask(taskName, args) {
    var a = {};
    (args || []).forEach(function (x) { a[x.key] = x.value && x.value.str; });
    var id = "ssd-job-" + (++_ssdJobSeq);
    var p = ssdBackend(taskName === TASK_PUSH
      ? { mode: "ssd_push", magnet: a.magnet || "" }
      : { mode: "ssd_search", query: a.query || "" });
    _ssdJobs[id] = p.then(function (r) {
      if (taskName === TASK_PUSH) _lastPushResult = r; else _lastSearchResult = r;
      return r;
    });
    return Promise.resolve(id);
  }

  function pollJob(jobId) {
    return _ssdJobs[jobId].then(function () { return "FINISHED"; });
  }

  function fetchSearchResult() {
    return Promise.resolve(_lastSearchResult || { count: 0, results: [] });
  }

  function fetchPushResult() {
    return Promise.resolve(true);
  }

  // (the performer tab of the original is not part of Stash UI)
  function renderTabContent() {}

  var DISCOVER_CACHE_KEY = "SSD:discoverOn";

  function discoverCachedOn() {
    try { return localStorage.getItem(DISCOVER_CACHE_KEY) !== "0"; } catch (_) { return true; }
  }

  var DP_FOLLOW_KEY = "SSD:dp:follow.v1";
  var DP_READ_KEY = "SSD:dp:read.v1";
  var DP_POLL_KEY = "SSD:dp:poll.v1";
  var DP_UNREAD_KEY = "SSD:dp:unread.v1";
  var DP_NOTIFY_KEY = "SSD:dp:notify"; // "0" = muted (P6 settings UI writes it)
  var DP_PREFS_KEY = "SSD:dp:prefs"; // discover page prefs (active source lives here)
  var DP_POLL_MIN_MS = 6 * 3600 * 1000;

  function dpCachedUnread() {
    try {
      var o = JSON.parse(localStorage.getItem(DP_UNREAD_KEY) || "null");
      return (o && typeof o.n === "number") ? o.n : 0;
    } catch (_) { return 0; }
  }

  function dpWriteUnread(n) {
    try { localStorage.setItem(DP_UNREAD_KEY, JSON.stringify({ n: n, at: Date.now() })); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent("ssd:unread-changed", { detail: n })); } catch (_) {}
  }

  function notifyMuted() {
    try { return localStorage.getItem(DP_NOTIFY_KEY) === "0"; } catch (_) { return false; }
  }

  function dpPollFollowed(force) {
    var proceed = false;
    try {
      if (!discoverCachedOn()) return Promise.resolve(0);
      if (notifyMuted()) return Promise.resolve(0); // §6.4: muted → skip poll, hide badge
      var last = 0;
      try { last = ((JSON.parse(localStorage.getItem(DP_POLL_KEY) || "null") || {}).lastAt) || 0; } catch (_) {}
      proceed = force || !last || Date.now() - last >= DP_POLL_MIN_MS;
    } catch (_) {}
    if (!proceed) return Promise.resolve(dpCachedUnread());

    var follow = {};
    try { follow = JSON.parse(localStorage.getItem(DP_FOLLOW_KEY) || "{}") || {}; } catch (_) {}
    var list = (follow && follow.performers) || {};
    var ids = Object.keys(list);
    var stamp = function (n) {
      try { localStorage.setItem(DP_POLL_KEY, JSON.stringify({ lastAt: Date.now() })); } catch (_) {}
      dpWriteUnread(n);
      return n;
    };
    if (!ids.length) return Promise.resolve(stamp(0));

    return Promise.all([getStashBoxes(), getPluginSettings()]).then(function (res) {
      var boxes = res[0] || [];
      var settings = res[1] || {};
      var recentDays = parseInt(settings.recentDays, 10);
      if (!(recentDays > 0)) recentDays = 30; // §4.2 default lookback
      var cutoff = localDateStr(new Date(Date.now() - recentDays * 86400000));

      // 关注页是单源口径（只显示当前数据源的新作，用户 2026-10-25 第七轮），
      // 角标同样只统计当前数据源，避免「角标有未读、关注页却全是暂无新作品」。
      var wanted = "";
      try { wanted = String(((JSON.parse(localStorage.getItem(DP_PREFS_KEY) || "null") || {}).source) || ""); } catch (_) {}
      if (!wanted) wanted = String(settings.preferredBox || "");
      wanted = wanted.toLowerCase();
      var byEndpoint = {};
      ids.forEach(function (k) {
        var f = list[k] || {};
        var ep = String(f.endpoint || "").toLowerCase();
        if (!ep) return;
        (byEndpoint[ep] = byEndpoint[ep] || []).push(String(f.stashId || k));
      });
      var boxByEp = {};
      boxes.forEach(function (b) {
        if (wanted && String(b.name).toLowerCase() !== wanted && String(b.endpoint).toLowerCase() !== wanted) return;
        boxByEp[String(b.endpoint).toLowerCase()] = b;
      });
      if (!Object.keys(boxByEp).length) boxes.forEach(function (b) { boxByEp[String(b.endpoint).toLowerCase()] = b; });

      // One query per endpoint, first 100 scenes — a light channel; the page's
      // full pipeline paginates properly and corrects the badge.
      return Promise.all(Object.keys(byEndpoint).map(function (ep) {
        var box = boxByEp[ep];
        if (!box) return Promise.resolve(null);
        return _boxRateLimiter.submit(function () {
          return callBoxGQL(box.endpoint, box.api_key,
            // performers 是 PerformerAppearance（{as, performer}），写成 performers{id}
            // 会被 stash-box 校验拒绝（HTTP 422）→ 轮询永远 0（用户 2026-10-25 第七轮）
            "query($input:SceneQueryInput!){queryScenes(input:$input){count scenes{id date performers{performer{id}}}}}",
            {
              input: {
                date: { value: cutoff, modifier: "GREATER_THAN" },
                performers: { value: byEndpoint[ep], modifier: "INCLUDES" },
                sort: "DATE", direction: "DESC",
                page: 1, per_page: 100,
              },
            }
          );
        }).then(function (data) {
          return { ep: ep, ids: byEndpoint[ep], scenes: (((data || {}).queryScenes || {}).scenes) || [] };
        }).catch(function () { return null; }); // a failed box keeps its cached count next round
      }));
    }).then(function (results) {
      var marks = {};
      try { marks = ((JSON.parse(localStorage.getItem(DP_READ_KEY) || "null") || {}).marks) || {}; } catch (_) {}
      var n = 0;
      (results || []).forEach(function (r) {
        if (!r) return;
        var set = {};
        r.ids.forEach(function (id) { set[String(id)] = true; });
        (r.scenes || []).forEach(function (sc) {
          if (marks[r.ep + ":" + String(sc.id || "").toLowerCase()]) return;
          ((sc.performers || [])).forEach(function (pf) {
            var pid = pf && pf.performer && pf.performer.id;
            if (pid && set[String(pid)]) n++;
          });
        });
      });
      return stamp(n);
    }).catch(function (e) {
      console.warn("[SSD] follow poll failed:", e);
      return dpCachedUnread();
    });
  }

  window.SSD = {
    version: PLUGIN_VERSION,
    // GraphQL
    callGQL: callGQL,
    callBoxGQL: callBoxGQL,
    boxRateLimiter: _boxRateLimiter,
    // config
    getStashBoxes: getStashBoxes,
    getPluginSettings: getPluginSettings,
    savePluginSettings: savePluginSettings,
    // i18n / dates
    tc: tc,
    isZh: isZh,
    localDateStr: localDateStr,
    recentCutoffDate: recentCutoffDate,
    previewCutoffDate: previewCutoffDate,
    // boxes
    brandNameForEndpoint: brandNameForEndpoint,
    boxSceneUrl: boxSceneUrl,
    boxWebBase: boxWebBase,
    BOX_SCENE_FIELDS: BOX_SCENE_FIELDS,
    BOX_TIMEOUT_MS: BOX_TIMEOUT_MS,
    boxErrText: boxErrText,
    // rendering (buildSceneCard/isSceneOwned accept a ctx/keys override)
    buildSceneCard: buildSceneCard,
    buildSceneTable: buildSceneTable,
    layoutCardGrid: layoutCardGrid,
    openModal: openModal,
    isSceneOwned: isSceneOwned,
    // UI atoms
    makeChip: makeChip,
    makePanelBtn: makePanelBtn,
    panelIcon: panelIcon,
    panelDesc: panelDesc,
    panelNote: panelNote,
    buildSourceRow: buildSourceRow,
    // events
    SCENE_SAVED_EVENT: SCENE_SAVED_EVENT,
    // follow polling (force = bypass the 6h throttle; used after favorites import)
    pollFollowed: dpPollFollowed,
  };

  window.addEventListener("resize", (function () {
    var t = null;
    return function () { clearTimeout(t); t = setTimeout(layoutCardGrid, 150); };
  })());
})();
