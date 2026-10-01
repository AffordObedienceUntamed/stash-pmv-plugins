// Edit drawer: one item in detail, several items together (add/remove tags, rating).

import { esc, openDrawer, toast, errorToast, starsHtml, ratingClick, ratingFromInput, plural, confirmDialog } from "../ui.js";
import { t } from "../i18n.js";
import { getScene, getImage, getGallery, updateItem, bulkUpdate, destroyItems, favoriteTagId, setFavorite } from "../api.js";
import { tagPicker } from "./tagpicker.js";
import { perfPicker, knowPerformers } from "./perfpicker.js";
import { app } from "../main.js";

const UNITS = { scene: ["scene", "scenes"], image: ["image", "images"], gallery: ["gallery", "galleries"] };
// Whole sentences per kind – other languages can't just insert the word
const TITLES = { scene: ["Edit scene", "Delete scene?"], image: ["Edit image", "Delete image?"], gallery: ["Edit gallery", "Delete gallery?"] };
const GET = { scene: getScene, image: getImage, gallery: getGallery };

export function openEditor(kind, pieces, { onSaved, onDeleted } = {}) {
  if (pieces.length === 1) return editOne(kind, pieces[0].id, { onSaved, onDeleted });
  return editMany(kind, pieces, { onSaved });
}

// The rating in the chosen system (stars, half stars … or 0–10); v = rating100, 0 = none
function starInput(host, value, onChange) {
  let v = value || 0;
  const paint = () => {
    host.innerHTML = starsHtml(v, true) + `<button type="button" class="kb-btn is-ghost" data-clear${v ? "" : " hidden"}>${t("None")}</button>`;
  };
  host.addEventListener("click", (e) => {
    const r = ratingClick(e, v);
    if (r !== undefined) v = r || 0;
    else if (e.target.closest("[data-clear]")) v = 0;
    else return;
    paint();
    onChange(v);
  });
  host.addEventListener("change", (e) => {
    const r = e.target.matches("[data-ratedec]") ? ratingFromInput(e.target) : undefined;
    if (r === undefined) return;
    v = r || 0;
    host.querySelector("[data-clear]").hidden = !v;
    onChange(v);
  });
  paint();
}

async function editOne(kind, id, { onSaved, onDeleted }) {
  let x;
  try {
    x = await GET[kind](id);
  } catch (e) {
    return errorToast(e, "Couldn't be loaded");
  }
  const favId = await favoriteTagId(false);
  const tagIds = x.tags.map((tg) => tg.id).filter((tg) => tg !== favId);
  const isFav = !!favId && x.tags.some((tg) => tg.id === favId);
  const path =
    kind === "scene" ? (x.files[0] || {}).path : kind === "image" ? (x.visual_files[0] || {}).path : (x.folder && x.folder.path) || ((x.files || [])[0] || {}).path;
  const state = { rating100: x.rating100 || 0, tags: tagIds, fav: isFav };

  const d = openDrawer({
    title: t(TITLES[kind][0]),
    body: `
      <label class="kb-form-row"><span>${t("Title")}</span><input class="kb-field" data-e="title" value="${esc(x.title || "")}" placeholder="${esc(path ? path.split(/[\\/]/).pop() : "")}"></label>
      <div class="kb-form-row"><span>${t("Rating")}</span><div data-stars></div></div>
      <label class="kb-switch"><input type="checkbox" data-e="fav"${isFav ? " checked" : ""}><i></i><span>${t("Favorite (heart)")}</span></label>
      <div class="kb-form-row"><span>${t("Tags")}</span><div class="kb-tagpick" data-tags></div></div>
      <div class="kb-form-row"><span>${t("Performers")}</span><div class="kb-tagpick" data-perfs></div></div>
      <label class="kb-form-row"><span>${t("Date")}</span><input class="kb-field" type="date" data-e="date" value="${esc(x.date || "")}"></label>
      <label class="kb-form-row"><span>${t("Description")}</span><textarea class="kb-field" data-e="details" rows="4">${esc(x.details || "")}</textarea></label>
      <label class="kb-form-row"><span>${t("Links (one per line)")}</span><textarea class="kb-field" data-e="urls" rows="2">${esc((x.urls || []).join("\n"))}</textarea></label>
      <label class="kb-switch"><input type="checkbox" data-e="organized"${x.organized ? " checked" : ""}><i></i><span>${t("Organized")}</span></label>
      ${path ? `<p class="kb-hint">${t("File:")} ${esc(path)}</p>` : ""}`,
    foot: `<button class="kb-btn is-danger" data-del>${t("Delete")}</button><span class="kb-spacer"></span><button class="kb-btn" data-cancel>${t("Cancel")}</button><button class="kb-btn is-primary" data-save>${t("Save")}</button>`,
  });
  const el = d.el;
  starInput(el.querySelector("[data-stars]"), state.rating100, (v) => (state.rating100 = v));
  const picker = tagPicker(el.querySelector("[data-tags]"), { include: tagIds, allowCreate: true, placeholder: t("Search or create a tag") });
  knowPerformers(x.performers);
  const perfs = perfPicker(el.querySelector("[data-perfs]"), { include: (x.performers || []).map((p) => p.id), modes: false, allowCreate: true, placeholder: t("Search or create a performer") });
  el.querySelector("[data-cancel]").onclick = d.close;
  el.querySelector("[data-save]").onclick = async () => {
    const v = (k) => el.querySelector(`[data-e="${k}"]`);
    const fav = v("fav").checked;
    let tags = picker.include;
    const favTag = fav ? await favoriteTagId(true) : favId;
    if (favTag) tags = fav ? [...new Set([...tags, favTag])] : tags.filter((tg) => tg !== favTag);
    const input = {
      id,
      title: v("title").value.trim(),
      date: v("date").value || null,
      details: v("details").value,
      urls: v("urls").value.split(/\n+/).map((u) => u.trim()).filter(Boolean),
      rating100: state.rating100 || null,
      organized: v("organized").checked,
      tag_ids: tags,
      performer_ids: perfs.include,
    };
    try {
      el.querySelector("[data-save]").disabled = true;
      await updateItem(kind, input);
      app.favId = favTag || app.favId;
      toast(t("Saved"), "ok");
      d.close();
      onSaved && onSaved();
    } catch (e) {
      el.querySelector("[data-save]").disabled = false;
      errorToast(e, "Saving failed");
    }
  };
  el.querySelector("[data-del]").onclick = async () => {
    const r = await confirmDialog({
      title: t(TITLES[kind][1]),
      text: t("The item disappears from Stash. With the box ticked, the file on disk is deleted too – this can't be undone."),
      ok: t("Delete"),
      danger: true,
      checkbox: t("Also delete the file from disk"),
    });
    if (!r.ok) return;
    try {
      await destroyItems(kind, [id], r.checked);
      toast(t("Deleted"), "ok");
      d.close();
      onDeleted ? onDeleted() : onSaved && onSaved();
    } catch (e) {
      errorToast(e, "Deleting failed");
    }
  };
}

