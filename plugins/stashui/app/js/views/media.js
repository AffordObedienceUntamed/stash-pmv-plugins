// Shared browsing building block: toolbar, filters, tabs (scenes/images/galleries),
// salon hanging, multi-select with actions. State lives in the URL.

import { esc, icon, store, debounce, seed, errorToast, toast, plural, fmtNum, confirmDialog, starsHtml } from "../ui.js";
import { t } from "../i18n.js";
import { findItems, favoriteTagId, setFavorite, bulkUpdate, destroyItems } from "../api.js";
import { toPiece, Hang } from "../pieces.js";
import { app, setQuery, go, setQueueCount } from "../main.js";
import { tagPicker } from "./tagpicker.js";
import { openEditor } from "./edit.js";

export const KIND_NAME = { scene: ["Scene", "Scenes"], image: ["Image", "Images"], gallery: ["Gallery", "Galleries"] };
// Unit words for counts ("12 scenes") – separate from the titles above, other languages need that
export const KIND_UNIT = { scene: ["scene", "scenes"], image: ["image", "images"], gallery: ["gallery", "galleries"] };

const SORTS = {
  scene: [["created_at", "Recently added"], ["date", "Date"], ["last_played_at", "Last watched"], ["play_count", "Most watched"], ["rating", "Rating"], ["duration", "Duration"], ["title", "Title"], ["filesize", "File size"], ["path", "Path"], ["random", "Random"]],
  image: [["created_at", "Recently added"], ["date", "Date"], ["rating", "Rating"], ["o_counter", "O counter"], ["title", "Title"], ["filesize", "File size"], ["path", "Path"], ["random", "Random"]],
  gallery: [["created_at", "Recently added"], ["date", "Date"], ["rating", "Rating"], ["images_count", "Image count"], ["title", "Title"], ["path", "Path"], ["random", "Random"]],
};

// Read the filter state from the URL
function readState(q, kind, defaults) {
  const d = defaults || {};
  return {
    q: q.q || "",
    sort: q.sort || d.sort || (SORTS[kind].some(([k]) => k === "created_at") ? "created_at" : "path"),
    dir: q.dir || d.dir || (["title", "path"].includes(q.sort || d.sort) ? "ASC" : "DESC"),
    tags: (q.tags || "").split(",").filter(Boolean),
    xtags: (q.xtags || "").split(",").filter(Boolean),
    rating: Number(q.rating || 0),
    fav: q.fav === "1",
    played: q.played || "",
    ori: q.ori || "",
    res: q.res || "",
    len: q.len || "",
    seed: q.seed || "",
  };
}

// Build the Stash filter. base: the page's restriction (folder, tag, gallery).
function buildFilter(kind, st, base) {
  const f = Object.assign({}, base && base.filter);
  const inc = [...st.tags];
  if (base && base.tagId) inc.unshift(base.tagId);
  if (st.fav && app.favId) inc.push(app.favId);
  if (inc.length || st.xtags.length) {
    f.tags = { value: [...new Set(inc)], modifier: "INCLUDES_ALL", depth: 0 };
    if (st.xtags.length) f.tags.excludes = st.xtags;
  }
  if (st.rating) f.rating100 = { value: st.rating * 20 - 1, modifier: "GREATER_THAN" };
  if (kind === "scene") {
    if (st.played === "yes") f.play_count = { value: 0, modifier: "GREATER_THAN" };
    if (st.played === "no") f.play_count = { value: 0, modifier: "EQUALS" };
    if (st.played === "resume") f.resume_time = { value: 5, modifier: "GREATER_THAN" };
    if (st.res) f.resolution = { value: st.res, modifier: "GREATER_THAN" };
    if (st.len === "short") f.duration = { value: 60, modifier: "LESS_THAN" };
    if (st.len === "mid") f.duration = { value: 60, value2: 600, modifier: "BETWEEN" };
    if (st.len === "long") f.duration = { value: 600, modifier: "GREATER_THAN" };
  }
  if (st.ori && kind !== "gallery") f.orientation = { value: [st.ori] };
  return f;
}

