// A performer: photo, facts, heart, rating, tags, links – and all their scenes, images and galleries.

import { esc, icon, errorToast, toast, plural, starsHtml, fmtDate, pop, burst } from "../ui.js";
import { t } from "../i18n.js";
import { getPerformer, updatePerformer } from "../api.js";
import { openPerformerEditor } from "./perfedit.js";
import { mediaBrowser } from "./media.js";
import { go, setQuery } from "../main.js";
import { GENDERS, ageOf, countryOf } from "./performers.js";

const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch (e) {
    return u;
  }
};

export async function render(main, params, query) {
  const p = await getPerformer(params.id);
  if (!p) {
    main.innerHTML = `<div class="kb-empty"><b>${t("This performer no longer exists")}</b><a class="kb-btn" href="#/performers">${t("All performers")}</a></div>`;
    return;
  }
  const kinds = [];
  if (p.scene_count) kinds.push("scene");
  if (p.image_count) kinds.push("image");
  if (p.gallery_count) kinds.push("gallery");
  if (!kinds.length) kinds.push("scene");

  const age = ageOf(p.birthdate, p.death_date);
  const gender = (GENDERS.find(([v]) => v === p.gender) || [])[1];
  const facts = [
    [t("Gender"), gender ? t(gender) : ""],
    [t("Born"), p.birthdate ? `${fmtDate(p.birthdate)}${age ? ` (${p.death_date ? t("died at {n}", { n: age }) : t("{n} years", { n: age })})` : ""}` : ""],
    [t("Died"), p.death_date ? fmtDate(p.death_date) : ""],
    [t("Country"), countryOf(p.country)],
    [t("Ethnicity"), p.ethnicity],
    [t("Height"), p.height_cm ? `${p.height_cm} cm` : ""],
    [t("Weight"), p.weight ? `${p.weight} kg` : ""],
    [t("Measurements"), p.measurements],
    [t("Hair"), p.hair_color],
    [t("Eyes"), p.eye_color],
    [t("Tattoos"), p.tattoos],
    [t("Piercings"), p.piercings],
  ].filter(([, v]) => v);

  main.innerHTML = `
    <header class="kb-perfhead">
      <button type="button" class="kb-perfhead-img" data-photo title="${t("Change photo")}"><img alt="" src="${esc(p.image_path || "")}"><span>${icon("camera")}${t("Change photo")}</span></button>
      <div class="kb-perfhead-body">
        <nav class="kb-crumbs"><span><a href="#/performers">${t("Performers")}</a></span></nav>
        <h1 class="kb-h1">${esc(p.name)}${p.disambiguation ? ` <small>(${esc(p.disambiguation)})</small>` : ""}</h1>
        ${p.alias_list && p.alias_list.length ? `<p class="kb-sub">${t("Also known as {names}", { names: p.alias_list.map(esc).join(", ") })}</p>` : ""}
        <p class="kb-sub">${[p.scene_count ? plural(p.scene_count, "scene", "scenes") : "", p.image_count ? plural(p.image_count, "image", "images") : "", p.gallery_count ? plural(p.gallery_count, "gallery", "galleries") : ""].filter(Boolean).join(t(", ")) || t("Nothing with this performer yet")}</p>
        <div class="kb-plc-acts">
          <div data-rate>${starsHtml(p.rating100, true)}</div>
          <button class="kb-plc-btn${p.favorite ? " is-on" : ""}" data-fav><span class="kb-dotmini"></span>${p.favorite ? t("Favorite") : t("Add to favorites")}</button>
          ${p.o_counter ? `<span class="kb-plc-btn is-static" title="${t("O counter")}">${icon("drop")}${p.o_counter}</span>` : ""}
          <button class="kb-plc-btn" data-edit>${icon("edit")}${t("Edit")}</button>
        </div>
        ${facts.length ? `<dl class="kb-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
        ${p.tags.length ? `<div class="kb-chips">${p.tags.map((tg) => `<a class="kb-chip" href="#/tag/${tg.id}">${esc(tg.name)}</a>`).join("")}</div>` : ""}
        ${p.urls && p.urls.length ? `<div class="kb-chips kb-perf-links">${p.urls.map((u) => `<a class="kb-chip" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(u))} ↗</a>`).join("")}</div>` : ""}
        ${p.details ? `<p class="kb-lead kb-perf-details">${esc(p.details)}</p>` : ""}
      </div>
    </header>
    <section data-browser></section>`;
  const b = mediaBrowser(main.querySelector("[data-browser]"), { kinds, query, base: () => ({ filter: { performers: { value: [p.id], modifier: "INCLUDES" } } }) });

  // Rating: click a star, the same star again removes it
  main.querySelector("[data-rate]").addEventListener("click", async (e) => {
    const s = e.target.closest("[data-star]");
    if (!s) return;
    const n = Number(s.dataset.star);
    const v = Math.round((p.rating100 || 0) / 20) === n ? null : n * 20;
    try {
      await updatePerformer({ id: p.id, rating100: v });
      p.rating100 = v;
      main.querySelector("[data-rate]").innerHTML = starsHtml(v, true);
      toast(v ? plural(n, "star", "stars") : t("Rating removed"));
    } catch (err) {
      errorToast(err, "Rating");
    }
  });

  main.querySelector("[data-fav]").onclick = async (e) => {
    const btn = e.currentTarget;
    const on = !p.favorite;
    try {
      await updatePerformer({ id: p.id, favorite: on });
      p.favorite = on;
      btn.classList.toggle("is-on", on);
      btn.innerHTML = `<span class="kb-dotmini"></span>${on ? t("Favorite") : t("Add to favorites")}`;
      const heart = btn.querySelector(".kb-dotmini");
      if (on) {
        pop(heart, 1.8);
        burst(heart, "heart", 7);
      }
      toast(on ? t("Marked as favorite") : t("Favorite removed"));
    } catch (err) {
      errorToast(err, "Favorite");
    }
  };

  // Edit everything, photo and scraping included
  const edit = (scrape) => openPerformerEditor(p.id, { scrape, onSaved: () => go("performer/" + p.id, true), onDeleted: () => go("performers", true) });
  main.querySelector("[data-edit]").onclick = () => edit(false);
  main.querySelector("[data-photo]").onclick = () => edit(false);
  if (query.edit === "1") {
    setQuery({ edit: "" });
    edit(true);
  }
  return () => b.destroy();
}
