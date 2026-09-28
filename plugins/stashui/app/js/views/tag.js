// A tag: details, parent/child tags, all items with this tag.

import { esc, icon, errorToast, toast, openDrawer, confirmDialog, plural } from "../ui.js";
import { getTag, gql } from "../api.js";
import { mediaBrowser } from "./media.js";
import { go } from "../main.js";
import { tagsCache } from "./tagpicker.js";

export async function render(main, params, query) {
  const t = await getTag(params.id);
  if (!t) {
    main.innerHTML = `<div class="kb-empty"><b>This tag no longer exists</b><a class="kb-btn" href="#/tags">All tags</a></div>`;
    return;
  }
  const kinds = [];
  if (t.scene_count) kinds.push("scene");
  if (t.image_count) kinds.push("image");
  if (t.gallery_count) kinds.push("gallery");
  if (!kinds.length) kinds.push("scene");
  main.innerHTML = `
    <header class="kb-head">
      <div class="kb-head-title">
        <nav class="kb-crumbs"><span><a href="#/tags">Tags</a></span>${t.parents.map((p) => `<span><a href="#/tag/${p.id}">${esc(p.name)}</a></span>`).join("")}</nav>
        <h1 class="kb-h1">${esc(t.name)}</h1>
        <p class="kb-sub">${[t.scene_count ? plural(t.scene_count, "scene", "scenes") : "", t.image_count ? plural(t.image_count, "image", "images") : "", t.gallery_count ? plural(t.gallery_count, "gallery", "galleries") : ""].filter(Boolean).join(", ") || "Nothing tagged yet"}</p>
        ${t.description ? `<p class="kb-lead">${esc(t.description)}</p>` : ""}
        ${t.children.length ? `<div class="kb-chips kb-head-chips">${t.children.map((c) => `<a class="kb-chip" href="#/tag/${c.id}">${esc(c.name)}</a>`).join("")}</div>` : ""}
      </div>
      <div class="kb-head-tools">
        <button class="kb-btn" data-edit>${icon("edit")}Edit</button>
      </div>
    </header>
    <section data-browser></section>`;
  const b = mediaBrowser(main.querySelector("[data-browser]"), { kinds, query, base: () => ({ tagId: t.id }) });

  main.querySelector("[data-edit]").onclick = () => {
    const d = openDrawer({
      title: "Edit tag",
      body: `
        <label class="kb-form-row"><span>Name</span><input class="kb-field" data-e="name" value="${esc(t.name)}"></label>
        <label class="kb-form-row"><span>Aliases (comma separated)</span><input class="kb-field" data-e="aliases" value="${esc(t.aliases.join(", "))}"></label>
        <label class="kb-form-row"><span>Description</span><textarea class="kb-field" data-e="description">${esc(t.description || "")}</textarea></label>`,
      foot: `<button class="kb-btn is-danger" data-del>Delete tag</button><span class="kb-spacer"></span><button class="kb-btn" data-cancel>Cancel</button><button class="kb-btn is-primary" data-save>Save</button>`,
    });
    const v = (k) => d.el.querySelector(`[data-e="${k}"]`).value;
    d.el.querySelector("[data-cancel]").onclick = d.close;
    d.el.querySelector("[data-save]").onclick = async () => {
      try {
        await gql(`mutation($i: TagUpdateInput!) { tagUpdate(input: $i) { id } }`, {
          i: { id: t.id, name: v("name").trim(), description: v("description"), aliases: v("aliases").split(",").map((a) => a.trim()).filter(Boolean) },
        });
        tagsCache(true);
        toast("Tag saved", "ok");
        d.close();
        go("tag/" + t.id, true);
      } catch (e) {
        errorToast(e, "Save");
      }
    };
    d.el.querySelector("[data-del]").onclick = async () => {
      const r = await confirmDialog({ title: `Delete tag “${t.name}”?`, text: "The tag is removed from all items. The items themselves stay.", ok: "Delete", danger: true });
      if (!r.ok) return;
      try {
        await gql(`mutation($id: ID!) { tagDestroy(input: { id: $id }) }`, { id: t.id });
        tagsCache(true);
        d.close();
        toast("Tag deleted", "ok");
        go("tags", true);
      } catch (e) {
        errorToast(e, "Delete");
      }
    };
  };
  return () => b.destroy();
}
