// All tags as an index, with item counts.

import { esc, icon, debounce, errorToast, plural, promptDialog } from "../ui.js";
import { findTags, createTag } from "../api.js";
import { app, go } from "../main.js";
import { tagsCache } from "./tagpicker.js";

export async function render(main, params, query) {
  main.innerHTML = `
    <header class="kb-head">
      <div class="kb-head-title">
        <h1 class="kb-h1">Tags</h1>
        <p class="kb-sub" data-sub></p>
      </div>
      <div class="kb-head-tools">
        <label class="kb-search">${icon("search")}<input class="kb-field" type="search" data-q placeholder="Search tags" value="${esc(query.q || "")}"></label>
        <select class="kb-field" data-sort aria-label="Sort order">
          <option value="name">Alphabetical</option>
          <option value="scenes_count">Most scenes</option>
          <option value="images_count">Most images</option>
          <option value="created_at">Newest</option>
        </select>
        <button class="kb-btn" data-new>${icon("plus")}New tag</button>
      </div>
    </header>
    <div class="kb-taglist" data-list><div class="kb-loading">Loading …</div></div>`;
  const $ = (s) => main.querySelector(s);
  $("[data-sort]").value = query.sort || "name";

  async function load() {
    try {
      const r = await findTags($("[data-q]").value.trim(), -1, $("[data-sort]").value);
      const list = r.tags.filter((t) => t.id !== app.favId);
      $("[data-sub]").textContent = plural(list.length, "Tag", "Tags");
      $("[data-list]").innerHTML = list.length
        ? list
            .map(
              (t) => `<a class="kb-tagrow" href="#/tag/${t.id}"><b>${esc(t.name)}</b><small>${[
                t.scene_count ? plural(t.scene_count, "scene", "scenes") : "",
                t.image_count ? plural(t.image_count, "image", "images") : "",
                t.gallery_count ? plural(t.gallery_count, "gallery", "galleries") : "",
              ]
                .filter(Boolean)
                .join(", ") || "empty"}</small></a>`
            )
            .join("")
        : `<div class="kb-empty"><b>No tag found</b><p>Create one with “New tag”.</p></div>`;
    } catch (e) {
      errorToast(e, "Tags");
    }
  }
  $("[data-q]").addEventListener("input", debounce(load, 250));
  $("[data-sort]").onchange = load;
  $("[data-new]").onclick = async () => {
    const name = await promptDialog({ title: "New tag", label: "Name", ok: "Create" });
    if (!name) return;
    try {
      const t = await createTag(name.trim());
      tagsCache(true);
      go("tag/" + t.id);
    } catch (e) {
      errorToast(e, "Create tag");
    }
  };
  load();
}
