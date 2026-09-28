// Common model for scenes, images and galleries ("pieces") and the salon hanging.

import { esc, icon, fmtDuration, fmtRes, fmtDate, fmtBytes, invNo, plural } from "./ui.js";

export function toPiece(kind, x, favId) {
  const tags = x.tags || [];
  const fav = !!favId && tags.some((t) => t.id === favId);
  if (kind === "scene") {
    const f = (x.files || [])[0] || {};
    const res = fmtRes(f.width, f.height);
    const dur = f.duration || 0;
    return {
      kind, id: x.id, raw: x, fav,
      title: x.title || f.basename || "Scene " + x.id,
      w: f.width || 16, h: f.height || 9,
      thumb: x.paths && x.paths.screenshot,
      preview: x.paths && x.paths.preview,
      stamp: fmtDuration(dur),
      meta: ["Video", fmtDuration(dur), res, x.date ? fmtDate(x.date) : ""].filter(Boolean).join(", "),
      resume: dur && x.resume_time ? Math.min(1, x.resume_time / dur) : 0,
      rating: x.rating100 || 0,
    };
  }
  if (kind === "image") {
    const vf = (x.visual_files || [])[0] || {};
    const isVid = vf.__typename === "VideoFile";
    return {
      kind, id: x.id, raw: x, fav,
      title: x.title || vf.basename || "Image " + x.id,
      w: vf.width || 3, h: vf.height || 4,
      thumb: x.paths && x.paths.thumbnail,
      preview: isVid ? x.paths.preview || x.paths.image : null,
      isVid,
      stamp: isVid ? (vf.duration ? fmtDuration(vf.duration) : "Clip") : "",
      meta: [isVid ? "Clip" : "Image", vf.width ? `${vf.width} × ${vf.height}` : "", fmtBytes(vf.size)].filter(Boolean).join(", "),
      rating: x.rating100 || 0,
    };
  }
  // Gallery
  const cv = (x.cover && x.cover.visual_files && x.cover.visual_files[0]) || {};
  const path = (x.folder && x.folder.path) || ((x.files || [])[0] || {}).path || "";
  const base = path.split(/[\\/]/).filter(Boolean).pop();
  return {
    kind, id: x.id, raw: x, fav,
    title: x.title || base || "Gallery " + x.id,
    w: cv.width || 4, h: cv.height || 3,
    thumb: x.paths && x.paths.cover,
    stamp: plural(x.image_count, "image", "images"),
    meta: ["Gallery", plural(x.image_count, "image", "images"), x.date ? fmtDate(x.date) : ""].filter(Boolean).join(", "),
    rating: x.rating100 || 0,
  };
}

function pieceHtml(p) {
  const tag = p.kind === "image" ? "button" : "a";
  const href = p.kind === "scene" ? `#/scene/${p.id}` : p.kind === "gallery" ? `#/gallery/${p.id}` : "";
  return (
    `<${tag} class="kb-piece" data-key="${p.kind}:${p.id}"${href ? ` href="${href}"` : ' type="button"'} aria-label="${esc(p.title)}">` +
    (p.thumb ? `<img alt="" loading="lazy" decoding="async" src="${esc(p.thumb)}">` : "") +
    (p.stamp ? `<span class="kb-stamp">${esc(p.stamp)}</span>` : "") +
    (p.resume ? `<span class="kb-resume"><i style="width:${(p.resume * 100).toFixed(1)}%"></i></span>` : "") +
    (p.fav ? '<span class="kb-dot" title="Favorite"></span>' : "") +
    `<span class="kb-pick" role="checkbox" aria-checked="false" aria-label="Select">${icon("check")}</span>` +
    `<span class="kb-placard"><b>${esc(p.title)}</b><small>${esc(p.meta)}</small></span>` +
    `</${tag}>`
  );
}

// ---------- Salon hanging ----------
// Justified rows, loads more while scrolling, preview video on hover, multi-select.

