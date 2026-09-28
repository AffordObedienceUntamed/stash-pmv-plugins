// Edit drawer: one item in detail, several items together (add/remove tags, rating).

import { esc, openDrawer, toast, errorToast, starsHtml, plural, confirmDialog } from "../ui.js";
import { getScene, getImage, getGallery, updateItem, bulkUpdate, destroyItems, favoriteTagId, setFavorite } from "../api.js";
import { tagPicker } from "./tagpicker.js";
import { app } from "../main.js";

const NAMES = { scene: ["Scene", "Scenes"], image: ["Image", "Images"], gallery: ["Gallery", "Galleries"] };
const GET = { scene: getScene, image: getImage, gallery: getGallery };

export function openEditor(kind, pieces, { onSaved, onDeleted } = {}) {
  if (pieces.length === 1) return editOne(kind, pieces[0].id, { onSaved, onDeleted });
  return editMany(kind, pieces, { onSaved });
}

function starInput(host, value, onChange) {
  let v = Math.round((value || 0) / 20);
  const paint = () => {
    host.innerHTML = starsHtml(v * 20, true) + `<button type="button" class="kb-btn is-ghost" data-clear${v ? "" : " hidden"}>None</button>`;
  };
  host.addEventListener("click", (e) => {
    const s = e.target.closest("[data-star]");
    if (s) {
      const n = Number(s.dataset.star);
      v = v === n ? 0 : n;
    } else if (e.target.closest("[data-clear]")) v = 0;
    else return;
    paint();
    onChange(v * 20);
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
  const tagIds = x.tags.map((t) => t.id).filter((t) => t !== favId);
  const isFav = !!favId && x.tags.some((t) => t.id === favId);
  const path =
    kind === "scene" ? (x.files[0] || {}).path : kind === "image" ? (x.visual_files[0] || {}).path : (x.folder && x.folder.path) || ((x.files || [])[0] || {}).path;
  const state = { rating100: x.rating100 || 0, tags: tagIds, fav: isFav };

  const d = openDrawer({
    title: `Edit ${NAMES[kind][0].toLowerCase()}`,
    body: `
      <label class="kb-form-row"><span>Title</span><input class="kb-field" data-e="title" value="${esc(x.title || "")}" placeholder="${esc(path ? path.split(/[\\/]/).pop() : "")}"></label>
      <div class="kb-form-row"><span>Rating</span><div data-stars></div></div>
      <label class="kb-switch"><input type="checkbox" data-e="fav"${isFav ? " checked" : ""}><i></i><span>Favorite (heart)</span></label>
      <div class="kb-form-row"><span>Tags</span><div class="kb-tagpick" data-tags></div></div>
      <label class="kb-form-row"><span>Date</span><input class="kb-field" type="date" data-e="date" value="${esc(x.date || "")}"></label>
      <label class="kb-form-row"><span>Description</span><textarea class="kb-field" data-e="details" rows="4">${esc(x.details || "")}</textarea></label>
      <label class="kb-form-row"><span>Links (one per line)</span><textarea class="kb-field" data-e="urls" rows="2">${esc((x.urls || []).join("\n"))}</textarea></label>
      <label class="kb-switch"><input type="checkbox" data-e="organized"${x.organized ? " checked" : ""}><i></i><span>Organized</span></label>
      ${path ? `<p class="kb-hint">File: ${esc(path)}</p>` : ""}`,
    foot: `<button class="kb-btn is-danger" data-del>Delete</button><span class="kb-spacer"></span><button class="kb-btn" data-cancel>Cancel</button><button class="kb-btn is-primary" data-save>Save</button>`,
  });
  const el = d.el;
  starInput(el.querySelector("[data-stars]"), state.rating100, (v) => (state.rating100 = v));
  const picker = tagPicker(el.querySelector("[data-tags]"), { include: tagIds, allowCreate: true, placeholder: "Search or create a tag" });
  el.querySelector("[data-cancel]").onclick = d.close;
  el.querySelector("[data-save]").onclick = async () => {
    const v = (k) => el.querySelector(`[data-e="${k}"]`);
    const fav = v("fav").checked;
    let tags = picker.include;
    const favTag = fav ? await favoriteTagId(true) : favId;
    if (favTag) tags = fav ? [...new Set([...tags, favTag])] : tags.filter((t) => t !== favTag);
    const input = {
      id,
      title: v("title").value.trim(),
      date: v("date").value || null,
      details: v("details").value,
      urls: v("urls").value.split(/\n+/).map((u) => u.trim()).filter(Boolean),
      rating100: state.rating100 || null,
      organized: v("organized").checked,
      tag_ids: tags,
    };
    try {
      el.querySelector("[data-save]").disabled = true;
      await updateItem(kind, input);
      app.favId = favTag || app.favId;
      toast("Saved", "ok");
      d.close();
      onSaved && onSaved();
    } catch (e) {
      el.querySelector("[data-save]").disabled = false;
      errorToast(e, "Saving failed");
    }
  };
  el.querySelector("[data-del]").onclick = async () => {
    const r = await confirmDialog({
      title: `Delete ${NAMES[kind][0].toLowerCase()}?`,
      text: "The item disappears from Stash. With the box ticked, the file on disk is deleted too – this can't be undone.",
      ok: "Delete",
      danger: true,
      checkbox: "Also delete the file from disk",
    });
    if (!r.ok) return;
    try {
      await destroyItems(kind, [id], r.checked);
      toast("Deleted", "ok");
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
    title: `Edit ${plural(ids.length, NAMES[kind][0].toLowerCase(), NAMES[kind][1].toLowerCase())}`,
    body: `
      <p class="kb-hint">Only what you change here is applied to all selected items. Everything else stays as it is.</p>
      <div class="kb-form-row"><span>Add tags</span><div class="kb-tagpick" data-add></div></div>
      <div class="kb-form-row"><span>Remove tags</span><div class="kb-tagpick" data-rm></div></div>
      <div class="kb-form-row"><span>Set rating</span><div data-stars></div></div>
      <label class="kb-form-row"><span>Organized</span><select class="kb-field" data-org><option value="">don't change</option><option value="1">organized</option><option value="0">not organized</option></select></label>`,
    foot: `<span class="kb-spacer"></span><button class="kb-btn" data-cancel>Cancel</button><button class="kb-btn is-primary" data-save>Apply to all</button>`,
  });
  const el = d.el;
  const addP = tagPicker(el.querySelector("[data-add]"), { allowCreate: true, placeholder: "Search or create a tag" });
  const rmP = tagPicker(el.querySelector("[data-rm]"), { placeholder: "Search tag" });
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
      if (!jobs.length && Object.keys(base).length > 1) jobs.push(base);
      for (const j of jobs) await bulkUpdate(kind, j);
      toast(jobs.length ? `${plural(ids.length, "item", "items")} updated` : "Nothing changed", "ok");
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
