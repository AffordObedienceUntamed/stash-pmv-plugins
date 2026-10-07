// Extension modules: other plugins can bring /plugin/<id>/assets/stashui.js (default export = setup(stashui)).
// Opt-in – a plugin without that file costs one cached lookup per plugin version, nothing else.
//
//   export default function setup(stashui) {
//     stashui.addListSource({ id, match({ page, kind }) → bool, async extend(ctx) → [{ before, piece }] });
//   }
//
// ctx = { page, params, kind, sort, dir, q, filter, pageNumber, perPage, count, items, prev }; before = id of a raw item
// of this page to insert in front of (null = after the page); piece = { key, title, thumb, w, h, meta, stamp, href,
// className, badges: [{ text, title }], mount(cardEl) → cleanup }.

import { store } from "./ui.js";

const MOD_KEY = "extMods1"; // "<id>@<version>" → true (has a module) / false
const TIMEOUT = 3000;
const sources = [];
const loaded = new Set();

export const hasSources = () => sources.length > 0;

function makeApi(pluginId) {
  return {
    version: 1,
    addListSource(src) {
      if (!src || typeof src.extend !== "function") return;
      const i = sources.findIndex((s) => s.plugin === pluginId && s.id === src.id);
      const entry = { id: String(src.id || "source"), plugin: pluginId, match: typeof src.match === "function" ? src.match : null, extend: src.extend };
      if (i >= 0) sources[i] = entry;
      else sources.push(entry);
    },
  };
}

async function hasModule(url) {
  try {
    const r = await fetch(url, { method: "GET", cache: "no-store" });
    // Stash answers unknown paths in assets with a page or an error – only real JavaScript counts
    return r.ok && /javascript|ecmascript/.test(r.headers.get("content-type") || "");
  } catch (e) {
    return false;
  }
}

// plugins: the enabled plugins of other people ({ id, version })
export async function loadExtensions(plugins) {
  const cache = store.get(MOD_KEY, {});
  const keep = new Set();
  for (const p of plugins) {
    const key = p.id + "@" + (p.version || "");
    keep.add(key);
    const url = `/plugin/${encodeURIComponent(p.id)}/assets/stashui.js`;
    if (cache[key] === undefined) cache[key] = await hasModule(url);
    if (!cache[key] || loaded.has(key)) continue;
    loaded.add(key);
    try {
      const mod = await import(`${url}?v=${encodeURIComponent(p.version || "0")}`);
      if (typeof mod.default === "function") await mod.default(makeApi(p.id));
    } catch (e) {
      console.warn(`[Stash UI] extension ${p.id} failed`, e);
    }
  }
  Object.keys(cache).forEach((k) => keep.has(k) || delete cache[k]);
  store.set(MOD_KEY, cache);
}

const withTimeout = (p) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT))]);

// Ask every source that matches this list; broken or slow ones are skipped. → [{ before, piece }]
export async function extendPage(ctx) {
  const out = [];
  await Promise.all(
    sources.map(async (s) => {
      try {
        if (s.match && !s.match({ page: ctx.page, params: ctx.params, kind: ctx.kind })) return;
        const r = await withTimeout(Promise.resolve(s.extend(ctx)));
        for (const e of Array.isArray(r) ? r : []) {
          const p = e && e.piece;
          if (!p || p.key == null) continue;
          out.push({ before: e.before == null ? null : String(e.before), piece: Object.assign({}, p, { key: s.plugin + ":" + s.id + ":" + p.key, foreign: true, kind: "ext", id: s.plugin + ":" + s.id + ":" + p.key }) });
        }
      } catch (e) {
        console.warn(`[Stash UI] list source ${s.plugin}/${s.id}`, e);
      }
    })
  );
  return out;
}
