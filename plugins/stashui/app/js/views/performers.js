// All performers as portrait cards: search, sort, gender, favorites only. Scrolling loads more.

import { esc, icon, debounce, errorToast, toast, plural, promptDialog, starsHtml, pop, burst } from "../ui.js";
import { t, locale } from "../i18n.js";
import { findPerformers, updatePerformer, createPerformer } from "../api.js";
import { go, setQuery } from "../main.js";

const SORTS = [
  ["name", "Alphabetical"],
  ["scenes_count", "Most scenes"],
  ["o_counter", "O counter"],
  ["rating", "Rating"],
  ["play_count", "Most watched"],
  ["created_at", "Recently added"],
  ["random", "Random"],
];
export const GENDERS = [
  ["FEMALE", "Female"],
  ["MALE", "Male"],
  ["TRANSGENDER_FEMALE", "Trans female"],
  ["TRANSGENDER_MALE", "Trans male"],
  ["NON_BINARY", "Non-binary"],
  ["INTERSEX", "Intersex"],
];
const PAGE = 60;

export function ageOf(birth, until) {
  if (!birth) return 0;
  const b = new Date(birth);
  const e = until ? new Date(until) : new Date();
  let a = e.getFullYear() - b.getFullYear();
  if (e.getMonth() < b.getMonth() || (e.getMonth() === b.getMonth() && e.getDate() < b.getDate())) a--;
  return a > 0 && a < 130 ? a : 0;
}

// "US" → "United States" in the interface language. Stash usually keeps the two-letter code; anything else stays as it is.
// (No flag emoji: Windows shows those as plain letters.)
export function countryOf(c) {
  if (!c) return "";
  if (!/^[A-Za-z]{2}$/.test(c)) return c;
  try {
    return new Intl.DisplayNames([locale()], { type: "region" }).of(c.toUpperCase()) || c;
  } catch (e) {
    return c;
  }
}

export function performerCard(p) {
  const age = ageOf(p.birthdate);
  const sub = [p.scene_count ? plural(p.scene_count, "scene", "scenes") : "", age ? t("{n} years", { n: age }) : ""].filter(Boolean).join(" · ");
  return `<a class="kb-perf" href="#/performer/${p.id}" data-pid="${p.id}">
    <span class="kb-perf-img"><img alt="" loading="lazy" src="${esc(p.image_path || "")}">
      <button type="button" class="kb-perf-fav${p.favorite ? " is-on" : ""}" data-pfav title="${t("Favorite")}">${icon("heart")}</button>
      ${p.o_counter ? `<span class="kb-perf-o">${icon("drop")}${p.o_counter}</span>` : ""}</span>
    <b>${esc(p.name)}${p.disambiguation ? ` <small>(${esc(p.disambiguation)})</small>` : ""}</b>
    <small>${sub || "&nbsp;"}</small>
    ${p.rating100 ? starsHtml(p.rating100) : ""}
  </a>`;
}

// Heart on a card: favorite on/off without opening the performer
export async function toggleCardFav(btn, list) {
  const card = btn.closest("[data-pid]");
  const p = list.find((x) => x.id === card.dataset.pid);
  if (!p) return;
  const on = !p.favorite;
  try {
    await updatePerformer({ id: p.id, favorite: on });
    p.favorite = on;
    btn.classList.toggle("is-on", on);
    if (on) {
      pop(btn, 1.5);
      burst(btn, "heart", 6);
    }
    toast(on ? t("Marked as favorite") : t("Favorite removed"));
  } catch (e) {
    errorToast(e, "Favorite");
  }
}