function editMany(kind, pieces, { onSaved }) {
  const ids = pieces.map((p) => p.id);
  const state = { rating100: undefined, add: [], remove: [], organized: "" };
  const d = openDrawer({
    title: t("Edit {what}", { what: plural(ids.length, UNITS[kind][0], UNITS[kind][1]) }),
    body: `
      <p class="kb-hint">${t("Only what you change here is applied to all selected items. Everything else stays as it is.")}</p>
      <div class="kb-form-row"><span>${t("Add tags")}</span><div class="kb-tagpick" data-add></div></div>
      <div class="kb-form-row"><span>${t("Remove tags")}</span><div class="kb-tagpick" data-rm></div></div>
      <div class="kb-form-row"><span>${t("Add performers")}</span><div class="kb-tagpick" data-padd></div></div>
      <div class="kb-form-row"><span>${t("Remove performers")}</span><div class="kb-tagpick" data-prm></div></div>
      <div class="kb-form-row"><span>${t("Set rating")}</span><div data-stars></div></div>
      <label class="kb-form-row"><span>${t("Organized")}</span><select class="kb-field" data-org><option value="">${t("don't change")}</option><option value="1">${t("organized")}</option><option value="0">${t("not organized")}</option></select></label>`,
    foot: `<span class="kb-spacer"></span><button class="kb-btn" data-cancel>${t("Cancel")}</button><button class="kb-btn is-primary" data-save>${t("Apply to all")}</button>`,
  });
  const el = d.el;
  const addP = tagPicker(el.querySelector("[data-add]"), { allowCreate: true, placeholder: t("Search or create a tag") });
  const rmP = tagPicker(el.querySelector("[data-rm]"), { placeholder: t("Search tag") });
  const addPerf = perfPicker(el.querySelector("[data-padd]"), { modes: false, allowCreate: true, placeholder: t("Search or create a performer") });
  const rmPerf = perfPicker(el.querySelector("[data-prm]"), { modes: false, placeholder: t("Search performer") });
  starInput(el.querySelector("[data-stars]"), 0, (v) => (state.rating100 = v));
  el.querySelector("[data-cancel]").onclick = d.close;
  el.querySelector("[data-save]").onclick = async () => {
    try {
      el.querySelector("[data-save]").disabled = true;
      const base = { ids };
      if (state.rating100 !== undefined) base.rating100 = state.rating100 || null;
      const org = el.querySelector("[data-org]").value;
      if (org) base.organized = org === "1";
      const jobs = [];
      if (addP.include.length) jobs.push(Object.assign({}, base, { tag_ids: { ids: addP.include, mode: "ADD" } }));
      if (rmP.include.length) jobs.push({ ids, tag_ids: { ids: rmP.include, mode: "REMOVE" } });
      if (addPerf.include.length) jobs.push({ ids, performer_ids: { ids: addPerf.include, mode: "ADD" } });
      if (rmPerf.include.length) jobs.push({ ids, performer_ids: { ids: rmPerf.include, mode: "REMOVE" } });
      if (!addP.include.length && Object.keys(base).length > 1) jobs.push(base); // rating/organized ride along with added tags, otherwise on their own
      for (const j of jobs) await bulkUpdate(kind, j);
      toast(jobs.length ? t("{what} updated", { what: plural(ids.length, "item", "items") }) : t("Nothing changed"), "ok");
      d.close();
      jobs.length && onSaved && onSaved();
    } catch (e) {
      el.querySelector("[data-save]").disabled = false;
      errorToast(e, "Saving failed");
    }
  };
}

export async function toggleFavorite(kind, piece) {
  await setFavorite(kind, [piece.id], !piece.fav);
  app.favId = await favoriteTagId(false);
  return !piece.fav;
}
