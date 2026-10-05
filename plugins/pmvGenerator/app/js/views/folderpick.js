// Folder picker: chosen folders as chips (click a chip to remove it), below a searchable folder tree
// (collapsible, with the number of videos/images). Subfolders are always included.
// Each row: tick = take this folder, ⊘ = leave this folder out. Picking a subfolder of a picked folder narrows
// the choice to that subfolder; picking a folder above picked ones takes over from them.

import { esc, fmtNum } from "../ui.js";
import { loadFolders } from "../api.js";

const opened = new Set(); // folders whose subfolders are shown (kept while the page is open)

// opts: { selected: [{ id, path }], excluded: [{ id, path }], onChange(selected, excluded) }
export function folderPicker(host, opts) {
  let sel = [...(opts.selected || [])]; // [{ id, path }]
  let exc = [...(opts.excluded || [])];
  let rows = [];
  host.innerHTML = `<div class="kb-chips" data-fchips></div>
    <input class="kb-field" type="search" placeholder="Search folders …" autocomplete="off" spellcheck="false" aria-label="Search folders">
    <div class="kb-fpick" role="listbox" aria-multiselectable="true"><div class="kb-hint">Loading folders …</div></div>`;
  const chips = host.querySelector("[data-fchips]");
  const input = host.querySelector("input");
  const list = host.querySelector(".kb-fpick");
  const baseName = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
  const byId = (id) => rows.find((x) => x.id === id);
  // Is `id` inside (or the same as) the folder `anc`?
  const inside = (id, anc) => {
    for (let r = byId(id); r; r = r.parent ? byId(r.parent) : null) if (r.id === anc) return true;
    return false;
  };

  function renderChips() {
    chips.innerHTML =
      sel.map((f) => `<button type="button" class="kb-chip is-on" data-rm="${esc(f.id)}" title="${esc(f.path)} – click to remove">${esc(baseName(f.path))}<b aria-hidden="true">×</b></button>`).join("") +
      exc.map((f) => `<button type="button" class="kb-chip is-not" data-rm="${esc(f.id)}" title="${esc(f.path)} – left out, click to remove">${esc(baseName(f.path))}<b aria-hidden="true">×</b></button>`).join("") ||
      `<span class="kb-hint">All folders</span>`;
  }

  function renderList() {
    const q = input.value.trim().toLowerCase();
    const on = new Set(sel.map((f) => f.id));
    const off = new Set(exc.map((f) => f.id));
    // Inherited state: inside a picked folder (taken) or a left-out one (not taken)
    const via = (r) => {
      for (let p = r.parent ? byId(r.parent) : null; p; p = p.parent ? byId(p.parent) : null) {
        if (off.has(p.id)) return "off";
        if (on.has(p.id)) return "on";
      }
      return "";
    };
    // The tree shows what is opened; picked and left-out folders are always reachable
    const visible = (r) => {
      for (let p = r.parent ? byId(r.parent) : null; p; p = p.parent ? byId(p.parent) : null) if (!opened.has(p.id)) return false;
      return true;
    };
    const shown = (q ? rows.filter((r) => r.path.toLowerCase().includes(q)) : rows.filter(visible)).slice(0, 400);
    list.innerHTML = shown.length
      ? shown
          .map((r) => {
            const n = [r.tvid ? fmtNum(r.tvid) + " V" : "", r.timg ? fmtNum(r.timg) + " I" : ""].filter(Boolean).join(" · ");
            const st = on.has(r.id) ? "on" : off.has(r.id) ? "off" : via(r);
            const own = on.has(r.id) || off.has(r.id);
            const caret = !q && r.kids ? `<button type="button" class="kb-fpick-caret${opened.has(r.id) ? " is-open" : ""}" data-fo="${esc(r.id)}" aria-label="${opened.has(r.id) ? "Close" : "Open"} subfolders" title="Subfolders">▸</button>` : `<span class="kb-fpick-caret"></span>`;
            return `<div class="kb-fpick-row${st ? " is-" + st : ""}${own ? " is-own" : ""}" role="option" aria-selected="${st === "on"}" style="--d:${q ? 0 : r.depth}">
              ${caret}
              <button type="button" class="kb-fpick-main" data-fid="${esc(r.id)}" title="${esc(r.path)}"><i class="kb-fpick-box"></i><span>${esc(q ? r.path : r.name)}</span><small>${n}</small></button>
              <button type="button" class="kb-fpick-x${off.has(r.id) ? " is-on" : ""}" data-fx="${esc(r.id)}" aria-label="Leave this folder out" title="Leave this folder out">⊘</button>
            </div>`;
          })
          .join("")
      : `<div class="kb-hint">No folder matches</div>`;
  }

  const emit = () => opts.onChange && opts.onChange(sel.map((f) => ({ ...f })), exc.map((f) => ({ ...f })));
  const refresh = () => {
    renderChips();
    renderList();
    emit();
  };
  function take(id) {
    const r = byId(id);
    if (!r) return;
    if (sel.some((f) => f.id === id)) return (sel = sel.filter((f) => f.id !== id)), refresh();
    exc = exc.filter((f) => f.id !== id);
    // narrow to a subfolder of a picked folder / take over from picked folders below
    sel = sel.filter((f) => !inside(id, f.id) && !inside(f.id, id));
    sel.push({ id: r.id, path: r.path });
    refresh();
  }
  function leaveOut(id) {
    const r = byId(id);
    if (!r) return;
    if (exc.some((f) => f.id === id)) return (exc = exc.filter((f) => f.id !== id)), refresh();
    sel = sel.filter((f) => f.id !== id);
    exc = exc.filter((f) => !inside(f.id, id)); // (a left-out folder inside another left-out one is redundant)
    if (!exc.some((f) => inside(id, f.id))) exc.push({ id: r.id, path: r.path });
    refresh();
  }

  list.addEventListener("click", (e) => {
    const o = e.target.closest("[data-fo]");
    if (o) {
      opened.has(o.dataset.fo) ? opened.delete(o.dataset.fo) : opened.add(o.dataset.fo);
      return renderList();
    }
    const x = e.target.closest("[data-fx]");
    if (x) return leaveOut(x.dataset.fx);
    const b = e.target.closest("[data-fid]");
    if (b) take(b.dataset.fid);
  });
  chips.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (!b) return;
    sel = sel.filter((f) => f.id !== b.dataset.rm);
    exc = exc.filter((f) => f.id !== b.dataset.rm);
    refresh();
  });
  input.addEventListener("input", renderList);

  renderChips();
  loadFolders()
    .then((tree) => {
      const walk = (n, d, parent) => {
        rows.push({ id: n.id, path: n.path, name: n.name, depth: d, parent, kids: n.kids.length, tvid: n.tvid, timg: n.timg });
        n.kids.forEach((k) => walk(k, d + 1, n.id));
      };
      tree.roots.forEach((r) => walk(r, 0, null));
      // Open the first level, and the way to every folder already picked or left out
      rows.filter((r) => r.depth === 0).forEach((r) => opened.add(r.id));
      [...sel, ...exc].forEach((f) => {
        for (let r = byId(f.id); r && r.parent; r = byId(r.parent)) opened.add(r.parent);
      });
      // Quietly remove chosen folders that no longer exist
      const known = new Set(rows.map((r) => r.id));
      if ([...sel, ...exc].some((f) => !known.has(f.id))) {
        sel = sel.filter((f) => known.has(f.id));
        exc = exc.filter((f) => known.has(f.id));
        renderChips();
        emit();
      }
      renderList();
    })
    .catch((e) => (list.innerHTML = `<div class="kb-hint">Couldn't load folders: ${esc(e.message)}</div>`));
}
