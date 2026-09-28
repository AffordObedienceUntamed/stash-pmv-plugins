// Search everything: tags, folders, scenes, images, galleries.

import { esc, icon, debounce, plural, errorToast } from "../ui.js";
import { findTags, loadFolders } from "../api.js";
import { mediaBrowser } from "./media.js";
import { setQuery, app } from "../main.js";

export function render(main, params, query) {
  main.innerHTML = `
    <header class="kb-head">
      <div class="kb-head-title">
        <h1 class="kb-h1">Search</h1>
        <label class="kb-search kb-search-big">${icon("search")}<input class="kb-field" type="search" data-q placeholder="Title, file name, tag or folder" value="${esc(query.q || "")}" autofocus></label>
      </div>
    </header>
    <div data-quick></div>
    <section data-browser></section>`;
  const $ = (s) => main.querySelector(s);
  let b = null;
  let alive = true;

  async function run() {
    // Ignore late searches after leaving the page
    if (!alive) return;
    const q = $("[data-q]").value.trim();
    setQuery({ q });
    if (b) b.destroy();
    $("[data-browser]").innerHTML = "";
    $("[data-quick]").innerHTML = "";
    if (q.length < 2) {
      $("[data-quick]").innerHTML = `<p class="kb-hint">Enter at least two characters.</p>`;
      return;
    }
    // Tags and folders as quick jumps
    try {
      const [tags, tree] = await Promise.all([findTags(q, 20), loadFolders()]);
      if (!alive) return;
      const low = q.toLowerCase();
      const folders = [...tree.nodes.values()].filter((n) => n.timg + n.tvid > 0 && n.name.toLowerCase().includes(low)).slice(0, 20);
      const tagList = tags.tags.filter((t) => t.id !== app.favId);
      $("[data-quick]").innerHTML =
        (tagList.length ? `<h2 class="kb-h2">Tags</h2><div class="kb-chips">${tagList.map((t) => `<a class="kb-chip" href="#/tag/${t.id}">${esc(t.name)}</a>`).join("")}</div>` : "") +
        (folders.length ? `<h2 class="kb-h2">Folders</h2><div class="kb-chips">${folders.map((n) => `<a class="kb-chip" href="#/folder/${n.id}" title="${esc(n.path)}">${icon("folder")}${esc(n.name)}</a>`).join("")}</div>` : "") +
        `<h2 class="kb-h2">Results</h2>`;
    } catch (e) {
      errorToast(e, "Search");
    }
    if (!alive) return;
    b = mediaBrowser($("[data-browser]"), { kinds: ["scene", "image", "gallery"], query: Object.assign({}, query, { q }), search: false });
  }
  const input = $("[data-q]");
  input.addEventListener("input", debounce(run, 350));
  if (query.q) run();
  else input.focus();
  return () => {
    alive = false;
    if (b) b.destroy();
  };
}