export async function render(main, params, query) {
  main.innerHTML = `
    <header class="kb-head">
      <div class="kb-head-title">
        <h1 class="kb-h1">${t("Performers")}</h1>
        <p class="kb-sub" data-sub></p>
      </div>
      <div class="kb-head-tools">
        <label class="kb-search">${icon("search")}<input class="kb-field" type="search" data-q placeholder="${t("Search performers")}" value="${esc(query.q || "")}"></label>
        <select class="kb-field" data-sort aria-label="${t("Sort order")}">${SORTS.map(([v, l]) => `<option value="${v}">${t(l)}</option>`).join("")}</select>
        <select class="kb-field" data-gender aria-label="${t("Gender")}"><option value="">${t("Everyone")}</option>${GENDERS.map(([v, l]) => `<option value="${v}">${t(l)}</option>`).join("")}</select>
        <button type="button" class="kb-btn${query.fav === "1" ? " is-on" : ""}" data-favonly aria-pressed="${query.fav === "1"}">${icon("heart")}${t("Favorites")}</button>
        <button type="button" class="kb-btn" data-new>${icon("plus")}${t("New performer")}</button>
      </div>
    </header>
    <div class="kb-perfgrid" data-list><div class="kb-loading">${t("Loading …")}</div></div>
    <div class="kb-perf-more" data-more></div>`;
  const $ = (s) => main.querySelector(s);
  $("[data-sort]").value = query.sort || "name";
  $("[data-gender]").value = query.gender || "";
  let favOnly = query.fav === "1";
  let list = [];
  let page = 1;
  let total = 0;
  let loading = false;
  let run = 0;

  function filter() {
    const f = {};
    if (favOnly) f.filter_favorites = true;
    const g = $("[data-gender]").value;
    if (g) f.gender = { value: g, modifier: "EQUALS" };
    return f;
  }

  async function load(reset) {
    if (loading && !reset) return;
    const my = ++run;
    loading = true;
    if (reset) {
      page = 1;
      list = [];
    }
    try {
      const q = $("[data-q]").value.trim();
      const r = await findPerformers({ q, page, perPage: PAGE, sort: $("[data-sort]").value, filter: filter() });
      if (my !== run) return;
      total = r.count;
      list = list.concat(r.performers);
      $("[data-sub]").textContent = plural(total, "performer", "performers");
      if (!list.length) {
        const filtered = q || favOnly || $("[data-gender]").value;
        $("[data-list]").innerHTML = filtered
          ? `<div class="kb-empty"><b>${t("No performer found")}</b><p>${t("Try another search or filter.")}</p></div>`
          : `<div class="kb-empty"><b>${t("No performers yet")}</b><p>${t("Stash can fill them in from StashDB: Tasks → Identify (or the scene tagger in classic Stash). Or add one yourself with “New performer”.")}</p></div>`;
      } else if (reset) $("[data-list]").innerHTML = list.map(performerCard).join("");
      else $("[data-list]").insertAdjacentHTML("beforeend", r.performers.map(performerCard).join(""));
      page++;
    } catch (e) {
      if (my === run) $("[data-list]").innerHTML = `<div class="kb-empty"><b>${t("Couldn't load the performers")}</b><p>${esc(e.message)}</p></div>`;
    } finally {
      if (my === run) loading = false;
    }
  }

  // More when the end of the grid comes into view
  const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && list.length < total && load(false), { rootMargin: "800px" });
  io.observe($("[data-more]"));

  const reload = () => {
    setQuery({ q: $("[data-q]").value.trim(), sort: $("[data-sort]").value === "name" ? "" : $("[data-sort]").value, gender: $("[data-gender]").value, fav: favOnly ? "1" : "" });
    load(true);
  };
  $("[data-q]").addEventListener("input", debounce(reload, 250));
  $("[data-sort]").onchange = reload;
  $("[data-gender]").onchange = reload;
  $("[data-favonly]").onclick = (e) => {
    favOnly = !favOnly;
    e.currentTarget.classList.toggle("is-on", favOnly);
    e.currentTarget.setAttribute("aria-pressed", favOnly);
    reload();
  };
  $("[data-list]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pfav]");
    if (!b) return;
    e.preventDefault();
    toggleCardFav(b, list);
  });
  $("[data-new]").onclick = async () => {
    const name = await promptDialog({ title: t("New performer"), label: t("Name"), ok: t("Create") });
    if (!name || !name.trim()) return;
    try {
      const p = await createPerformer(name.trim());
      go("performer/" + p.id);
    } catch (e) {
      errorToast(e, "Create performer");
    }
  };
  load(true);
  return () => io.disconnect();
}
