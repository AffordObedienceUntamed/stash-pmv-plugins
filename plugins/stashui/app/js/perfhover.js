// Performer cards: while the mouse rests on one, its picture changes through other pictures of that performer from the library
// (pictures linked to the performer; the card's own picture first and again at the end). Off on touch screens. Settings → This interface.
// The picture stays the same element, so the blur of "NSFW off" (and its “clear on hover”) applies to every picture.

import { store } from "./ui.js";
import { gql } from "./api.js";

const cache = new Map(); // performer id → [thumbnail address, …]
const DELAY = 450; // the mouse has to rest before anything is asked
const STEP = 1100; // how long a picture stays
let timer = 0;
let cycle = 0;
let cur = null; // { card, img, orig, list, i }

const enabled = () => store.get("perfHover", true) !== false;

async function pictures(id) {
  if (cache.has(id)) return cache.get(id);
  let list = [];
  try {
    const d = await gql(`query PerfHoverPics($f: FindFilterType, $x: ImageFilterType) { findImages(filter: $f, image_filter: $x) { images { paths { thumbnail } } } }`, {
      f: { per_page: 8, sort: "random_" + Math.floor(Math.random() * 1e8) },
      x: { performers: { value: [id], modifier: "INCLUDES" } },
    });
    list = d.findImages.images.map((x) => x.paths && x.paths.thumbnail).filter(Boolean);
  } catch (e) {
    /* none – the card stays as it is */
  }
  cache.set(id, list);
  return list;
}

function stop() {
  clearTimeout(timer);
  clearInterval(cycle);
  timer = cycle = 0;
  if (cur) {
    cur.img.src = cur.orig;
    cur.img.classList.remove("is-cycling");
    cur = null;
  }
}

function start(card) {
  const img = card.querySelector(".kb-perf-img img");
  const id = card.dataset.pid;
  if (!img || !id) return;
  timer = setTimeout(async () => {
    const list = await pictures(id);
    if (!list.length || !card.matches(":hover")) return;
    const orig = img.getAttribute("src") || "";
    cur = { card, img, orig, list: [orig, ...list], i: 0 };
    // (the next picture is loaded in the background before it replaces the shown one)
    const next = () => {
      if (!cur) return;
      const nx = cur.list[(cur.i + 1) % cur.list.length];
      const pre = new Image();
      pre.onload = () => {
        if (!cur || cur.img !== img) return;
        cur.i = (cur.i + 1) % cur.list.length;
        img.src = nx;
        img.classList.add("is-cycling");
      };
      pre.src = nx;
    };
    next();
    cycle = setInterval(next, STEP);
  }, DELAY);
}

if (window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches) {
  document.addEventListener("mouseover", (e) => {
    const card = e.target.closest && e.target.closest("a.kb-perf[data-pid]");
    if (!card || (cur && cur.card === card)) return;
    if (!enabled()) return;
    stop();
    start(card);
  });
  document.addEventListener("mouseout", (e) => {
    const card = e.target.closest && e.target.closest("a.kb-perf[data-pid]");
    if (card && !card.contains(e.relatedTarget)) stop();
  });
  window.addEventListener("hashchange", stop);
}
