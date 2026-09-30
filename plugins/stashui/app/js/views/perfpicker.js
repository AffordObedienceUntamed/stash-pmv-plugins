// Pick performers for a filter: type a name, choose from the suggestions, remove with ×.

import { esc, icon } from "../ui.js";
import { t } from "../i18n.js";
import { gql } from "../api.js";

const names = new Map(); // id → name, so chips from the address bar show names
let countP = null;

// Does this library have performers at all? (Asked once – without any, the filter isn't shown)
export function hasPerformers() {
  if (!countP) countP = gql(`query { findPerformers(filter: { per_page: 0 }) { count } }`).then((d) => d.findPerformers.count > 0).catch(() => false);
  return countP;
}

export function perfPicker(host, { include = [], any = false, onChange }) {
  let ids = [...include];
  let mode = any;
  let shown = [];
  let active = -1;
  host.innerHTML = `
    <div class="kb-chips" data-pchips></div>
    <input class="kb-field" type="text" data-pq placeholder="${esc(t("Add performer …"))}" autocomplete="off" spellcheck="false" aria-label="${esc(t("Add performer"))}">
    <div class="kb-sugg" data-psugg hidden role="listbox"></div>`;
  const chips = host.querySelector("[data-pchips]");
  const input = host.querySelector("[data-pq]");
  const sugg = host.querySelector("[data-psugg]");

  function paint() {
    chips.hidden = !ids.length;
    chips.innerHTML =
      ids.map((id) => `<span class="kb-chip is-on" data-pid="${esc(id)}">${icon("person")}${esc(names.get(id) || "#" + id)}<button type="button" data-prm aria-label="${esc(t("Remove"))}">×</button></span>`).join("") +
      (ids.length > 1 ? `<button type="button" class="kb-chip kb-pmode" data-pmode title="${esc(t("Click to switch"))}">${mode ? t("any of them") : t("all of them")}</button>` : "");
  }
  // Names for IDs that came from the address bar
  const missing = ids.filter((id) => !names.has(id));
  if (missing.length)
    Promise.all(missing.map((id) => gql(`query($id: ID!) { findPerformer(id: $id) { id name } }`, { id }).catch(() => null))).then((rs) => {
      rs.forEach((r) => r && r.findPerformer && names.set(r.findPerformer.id, r.findPerformer.name));
      paint();
    });
  paint();

  let seq = 0;
  async function suggest() {
    const q = input.value.trim();
    const my = ++seq;
    const d = await gql(`query($f: FindFilterType) { findPerformers(filter: $f) { performers { id name disambiguation scene_count image_path } } }`, {
      f: { q: q || undefined, per_page: 8, sort: q ? "name" : "scenes_count", direction: q ? "ASC" : "DESC" },
    }).catch(() => null);
    if (my !== seq || !d) return;
    shown = d.findPerformers.performers.filter((p) => !ids.includes(p.id));
    active = shown.length ? 0 : -1;
    sugg.innerHTML = shown.length
      ? shown.map((p, i) => `<button type="button" class="kb-sugg-row kb-psugg${i === active ? " is-active" : ""}" data-add="${p.id}"><img alt="" loading="lazy" src="${esc(p.image_path || "")}"><span>${esc(p.name)}${p.disambiguation ? ` <small>(${esc(p.disambiguation)})</small>` : ""}</span><small>${p.scene_count || 0}</small></button>`).join("")
      : `<p class="kb-hint">${t("No performer found")}</p>`;
    sugg.hidden = false;
  }
  function add(p) {
    names.set(p.id, p.name);
    ids.push(p.id);
    input.value = "";
    sugg.hidden = true;
    paint();
    onChange(ids, mode);
  }
  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(suggest, 200);
  });
  input.addEventListener("focus", suggest);
  input.addEventListener("blur", () => setTimeout(() => (sugg.hidden = true), 150));
  input.addEventListener("keydown", (e) => {
    if (sugg.hidden || !shown.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
      sugg.querySelectorAll("[data-add]").forEach((b, i) => b.classList.toggle("is-active", i === active));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      add(shown[active]);
    } else if (e.key === "Escape") sugg.hidden = true;
  });
  sugg.addEventListener("mousedown", (e) => {
    const b = e.target.closest("[data-add]");
    if (!b) return;
    e.preventDefault();
    add(shown.find((p) => p.id === b.dataset.add));
  });
  chips.addEventListener("click", (e) => {
    if (e.target.closest("[data-pmode]")) {
      mode = !mode;
      paint();
      return onChange(ids, mode);
    }
    const c = e.target.closest("[data-prm]");
    if (!c) return;
    ids = ids.filter((id) => id !== c.closest("[data-pid]").dataset.pid);
    paint();
    onChange(ids, mode);
  });
}