export function mediaBrowser(host, opts) {
  // opts: { kinds, query, base(kind) → { filter, tagId }, defaults, counts: {kind: n}, onCount(kind, n), persist }
  const kinds = opts.kinds;
  let kind = kinds.includes(opts.query.kind) ? opts.query.kind : opts.initialKind || kinds[0];
  let st = readState(opts.query, kind, opts.defaults && opts.defaults[kind]);
  let hang = null;
  let filterOpen = !!(st.tags.length || st.xtags.length || st.rating || st.fav || st.played || st.ori || st.res || st.len);
  const rowH = () => store.get("rowHeight", 250);

  host.innerHTML = `
    <div class="kb-browser">
      <div class="kb-toolbar">
        ${kinds.length > 1 ? `<div class="kb-seg kb-kinds" role="tablist">${kinds.map((k) => `<button role="tab" data-kind="${k}">${t(KIND_NAME[k][1])} <span data-kcount="${k}"></span></button>`).join("")}</div>` : ""}
        ${opts.search === false ? "" : `<label class="kb-search">${icon("search")}<input class="kb-field" type="search" data-q placeholder="${t("Search this view")}" value="${esc(st.q)}"></label>`}
        <select class="kb-field" data-sort aria-label="${t("Sort order")}"></select>
        <button class="kb-btn is-icon" data-dir title="${t("Reverse direction")}" aria-label="${t("Reverse direction")}"></button>
        <button class="kb-btn" data-filter>${icon("filter")}<span>${t("Filter")}</span></button>
        <span class="kb-spacer"></span>
        <label class="kb-range" title="${t("Thumbnail size")}">${icon("image")}<input type="range" min="130" max="480" step="10" data-rowh value="${rowH()}" aria-label="${t("Size")}"></label>
        <button class="kb-btn" data-play title="${t("Play everything as a queue")}">${icon("play")}<span>${t("Play")}</span></button>
        <button class="kb-btn is-icon" data-select title="${t("Select")}" aria-label="${t("Select")}">${icon("select")}</button>
      </div>
      <div class="kb-filters" data-filters hidden></div>
      <p class="kb-resultline" data-result></p>
      <div data-hang></div>
    </div>`;
  const $ = (s) => host.querySelector(s);

  function renderTools() {
    host.querySelectorAll("[data-kind]").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.kind === kind);
      b.setAttribute("aria-selected", b.dataset.kind === kind);
    });
    const sortSel = $("[data-sort]");
    sortSel.innerHTML = SORTS[kind].map(([k, name]) => `<option value="${k}">${t(name)}</option>`).join("");
    sortSel.value = SORTS[kind].some(([k]) => k === st.sort) ? st.sort : SORTS[kind][0][0];
    st.sort = sortSel.value;
    $("[data-dir]").innerHTML = st.dir === "ASC" ? "↑" : "↓";
    $("[data-dir]").hidden = st.sort === "random";
    $("[data-filter]").classList.toggle("is-on", filterOpen);
    $("[data-play]").hidden = kind === "gallery";
    renderFilters();
  }

  let picker = null;
  function renderFilters() {
    const box = $("[data-filters]");
    box.hidden = !filterOpen;
    if (!filterOpen) return;
    box.innerHTML = `
      <div class="kb-tagpick" data-tp></div>
      <label class="kb-lab">${t("Rating from")}
        <select class="kb-field" data-f="rating">${[0, 1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n ? "★".repeat(n) : t("any")}</option>`).join("")}</select></label>
      ${kind === "scene" ? `<label class="kb-lab">${t("Watched")}
        <select class="kb-field" data-f="played"><option value="">${t("any")}</option><option value="yes">${t("watched")}</option><option value="no">${t("never")}</option><option value="resume">${t("started")}</option></select></label>
      <label class="kb-lab">${t("Resolution")}
        <select class="kb-field" data-f="res"><option value="">${t("any")}</option><option value="WEB_HD">${t("720p and up")}</option><option value="STANDARD_HD">${t("1080p and up")}</option><option value="QUAD_HD">4K</option></select></label>
      <label class="kb-lab">${t("Duration")}
        <select class="kb-field" data-f="len"><option value="">${t("any")}</option><option value="short">${t("under 1 min")}</option><option value="mid">${t("1–10 min")}</option><option value="long">${t("over 10 min")}</option></select></label>` : ""}
      ${kind !== "gallery" ? `<label class="kb-lab">${t("Format")}
        <select class="kb-field" data-f="ori"><option value="">${t("any")}</option><option value="PORTRAIT">${t("Portrait")}</option><option value="LANDSCAPE">${t("Landscape")}</option><option value="SQUARE">${t("Square")}</option></select></label>` : ""}
      <label class="kb-check"><input type="checkbox" data-f="fav"${st.fav ? " checked" : ""}>${t("Favorites only")}</label>
      <button class="kb-btn is-ghost" data-clear>${t("Reset")}</button>`;
    box.querySelectorAll("select[data-f]").forEach((s) => (s.value = st[s.dataset.f] || (s.dataset.f === "rating" ? "0" : "")));
    picker = tagPicker(box.querySelector("[data-tp]"), {
      include: st.tags,
      exclude: st.xtags,
      allowExclude: true,
      placeholder: t("Add tag (right-click a tag to exclude it)"),
      onChange: (inc, exc) => {
        st.tags = inc;
        st.xtags = exc;
        apply();
      },
    });
  }

  function persistQuery() {
    setQuery({
      kind: kinds.length > 1 ? kind : "",
      q: st.q,
      sort: st.sort,
      dir: st.dir,
      tags: st.tags.join(","),
      xtags: st.xtags.join(","),
      rating: st.rating || "",
      fav: st.fav ? "1" : "",
      played: st.played,
      ori: st.ori,
      res: st.res,
      len: st.len,
      seed: st.sort === "random" ? st.seed : "",
    });
  }

  function apply() {
    persistQuery();
    load();
  }

  function load() {
    if (hang) hang.destroy();
    exitSelect();
    const base = opts.base ? opts.base(kind) : null;
    if (st.sort === "random" && !st.seed) st.seed = seed().replace("random_", "");
    const filter = buildFilter(kind, st, base);
    const sort = st.sort === "random" ? "random_" + st.seed : st.sort;
    $("[data-result]").textContent = "";
    const box = $("[data-hang]");
    hang = new Hang(box, {
      rowHeight: rowH(),
      fetchPage: async (page) => {
        const r = await findItems(kind, { q: st.q || undefined, page, per_page: 60, sort, direction: st.dir }, filter);
        return { count: r.count, pieces: r.items.map((x) => toPiece(kind, x, app.favId)) };
      },
      onLoaded: (h) => {
        $("[data-result]").textContent = h.count ? plural(h.count, KIND_UNIT[kind][0], KIND_UNIT[kind][1]) : "";
        const kc = host.querySelector(`[data-kcount="${kind}"]`);
        if (kc) kc.textContent = fmtNum(h.count);
        if (!h.count) {
          box.innerHTML = `<div class="kb-empty"><b>${t("Nothing found")}</b><p>${
            filterOpen || st.q ? t("Nothing matches this search and these filters. Loosen the filters or reset them.") : t("Nothing here yet.")
          }</p>${filterOpen || st.q ? `<button class="kb-btn" data-clearall>${t("Reset filters")}</button>` : ""}</div>`;
        }
        opts.onCount && opts.onCount(kind, h.count);
      },
      onError: (e) => errorToast(e, "Couldn't load"),
      onOpen: (p, i, h) => openPiece(p, i, h),
      onSelect: (set, h) => renderBulk(set, h),
    });
  }

  // Load the counts of the other tabs once
  if (kinds.length > 1) {
    kinds.forEach(async (k) => {
      try {
        const base = opts.base ? opts.base(k) : null;
        const r = await findItems(k, { per_page: 0 }, buildFilter(k, readState({}, k), base));
        const kc = host.querySelector(`[data-kcount="${k}"]`);
        if (kc && k !== kind) kc.textContent = fmtNum(r.count);
        opts.onCount && opts.onCount(k, r.count);
      } catch (e) { /* count only */ }
    });
  }

  function openPiece(p, i, h) {
    app.context = { kind: p.kind, pieces: h.pieces, index: i, hang: h };
    if (p.kind === "scene") go("scene/" + p.id);
    else if (p.kind === "image") go("image/" + p.id);
    else go("gallery/" + p.id);
  }

  // ---------- Selection & actions ----------

  let bulkEl = null;
  function exitSelect() {
    if (hang) hang.clearSelection();
    if (bulkEl) bulkEl.remove();
    bulkEl = null;
  }
  function renderBulk(set, h) {
    if (!set.size) {
      if (bulkEl) bulkEl.remove();
      bulkEl = null;
      return;
    }
    if (!bulkEl) {
      bulkEl = document.createElement("div");
      bulkEl.className = "kb-bulk";
      document.body.appendChild(bulkEl);
      bulkEl.addEventListener("click", onBulk);
    }
    bulkEl.innerHTML = `<b>${t("{what} selected", { what: plural(set.size, "item", "items") })}</b>
      <button class="kb-btn" data-b="all">${h.done ? t("Select all") : t("Select all loaded")}</button>
      <button class="kb-btn" data-b="fav"><span class="kb-dotmini"></span>${t("Favorite")}</button>
      <button class="kb-btn" data-b="unfav">${t("Remove favorite")}</button>
      <button class="kb-btn" data-b="edit">${icon("edit")}${t("Edit")}</button>
      ${kind !== "gallery" ? `<button class="kb-btn" data-b="queue">${icon("queue")}${t("Add to queue")}</button>` : ""}
      <button class="kb-btn is-danger" data-b="delete">${icon("trash")}${t("Delete")}</button>
      <span class="kb-spacer"></span>
      <button class="kb-btn" data-b="none">${t("Done")}</button>`;
  }
  async function onBulk(e) {
    const b = e.target.closest("[data-b]");
    if (!b || !hang) return;
    const pieces = hang.selectedPieces();
    const ids = pieces.map((p) => p.id);
    try {
      switch (b.dataset.b) {
        case "all": return hang.selectAll();
        case "none": return exitSelect();
        case "fav":
        case "unfav": {
          const on = b.dataset.b === "fav";
          await setFavorite(kind, ids, on);
          app.favId = await favoriteTagId(false);
          pieces.forEach((p) => hang.update(Object.assign({}, p, { fav: on })));
          toast(on ? t("{what} marked as favorite", { what: plural(ids.length, "item", "items") }) : t("Favorites removed"), "ok");
          return;
        }
        case "queue": {
          const q = store.get("queue", []);
          pieces.forEach((p) => q.push({ kind: p.kind, id: p.id, title: p.title, thumb: p.thumb }));
          store.set("queue", q);
          setQueueCount();
          toast(t("{what} added to the queue", { what: plural(ids.length, "item", "items") }), "ok");
          return exitSelect();
        }
        case "edit":
          return openEditor(kind, pieces, {
            onSaved: () => load(),
          });
        case "delete": {
          const r = await confirmDialog({
            title: t("Delete {what}?", { what: plural(ids.length, KIND_UNIT[kind][0], KIND_UNIT[kind][1]) }),
            text: t("The items disappear from Stash. With the box ticked, the files on disk are deleted too – this can't be undone."),
            ok: t("Delete"),
            danger: true,
            checkbox: t("Also delete the files from disk"),
          });
          if (!r.ok) return;
          await destroyItems(kind, ids, r.checked);
          hang.remove(pieces.map((p) => p.kind + ":" + p.id));
          toast(t("{what} deleted", { what: plural(ids.length, "item", "items") }), "ok");
          return exitSelect();
        }
      }
    } catch (err) {
      errorToast(err, "Action failed");
    }
  }

  // ---------- Events ----------

  host.addEventListener("click", (e) => {
    const k = e.target.closest("[data-kind]");
    if (k && k.dataset.kind !== kind) {
      kind = k.dataset.kind;
      st = readState({}, kind, opts.defaults && opts.defaults[kind]);
      renderTools();
      return apply();
    }
    if (e.target.closest("[data-dir]")) {
      st.dir = st.dir === "ASC" ? "DESC" : "ASC";
      renderTools();
      return apply();
    }
    if (e.target.closest("[data-filter]")) {
      filterOpen = !filterOpen;
      return renderTools();
    }
    if (e.target.closest("[data-clear]") || e.target.closest("[data-clearall]")) {
      Object.assign(st, { q: "", tags: [], xtags: [], rating: 0, fav: false, played: "", ori: "", res: "", len: "" });
      const qi = $("[data-q]");
      if (qi) qi.value = "";
      renderTools();
      return apply();
    }
    if (e.target.closest("[data-select]")) {
      if (hang && hang.selected.size) exitSelect();
      else if (hang && hang.pieces[0]) hang.toggle(hang.pieces[0].kind + ":" + hang.pieces[0].id);
      return;
    }
    if (e.target.closest("[data-play]")) return playAll();
  });
  host.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches("[data-sort]")) {
      st.sort = el.value;
      st.dir = ["title", "path"].includes(st.sort) ? "ASC" : "DESC";
      st.seed = "";
      renderTools();
      return apply();
    }
    if (el.dataset && el.dataset.f) {
      const f = el.dataset.f;
      st[f] = el.type === "checkbox" ? el.checked : f === "rating" ? Number(el.value) : el.value;
      return apply();
    }
  });
  host.addEventListener("input", (e) => {
    if (e.target.matches("[data-rowh]")) {
      store.set("rowHeight", Number(e.target.value));
      hang && hang.setRowHeight(Number(e.target.value));
    }
  });
  const qInput = $("[data-q]");
  if (qInput)
    qInput.addEventListener(
      "input",
      debounce(() => {
        st.q = qInput.value.trim();
        apply();
      }, 300)
    );

  // Play everything (or the first 200 results) as a queue
  async function playAll() {
    try {
      const base = opts.base ? opts.base(kind) : null;
      const sort = st.sort === "random" ? "random_" + (st.seed || seed().replace("random_", "")) : st.sort;
      const r = await findItems(kind, { q: st.q || undefined, per_page: 200, sort, direction: st.dir }, buildFilter(kind, st, base));
      if (!r.items.length) return toast(t("Nothing to play"));
      const list = r.items.map((x) => toPiece(kind, x, app.favId));
      store.set("queue", list.map((p) => ({ kind: p.kind, id: p.id, title: p.title, thumb: p.thumb })));
      store.set("queuePos", 0);
      setQueueCount();
      app.context = { kind, pieces: list, index: 0, queue: true };
      go((kind === "scene" ? "scene/" : "image/") + list[0].id);
    } catch (e) {
      errorToast(e, "Play");
    }
  }

  renderTools();
  load();

  return {
    destroy() {
      hang && hang.destroy();
      exitSelect();
    },
    reload: load,
    get hang() {
      return hang;
    },
  };
}
