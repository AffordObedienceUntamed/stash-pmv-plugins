// Browse the tags like a tree (parents → children, the number of items behind each), instead of remembering names: tap a tag to
// pick it, tap again to take it back. A search flattens the tree to the matches (with the way to them). Opened from the tag fields.

import { esc, fmtNum, openDrawer } from "../ui.js";
import { t } from "../i18n.js";

const count = (tg) => (tg.scene_count || 0) + (tg.image_count || 0) + (tg.gallery_count || 0);

// tags: the whole list (with parents / children); selected(): the ids picked now; onToggle(tag, on): the field takes it over
export function openTagBrowser({ tags, selected, onToggle }) {
  const byId = new Map(tags.map((x) => [x.id, x]));
  const kids = (tg) => (tg.children || []).map((c) => byId.get(c.id)).filter(Boolean);
  const roots = tags.filter((x) => !(x.parents || []).length).sort((a, b) => a.name.localeCompare(b.name));
  const open = new Set();
  const d = openDrawer({
    title: t("Browse tags"),
    body: `<input class="kb-field" type="search" data-q placeholder="${t("Search tag")}" autocomplete="off" spellcheck="false" aria-label="${t("Search tag")}">
      <p class="kb-hint" data-sub></p>
      <div class="kb-tagtree" data-tree></div>`,
    foot: `<span class="kb-spacer"></span><button type="button" class="kb-btn is-primary" data-done>${t("Done")}</button>`,
  });
  const el = d.el;
  const tree = el.querySelector("[data-tree]");
  const q = el.querySelector("[data-q]");
  const sub = el.querySelector("[data-sub]");
  el.classList.add("kb-tagbrowse");

  const row = (tg, depth, path) => {
    const on = selected().includes(tg.id);
    const k = kids(tg);
    return `<div class="kb-tagrow${on ? " is-on" : ""}" style="--depth:${depth}" data-id="${esc(tg.id)}">
      ${k.length ? `<button type="button" class="kb-tagcaret${open.has(tg.id) ? " is-open" : ""}" data-caret="${esc(tg.id)}" aria-label="${t("Show the tags below")}">▸</button>` : `<span class="kb-tagcaret is-none"></span>`}
      <button type="button" class="kb-tagname" data-pick="${esc(tg.id)}">${esc(tg.name)}${path ? `<small>${esc(path)}</small>` : ""}</button>
      <span class="kb-tagn">${fmtNum(count(tg))}${k.length ? ` · ${t("{n} below", { n: k.length })}` : ""}</span>
      <span class="kb-tagmark">${on ? "✓" : "+"}</span>
    </div>`;
  };
  const walk = (list, depth, seen) =>
    list
      .map((tg) => {
        if (seen.has(tg.id)) return "";
        const s2 = new Set(seen).add(tg.id);
        return row(tg, depth, "") + (open.has(tg.id) ? walk(kids(tg).sort((a, b) => a.name.localeCompare(b.name)), depth + 1, s2) : "");
      })
      .join("");
  const wayOf = (tg) => {
    const p = (tg.parents || []).map((x) => byId.get(x.id)).filter(Boolean)[0];
    return p ? (wayOf(p) ? wayOf(p) + " › " : "") + p.name : "";
  };
  const paint = () => {
    const s = q.value.trim().toLowerCase();
    if (!s) {
      sub.textContent = t("{n} tags", { n: tags.length });
      tree.innerHTML = walk(roots, 0, new Set());
      return;
    }
    const hit = tags.filter((x) => x.name.toLowerCase().includes(s) || (x.aliases || []).some((a) => a.toLowerCase().includes(s))).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200);
    sub.textContent = t("{n} matches", { n: hit.length });
    tree.innerHTML = hit.map((tg) => row(tg, 0, wayOf(tg))).join("") || `<p class="kb-hint">${t("No matching tag")}</p>`;
  };
  tree.addEventListener("click", (e) => {
    const c = e.target.closest("[data-caret]");
    if (c) {
      const id = c.dataset.caret;
      open.has(id) ? open.delete(id) : open.add(id);
      paint();
      return;
    }
    const p = e.target.closest("[data-pick]");
    if (!p) return;
    const tg = byId.get(p.dataset.pick);
    if (!tg) return;
    const on = !selected().includes(tg.id);
    onToggle(tg, on);
    const r = p.closest(".kb-tagrow");
    r.classList.toggle("is-on", on);
    r.querySelector(".kb-tagmark").textContent = on ? "✓" : "+";
  });
  q.addEventListener("input", paint);
  el.querySelector("[data-done]").onclick = d.close;
  paint();
  q.focus();
}
