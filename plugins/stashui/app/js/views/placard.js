// The big placard next to the player and image viewer: details, rating, red dot, O counter, tags, actions.

import { esc, icon, fmtDuration, fmtRes, fmtBytes, fmtDate, fmtAgo, invNo, starsHtml, toast, errorToast, store, plural } from "../ui.js";
import { updateItem, setFavorite, favoriteTagId, addO, removeO } from "../api.js";
import { app, setQueueCount } from "../main.js";
import { openEditor } from "./edit.js";

function fileInfo(kind, x) {
  if (kind === "scene") {
    const f = x.files[0] || {};
    return {
      path: f.path,
      lines: [
        [fmtDuration(f.duration), fmtRes(f.width, f.height), f.width ? `${f.width} × ${f.height}` : ""].filter(Boolean).join(", "),
        [f.video_codec ? f.video_codec.toUpperCase() : "", f.frame_rate ? Math.round(f.frame_rate) + " fps" : "", fmtBytes(f.size)].filter(Boolean).join(", "),
      ],
    };
  }
  const f = x.visual_files[0] || {};
  return {
    path: f.path,
    lines: [[f.width ? `${f.width} × ${f.height}` : "", f.duration ? fmtDuration(f.duration) : "", fmtBytes(f.size)].filter(Boolean).join(", ")],
  };
}

export function placardHtml(kind, x) {
  const fav = !!app.favId && x.tags.some((t) => t.id === app.favId);
  const info = fileInfo(kind, x);
  const title = x.title || (info.path || "").split(/[\\/]/).pop();
  const tags = x.tags.filter((t) => t.id !== app.favId);
  const folder = (info.path || "").split(/[\\/]/).slice(0, -1).join("\\");
  return `
    <div class="kb-plc">
      <p class="kb-plc-inv">${{ scene: "Scene", image: "Image", gallery: "Gallery" }[kind]} #${x.id}${x.date ? `, ${fmtDate(x.date)}` : ""}</p>
      <h2 class="kb-plc-title">${esc(title)}</h2>
      ${info.lines.filter(Boolean).map((l) => `<p class="kb-plc-meta">${esc(l)}</p>`).join("")}
      <div class="kb-plc-acts">
        <div data-rate>${starsHtml(x.rating100, true)}</div>
        <button class="kb-plc-btn${fav ? " is-on" : ""}" data-fav title="Favorite (H)"><span class="kb-dotmini"></span>${fav ? "Favorite" : "Add to favorites"}</button>
        <button class="kb-plc-btn" data-o title="O counter (O), right-click subtracts one">${icon("drop")}<span data-ocount>${x.o_counter || 0}</span></button>
      </div>
      ${kind === "scene" ? `<p class="kb-plc-meta">${x.play_count ? `Watched ${plural(x.play_count, "time", "times")}, last ${fmtAgo(x.last_played_at)}` : "Never watched to the end"}</p>` : ""}
      ${tags.length ? `<div class="kb-chips kb-plc-tags">${tags.map((t) => `<a class="kb-chip" href="#/tag/${t.id}">${esc(t.name)}</a>`).join("")}</div>` : ""}
      ${x.details ? `<p class="kb-plc-text">${esc(x.details)}</p>` : ""}
      ${kind === "image" && x.galleries && x.galleries.length ? `<p class="kb-plc-meta">From ${x.galleries.map((g) => `<a href="#/gallery/${g.id}">${esc(g.title || ((g.folder && g.folder.path) || ((g.files || [])[0] || {}).path || "").split(/[\\/]/).filter(Boolean).pop() || "Gallery " + g.id)}</a>`).join(", ")}</p>` : ""}
      <div class="kb-plc-row">
        <button class="kb-plc-btn" data-edit>${icon("edit")}Edit</button>
        <button class="kb-plc-btn" data-queue>${icon("queue")}Queue</button>
        ${folder ? `<button class="kb-plc-btn" data-folder title="${esc(folder)}">${icon("folder")}Folder</button>` : ""}
      </div>
      ${info.path ? `<p class="kb-plc-path">${esc(info.path)}</p>` : ""}
    </div>`;
}

// Binds the buttons; refresh() reloads the details and redraws the placard.
export function bindPlacard(host, kind, getItem, { refresh, onDeleted, goFolder }) {
  host.addEventListener("click", async (e) => {
    const x = getItem();
    if (!x) return;
    try {
      const star = e.target.closest("[data-star]");
      if (star) return rate(Number(star.dataset.star));
      if (e.target.closest("[data-fav]")) return fav();
      if (e.target.closest("[data-o]")) return o(1);
      if (e.target.closest("[data-edit]")) return openEditor(kind, [{ id: x.id }], { onSaved: refresh, onDeleted });
      if (e.target.closest("[data-queue]")) {
        const q = store.get("queue", []);
        q.push({ kind, id: x.id, title: x.title || x.id, thumb: kind === "scene" ? x.paths.screenshot : x.paths.thumbnail });
        store.set("queue", q);
        setQueueCount();
        return toast("Added to the queue", "ok");
      }
      if (e.target.closest("[data-folder]")) return goFolder && goFolder();
    } catch (err) {
      errorToast(err, "Action failed");
    }
  });
  host.addEventListener("contextmenu", (e) => {
    if (!e.target.closest("[data-o]")) return;
    e.preventDefault();
    o(-1).catch((err) => errorToast(err, "O counter"));
  });

  async function rate(n) {
    const x = getItem();
    const cur = Math.round((x.rating100 || 0) / 20);
    const v = cur === n ? null : n * 20;
    await updateItem(kind, { id: x.id, rating100: v });
    x.rating100 = v;
    host.querySelector("[data-rate]").innerHTML = starsHtml(v, true);
    toast(v ? `${n} ${n === 1 ? "star" : "stars"}` : "Rating removed");
  }
  async function fav() {
    const x = getItem();
    const on = !(app.favId && x.tags.some((t) => t.id === app.favId));
    await setFavorite(kind, [x.id], on);
    app.favId = await favoriteTagId(false);
    if (on) x.tags.push({ id: app.favId, name: "Favorite" });
    else x.tags = x.tags.filter((t) => t.id !== app.favId);
    const b = host.querySelector("[data-fav]");
    b.classList.toggle("is-on", on);
    b.innerHTML = `<span class="kb-dotmini"></span>${on ? "Favorite" : "Add to favorites"}`;
    toast(on ? "Marked as favorite" : "Favorite removed");
    if (app.context && app.context.hang) {
      const p = app.context.hang.pieces.find((q) => q.kind === kind && q.id === x.id);
      if (p) app.context.hang.update(Object.assign({}, p, { fav: on }));
    }
  }
  async function o(delta) {
    const x = getItem();
    const n = delta > 0 ? await addO(kind, x.id) : await removeO(kind, x.id);
    x.o_counter = n;
    host.querySelector("[data-ocount]").textContent = n;
  }
  return { rate, fav, o };
}
