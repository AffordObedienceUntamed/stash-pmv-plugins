// Home page: figures, continue watching, favorites, new arrivals, folders, random hanging.

import { esc, icon, fmtNum, store, seed, errorToast } from "../ui.js";
import { t } from "../i18n.js";
import { stats, findItems, loadFolders } from "../api.js";
import { toPiece, Hang } from "../pieces.js";
import { app, go } from "../main.js";
import { roomsHtml, fillRoomCovers } from "./folder.js";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return t("Late night.");
  if (h < 11) return t("Good morning.");
  if (h < 18) return t("Good afternoon.");
  return t("Good evening.");
}

// A small wall with a fixed number of items
function wall(el, fetcher, rowHeight) {
  return new Hang(el, {
    rowHeight: rowHeight || 210,
    fetchPage: async (page) => {
      if (page > 1) return { count: 0, pieces: [] };
      const pieces = await fetcher();
      if (!pieces.length) el.closest("section").hidden = true;
      return { count: pieces.length, pieces };
    },
    onOpen: (p, i, h) => {
      app.context = { kind: p.kind, pieces: h.pieces, index: i, hang: h };
      go((p.kind === "scene" ? "scene/" : p.kind === "image" ? "image/" : "gallery/") + p.id);
    },
    onError: (e) => errorToast(e, "Home"),
  });
}

export async function render(main) {
  main.innerHTML = `
    <header class="kb-head kb-home-head">
      <div class="kb-head-title">
        <h1 class="kb-h1">${greeting()}</h1>
        <div class="kb-figures" data-figures></div>
      </div>
    </header>
    <section><h2 class="kb-h2">${t("Continue watching")} <a href="#/history">${t("History")}</a></h2><div data-w="resume"></div></section>
    <section><h2 class="kb-h2">${t("Favorites")} <a href="#/scenes?fav=1">${t("All scenes")}</a> <a href="#/images?fav=1">${t("All images")}</a></h2><div data-w="fav"></div></section>
    <section><h2 class="kb-h2">${t("Recently added")} <a href="#/scenes">${t("Scenes")}</a> <a href="#/images">${t("Images")}</a></h2><div data-w="new"></div></section>
    <section data-rooms-sec><h2 class="kb-h2">${t("Folders")} <a href="#/folders">${t("All folders")}</a></h2><div data-rooms></div></section>
    <section><h2 class="kb-h2">${t("Random")} <button class="kb-btn is-ghost" data-reroll>${icon("shuffle")}${t("Shuffle")}</button></h2><div data-w="random"></div></section>`;

  const hangs = [];
  const $ = (s) => main.querySelector(s);

  stats()
    .then((s) => {
      $("[data-figures]").innerHTML =
        `<span><b>${fmtNum(s.scene_count)}</b> ${t("scenes")}</span>` +
        `<span><b>${fmtNum(s.image_count)}</b> ${t("images")}</span>` +
        `<span><b>${fmtNum(s.gallery_count)}</b> ${t("galleries")}</span>` +
        `<span><b>${fmtNum(Math.round(s.scenes_duration / 3600))}</b> ${t("hours of video")}</span>` +
        `<span><b>${fmtNum(s.total_play_count)}</b> ${t("plays")}</span>`;
    })
    .catch(() => {});

  // Continue watching: started scenes, most recently watched first
  hangs.push(
    wall($('[data-w="resume"]'), async () => {
      const r = await findItems("scene", { per_page: 12, sort: "last_played_at", direction: "DESC" }, { resume_time: { value: 5, modifier: "GREATER_THAN" } });
      return r.items.map((x) => toPiece("scene", x, app.favId)).filter((p) => p.resume < 0.97);
    })
  );

  // Favorites: scenes and images with the red dot, mixed
  hangs.push(
    wall($('[data-w="fav"]'), async () => {
      if (!app.favId) return [];
      const f = { tags: { value: [app.favId], modifier: "INCLUDES_ALL" } };
      const [s, i] = await Promise.all([
        findItems("scene", { per_page: 8, sort: seed() }, f),
        findItems("image", { per_page: 10, sort: seed() }, f),
      ]);
      return [...s.items.map((x) => toPiece("scene", x, app.favId)), ...i.items.map((x) => toPiece("image", x, app.favId))].sort(() => Math.random() - 0.5);
    })
  );

  hangs.push(
    wall($('[data-w="new"]'), async () => {
      const [s, i] = await Promise.all([
        findItems("scene", { per_page: 8, sort: "created_at", direction: "DESC" }),
        findItems("image", { per_page: 10, sort: "created_at", direction: "DESC" }),
      ]);
      return [...s.items.map((x) => toPiece("scene", x, app.favId)), ...i.items.map((x) => toPiece("image", x, app.favId))].sort(
        (a, b) => new Date(b.raw.created_at) - new Date(a.raw.created_at)
      );
    })
  );

  let stopCovers = () => {};
  loadFolders()
    .then((tree) => {
      const top = (tree.roots.length === 1 && tree.roots[0].kids.length ? tree.roots[0].kids : tree.roots).slice().sort((a, b) => b.timg + b.tvid - (a.timg + a.tvid)).slice(0, 8);
      $("[data-rooms]").innerHTML = roomsHtml(top);
      stopCovers = fillRoomCovers($("[data-rooms]"));
    })
    .catch(() => ($("[data-rooms-sec]").hidden = true));

  let randomHang = null;
  const hangRandom = () => {
    if (randomHang) randomHang.destroy();
    randomHang = wall(
      $('[data-w="random"]'),
      async () => {
        const [s, i] = await Promise.all([findItems("scene", { per_page: 8, sort: seed() }), findItems("image", { per_page: 22, sort: seed() })]);
        return [...s.items.map((x) => toPiece("scene", x, app.favId)), ...i.items.map((x) => toPiece("image", x, app.favId))].sort(() => Math.random() - 0.5);
      },
      store.get("rowHeight", 250)
    );
  };
  hangRandom();
  $("[data-reroll]").onclick = hangRandom;

  return () => {
    hangs.forEach((h) => h.destroy());
    randomHang && randomHang.destroy();
    stopCovers();
  };
}