export class Hang {
  constructor(el, opts) {
    this.el = el;
    this.opts = opts; // { fetchPage(page) → {count, pieces}, onOpen(piece, index, list), onSelect(set), rowHeight }
    this.pieces = [];
    this.nodes = new Map();
    this.page = 0;
    this.count = null;
    this.done = false;
    this.busy = false;
    this.selected = new Set();
    this.lastPick = null;
    this.rowH = opts.rowHeight || 240;
    this.gap = 10;
    el.classList.add("kb-hang");
    el.innerHTML = '<div class="kb-rows"></div><div class="kb-loading" hidden>Loading …</div><div class="kb-sentinel"></div>';
    this.rowsEl = el.querySelector(".kb-rows");
    this.loadingEl = el.querySelector(".kb-loading");
    this.sentinel = el.querySelector(".kb-sentinel");
    this.io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && this.more(), { rootMargin: "900px 0px" });
    this.io.observe(this.sentinel);
    this.ro = new ResizeObserver(() => {
      const w = this.el.clientWidth;
      if (w && w !== this.lastW) {
        this.lastW = w;
        this.layout();
      }
    });
    this.ro.observe(el);
    this.bind();
    this.more();
  }

  destroy() {
    this.io.disconnect();
    this.ro.disconnect();
    this.stopPreview();
  }

  setRowHeight(h) {
    this.rowH = h;
    this.layout();
  }

  async more() {
    if (this.busy || this.done) return;
    this.busy = true;
    this.loadingEl.hidden = false;
    try {
      const { count, pieces } = await this.opts.fetchPage(++this.page);
      this.count = count;
      this.pieces.push(...pieces);
      if (!pieces.length || this.pieces.length >= count) this.done = true;
      this.layout();
      this.opts.onLoaded && this.opts.onLoaded(this);
    } catch (e) {
      this.done = true;
      this.opts.onError && this.opts.onError(e);
    } finally {
      this.busy = false;
      this.loadingEl.hidden = true;
      // Still room on screen? Load more right away.
      if (!this.done && this.sentinel.getBoundingClientRect().top < innerHeight + 900) setTimeout(() => this.more(), 0);
    }
  }

  node(p) {
    const key = p.kind + ":" + p.id;
    let n = this.nodes.get(key);
    if (!n) {
      const t = document.createElement("template");
      t.innerHTML = pieceHtml(p);
      n = t.content.firstChild;
      const img = n.querySelector("img");
      if (img) {
        if (img.complete && img.naturalWidth) img.classList.add("is-loaded");
        else img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
        img.addEventListener("error", () => img.classList.add("is-loaded"), { once: true });
      }
      n._piece = p;
      this.nodes.set(key, n);
    }
    n.classList.toggle("is-picked", this.selected.has(key));
    return n;
  }

  layout() {
    const W = this.el.clientWidth;
    if (!W) return;
    const H = this.rowH;
    const G = this.gap;
    const rows = [];
    let row = [];
    let sum = 0;
    for (const p of this.pieces) {
      const ar = Math.min(3, Math.max(0.42, p.w / p.h || 1));
      row.push([p, ar]);
      sum += ar;
      if (sum * H + G * (row.length - 1) >= W) {
        rows.push({ items: row, h: (W - G * (row.length - 1)) / sum });
        row = [];
        sum = 0;
      }
    }
    if (row.length) rows.push({ items: row, h: Math.min(H, (W - G * (row.length - 1)) / sum) });
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const div = document.createElement("div");
      div.className = "kb-row";
      for (const [p, ar] of r.items) {
        const n = this.node(p);
        n.style.width = (ar * r.h).toFixed(2) + "px";
        n.style.height = r.h.toFixed(2) + "px";
        div.appendChild(n);
      }
      frag.appendChild(div);
    }
    this.rowsEl.replaceChildren(frag);
  }

  // Update one piece (e.g. after favorite/edit) without reloading everything
  update(p) {
    const key = p.kind + ":" + p.id;
    const i = this.pieces.findIndex((x) => x.kind === p.kind && x.id === p.id);
    if (i < 0) return;
    this.pieces[i] = p;
    this.nodes.delete(key);
    this.layout();
  }
  remove(keys) {
    this.pieces = this.pieces.filter((p) => !keys.includes(p.kind + ":" + p.id));
    keys.forEach((k) => {
      this.nodes.delete(k);
      this.selected.delete(k);
    });
    if (this.count != null) this.count -= keys.length;
    this.layout();
    this.emitSelect();
  }

  // ---------- Selection ----------

  toggle(key, range) {
    const keys = this.pieces.map((p) => p.kind + ":" + p.id);
    if (range && this.lastPick) {
      const a = keys.indexOf(this.lastPick);
      const b = keys.indexOf(key);
      if (a >= 0 && b >= 0) {
        const on = !this.selected.has(key);
        keys.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((k) => (on ? this.selected.add(k) : this.selected.delete(k)));
      }
    } else if (this.selected.has(key)) this.selected.delete(key);
    else this.selected.add(key);
    this.lastPick = key;
    this.syncPicks();
  }
  selectAll() {
    this.pieces.forEach((p) => this.selected.add(p.kind + ":" + p.id));
    this.syncPicks();
  }
  clearSelection() {
    this.selected.clear();
    this.syncPicks();
  }
  syncPicks() {
    this.nodes.forEach((n, k) => {
      const on = this.selected.has(k);
      n.classList.toggle("is-picked", on);
      const pick = n.querySelector(".kb-pick");
      if (pick) pick.setAttribute("aria-checked", on);
    });
    this.el.classList.toggle("is-selecting", this.selected.size > 0);
    this.emitSelect();
  }
  emitSelect() {
    this.opts.onSelect && this.opts.onSelect(this.selected, this);
  }
  selectedPieces() {
    return this.pieces.filter((p) => this.selected.has(p.kind + ":" + p.id));
  }

  // ---------- Events ----------

  bind() {
    this.el.addEventListener("click", (e) => {
      const n = e.target.closest(".kb-piece");
      if (!n || !this.el.contains(n)) return;
      const key = n.dataset.key;
      if (e.target.closest(".kb-pick") || this.selected.size || e.shiftKey || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.toggle(key, e.shiftKey);
        return;
      }
      e.preventDefault();
      const i = this.pieces.findIndex((p) => p.kind + ":" + p.id === key);
      this.opts.onOpen && this.opts.onOpen(this.pieces[i], i, this);
    });
    this.el.addEventListener("pointerover", (e) => {
      const n = e.target.closest(".kb-piece");
      if (!n || n === this.hoverNode) return;
      this.hoverNode = n;
      this.stopPreview();
      const p = n._piece;
      if (!p || !p.preview) return;
      this.previewTimer = setTimeout(() => this.startPreview(n, p), 280);
    });
    this.el.addEventListener("pointerleave", () => {
      this.hoverNode = null;
      this.stopPreview();
    });
    this.el.addEventListener("pointerout", (e) => {
      const n = e.target.closest(".kb-piece");
      if (n && !n.contains(e.relatedTarget)) {
        if (this.hoverNode === n) this.hoverNode = null;
        this.stopPreview();
      }
    });
  }

  startPreview(n, p) {
    const v = document.createElement("video");
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = p.preview;
    v.addEventListener("playing", () => n.classList.add("is-previewing"), { once: true });
    n.appendChild(v);
    v.play().catch(() => {});
    this.previewEl = v;
    this.previewNode = n;
  }
  stopPreview() {
    clearTimeout(this.previewTimer);
    if (this.previewEl) {
      this.previewEl.pause();
      this.previewEl.removeAttribute("src");
      this.previewEl.load();
      this.previewEl.remove();
      this.previewNode && this.previewNode.classList.remove("is-previewing");
      this.previewEl = this.previewNode = null;
    }
  }
}
