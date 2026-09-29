// A tag: details, parent/child tags, all items with this tag.

import { esc, icon, errorToast, toast, openDrawer, confirmDialog, plural } from "../ui.js";
import { t } from "../i18n.js";
import { getTag, gql } from "../api.js";
import { mediaBrowser } from "./media.js";
import { go } from "../main.js";
import { tagsCache } from "./tagpicker.js";

export async function render(main, params, query) {
  const tag = await getTag(params.id);
  if (!tag) {
    main.innerHTML = `<div class="kb-empty"><b>${t("This tag no longer exists")}</b><a class="kb-btn" href="#/tags">${t("All tags")}</a></div>`;
    return;
  }
  const kinds = [];
  if (tag.scene_count) kinds.push("scene");
  if (tag.image_count) kinds.push("image");
  if (tag.gallery_count) kinds.push("gallery");
  if (!kinds.length) kinds.push("scene");
  main.innerHTML = `
    <header class="kb-head">
      <div class="kb-head-title">
        <nav class="kb-crumbs"><span><a href="#/tags">${t("Tags")}</a></span>${tag.parents.map((p) => `<span><a href="#/tag/${p.id}">${esc(p.name)}</a></span>`).join("")}</nav>
        <h1 class="kb-h1">${esc(tag.name)}</h1>
        <p class="kb-sub">${[tag.scene_count ? plural(tag.scene_count, "scene", "scenes") : "", tag.image_count ? plural(tag.image_count, "image", "images") : "", tag.gallery_count ? plural(tag.gallery_count, "gallery", "galleries") : ""].filter(Boolean).join(t(", ")) || t("Nothing tagged yet")}</p>
        ${tag.description ? `<p class="kb-lead">${esc(tag.description)}</p>` : ""}
        ${tag.children.length ? `<div class="kb-chips kb-head-chips">${tag.children.map((c) => `<a class="kb-chip" href="#/tag/${c.id}">${esc(c.name)}</a>`).join("")}</div>` : ""}
      </div>
      <div class="kb-head-tools">
        <button class="kb-btn" data-edit>${icon("edit")}${t("Edit")}</button>
      </div>
    </header>
    <section data-browser></section>`;
  const b = mediaBrowser(main.querySelector("[data-browser]"), { kinds, query, base: () => ({ tagId: tag.id }) });

  main.querySelector("[data-edit]").onclick = () => {
    const d = openDrawer({
      title: t("Edit tag"),
      body: `
        <label class="kb-form-row"><span>${t("Name")}</span><input class="kb-field" data-e="name" value="${esc(tag.name)}"></label>
        <label class="kb-form-row"><span>${t("Aliases (comma separated)")}</span><input class="kb-field" data-e="aliases" value="${esc(tag.aliases.join(", "))}"></label>
        <label class="kb-form-row"><span>${t("Description")}</span><textarea class="kb-field" data-e="description">${esc(tag.description || "")}</textarea></label>`,
      foot: `<button class="kb-btn is-danger" data-del>${t("Delete tag")}</button><span class="kb-spacer"></span><button class="kb-btn" data-cancel>${t("Cancel")}</button><button class="kb-btn is-primary" data-save>${t("Save")}</button>`,
    });
    const v = (k) => d.el.querySelector(`[data-e="${k}"]`).value;
    d.el.querySelector("[data-cancel]").onclick = d.close;
    d.el.querySelector("[data-save]").onclick = async () => {
      try {
        await gql(`mutation($i: TagUpdateInput!) { tagUpdate(input: $i) { id } }`, {
          i: { id: tag.id, name: v("name").trim(), description: v("description"), aliases: v("aliases").split(",").map((a) => a.trim()).filter(Boolean) },
        });
        tagsCache(true);
        toast(t("Tag saved"), "ok");
        d.close();
        go("tag/" + tag.id, true);
      } catch (e) {
        errorToast(e, "Save");
      }
    };
    d.el.querySelector("[data-del]").onclick = async () => {
      const r = await confirmDialog({ title: t("Delete tag “{name}”?", { name: tag.name }), text: t("The tag is removed from all items. The items themselves stay."), ok: t("Delete"), danger: true });
      if (!r.ok) return;
      try {
        await gql(`mutation($id: ID!) { tagDestroy(input: { id: $id }) }`, { id: tag.id });
        tagsCache(true);
        d.close();
        toast(t("Tag deleted"), "ok");
        go("tags", true);
      } catch (e) {
        errorToast(e, "Delete");
      }
    };
  };
  return () => b.destroy();
}
