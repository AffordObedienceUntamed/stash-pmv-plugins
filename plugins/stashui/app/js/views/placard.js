// The big placard next to the player and image viewer: details, rating, red dot, O counter, tags, actions.

import { esc, icon, fmtDuration, fmtRes, fmtBytes, fmtDate, fmtAgo, invNo, starsHtml, toast, errorToast, store, plural, burst, pop } from "../ui.js";
import { t } from "../i18n.js";
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
  const fav = !!app.favId && x.tags.some((tg) => tg.id === app.favId);
  const info = fileInfo(kind, x);
  const title = x.title || (info.path || "").split(/[\\/]/).pop();
  const tags = x.tags.filter((tg) => tg.id !== app.favId);
  const folder = (info.path || "").split(/[\\/]/).slice(0, -1).join("\\");
  return `
    <div class="kb-plc">
      <p class="kb-plc-inv">${t({ scene: "Scene", image: "Image", gallery: "Gallery" }[kind])} #${x.id}${x.date ? `${t(", ")}${fmtDate(x.date)}` : ""}</p>
      <h2 class="kb-plc-title">${esc(title)}</h2>
      ${info.lines.filter(Boolean).map((l) => `<p class="kb-plc-meta">${esc(l)}</p>`).join("")}
      <div class="kb-plc-acts">
        <div data-rate>${starsHtml(x.rating100, true)}</div>
        <button class="kb-plc-btn${fav ? " is-on" : ""}" data-fav title="${t("Favorite (H)")}"><span class="kb-dotmini"></span>${fav ? t("Favorite") : t("Add to favorites")}</button>
        <button class="kb-plc-btn" data-o title="${t("O counter (O), right-click subtracts one")}">${icon("drop")}<span data-ocount>${x.o_counter || 0}</span></button>
      </div>
      ${kind === "scene" ? `<p class="kb-plc-meta">${x.play_count ? t("Watched {what}, last {when}", { what: plural(x.play_count, "time", "times"), when: fmtAgo(x.last_played_at) }) : t("Never watched to the end")}</p>` : ""}
      ${tags.length ? `<div class="kb-chips kb-plc-tags">${tags.map((tg) => `<a class="kb-chip" href="#/tag/${tg.id}">${esc(tg.name)}</a>`).join("")}</div>` : ""}
      ${x.details ? `<p class="kb-plc-text">${esc(x.details)}</p>` : ""}
      ${kind === "image" && x.galleries && x.galleries.length ? `<p class="kb-plc-meta">${t("From")} ${x.galleries.map((g) => `<a href="#/gallery/${g.id}">${esc(g.title || ((g.folder && g.folder.path) || ((g.files || [])[0] || {}).path || "").split(/[\\/]/).filter(Boolean).pop() || t("Gallery {id}", { id: g.id }))}</a>`).join(t(", "))}</p>` : ""}
      <div class="kb-plc-row">
        <button class="kb-plc-btn" data-edit>${icon("edit")}${t("Edit")}</button>
        <button class="kb-plc-btn" data-queue>${icon("queue")}${t("Queue")}</button>
        ${folder ? `<button class="kb-plc-btn" data-folder title="${esc(folder)}">${icon("folder")}${t("Folder")}</button>` : ""}
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
        window.dispatchEvent(new Event("stash:queue-changed")); // the info bar shows the queue
        setQueueCount();
        return toast(t("Added to the queue"), "ok");
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
    // The new stars light up one after the other
    host.querySelectorAll("[data-rate] [data-star].is-on").forEach((s, i) =>
      s.animate([{ transform: "scale(1)" }, { transform: "scale(1.45)", filter: "brightness(1.6)" }, { transform: "scale(1)" }], { duration: 380, delay: i * 55, easing: "cubic-bezier(.3,1.6,.5,1)" })
    );
    toast(v ? plural(n, "star", "stars") : t("Rating removed"));
  }
  async function fav() {
    const x = getItem();
    const on = !(app.favId && x.tags.some((tg) => tg.id === app.favId));
    await setFavorite(kind, [x.id], on);
    app.favId = await favoriteTagId(false);
    if (on) x.tags.push({ id: app.favId, name: "Favorite" });
    else x.tags = x.tags.filter((tg) => tg.id !== app.favId);
    const b = host.querySelector("[data-fav]");
    b.classList.toggle("is-on", on);
    b.innerHTML = `<span class="kb-dotmini"></span>${on ? t("Favorite") : t("Add to favorites")}`;
    const heart = b.querySelector(".kb-dotmini");
    if (on) {
      pop(heart, 1.8);
      burst(heart, "heart", 7);
    } else pop(heart, 0.7);
    toast(on ? t("Marked as favorite") : t("Favorite removed"));
    if (app.context && app.context.hang) {
      const p = app.context.hang.pieces.find((q) => q.kind === kind && q.id === x.id);
      if (p) app.context.hang.update(Object.assign({}, p, { fav: on }));
    }
  }
  async function o(delta) {
    const x = getItem();
    const btn = host.querySelector("[data-o]");
    if (delta > 0 && btn) {
      // Right away – the counter follows when Stash has answered
      pop(btn, 1.18);
      burst(btn.querySelector(".kb-ic") || btn, "drop");
    }
    const n = delta > 0 ? await addO(kind, x.id) : await removeO(kind, x.id);
    x.o_counter = n;
    host.querySelector("[data-ocount]").textContent = n;
  }
  return { rate, fav, o };
}
