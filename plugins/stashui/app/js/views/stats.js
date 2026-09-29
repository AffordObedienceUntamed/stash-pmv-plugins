// Statistics: what you watch and when – from Stash's play and O history (every scene keeps the times).

import { esc, fmtNum, fmtBytes, plural, store } from "../ui.js";
import { t, locale } from "../i18n.js";
import { gql } from "../api.js";

const RANGES = [
  [13, "3 months"],
  [26, "6 months"],
  [52, "1 year"],
];

const Q = `query($f: FindFilterType, $s: SceneFilterType) {
  stats { scene_count scenes_size scenes_duration image_count total_o_count total_play_duration total_play_count scenes_played }
  findScenes(filter: $f, scene_filter: $s) {
    scenes {
      id title play_count o_counter play_duration play_history o_history
      paths { screenshot }
      files { basename }
      tags { id name }
      performers { id name image_path }
      studio { id name }
    }
  }
}`;

const hours = (sec) => Math.round((sec || 0) / 3600);
const titleOf = (s) => s.title || (s.files[0] && s.files[0].basename) || "#" + s.id;

// Monday of the week a date is in (local time)
function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export async function render(main) {
  let weeks = store.get("statsWeeks", 26);
  main.innerHTML = `
    <header class="kb-head"><div class="kb-head-title">
      <h1 class="kb-h1">${t("Statistics")}</h1>
      <p class="kb-sub">${t("What you watch and when – from the play and O history Stash keeps for every scene.")}</p>
    </div></header>
    <div data-body><div class="kb-loading">${t("Loading …")}</div></div>`;
  const body = main.querySelector("[data-body]");

  let d;
  try {
    d = await gql(Q, {
      f: { per_page: -1, sort: "play_count", direction: "DESC" },
      s: { play_count: { value: 0, modifier: "GREATER_THAN" }, OR: { o_counter: { value: 0, modifier: "GREATER_THAN" } } },
    });
  } catch (e) {
    body.innerHTML = `<div class="kb-empty"><b>${t("Couldn't load the statistics")}</b><p>${esc(e.message)}</p></div>`;
    return;
  }
  const st = d.stats;
  const scenes = d.findScenes.scenes;
  const plays = scenes.flatMap((s) => (s.play_history || []).map((x) => new Date(x)));
  const os = scenes.flatMap((s) => (s.o_history || []).map((x) => new Date(x)));

  const tile = (num, label, sub) => `<div class="kb-stat"><b>${num}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const pct = st.scene_count ? Math.round((st.scenes_played / st.scene_count) * 100) : 0;

  // Top lists
  const topScenes = (key) =>
    scenes
      .filter((s) => s[key] > 0)
      .sort((a, b) => b[key] - a[key])
      .slice(0, 10);
  const tally = (pick) => {
    const m = new Map();
    for (const s of scenes) {
      const w = (s.play_count || 0) + (s.o_counter || 0);
      if (!w) continue;
      for (const x of pick(s)) {
        const e = m.get(x.id) || { x, n: 0 };
        e.n += w;
        m.set(x.id, e);
      }
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 10);
  };
  const topTags = tally((s) => s.tags || []);
  const topPerformers = tally((s) => s.performers || []);
  const topStudios = tally((s) => (s.studio ? [s.studio] : []));

  const sceneList = (list, key, unit) =>
    list.length
      ? `<ol class="kb-rank">${list
          .map(
            (s, i) => `<li><a href="#/scene/${s.id}"><i>${i + 1}</i>${s.paths.screenshot ? `<img alt="" loading="lazy" src="${esc(s.paths.screenshot)}">` : ""}<span>${esc(titleOf(s))}</span><b>${fmtNum(s[key])}</b><small>${unit}</small></a></li>`
          )
          .join("")}</ol>`
      : `<p class="kb-hint">${t("Nothing yet")}</p>`;
  const nameList = (list, href) =>
    list.length
      ? `<ol class="kb-rank kb-rank-names">${list.map((e, i) => `<li><a href="${href(e.x)}"><i>${i + 1}</i><span>${esc(e.x.name)}</span><b>${fmtNum(e.n)}</b></a></li>`).join("")}</ol>`
      : `<p class="kb-hint">${t("Nothing yet")}</p>`;

  body.innerHTML = `
    <div class="kb-stats">
      ${tile(fmtNum(st.total_play_count), t("plays"), t("{n} of {m} scenes watched ({p} %)", { n: fmtNum(st.scenes_played), m: fmtNum(st.scene_count), p: pct }))}
      ${tile(fmtNum(hours(st.total_play_duration)) + " h", t("watched"), t("of {h} h in the library", { h: fmtNum(hours(st.scenes_duration)) }))}
      ${tile(fmtNum(st.total_o_count), t("O"), plays.length ? t("{n} this month", { n: fmtNum(os.filter((x) => x > new Date(Date.now() - 30 * 864e5)).length) }) : "")}
      ${tile(fmtBytes(st.scenes_size), t("videos"), plural(st.image_count, "image", "images"))}
    </div>
    <section class="kb-card kb-statcard">
      <div class="kb-statcard-head"><h2>${t("Activity")}</h2>
        <div class="kb-seg" data-range>${RANGES.map(([w, l]) => `<button type="button" data-w="${w}"${w === weeks ? ' class="is-on"' : ""}>${t(l)}</button>`).join("")}</div></div>
      <div class="kb-legend"><span class="is-plays">${t("Plays")}</span><span class="is-o">${t("O")}</span></div>
      <div class="kb-chart" data-chart></div>
    </section>
    <section class="kb-card kb-statcard">
      <h2>${t("When you watch")}</h2>
      <div class="kb-heat" data-heat></div>
    </section>
    <div class="kb-statgrid">
      <section class="kb-card kb-statcard"><h2>${t("Most watched")}</h2>${sceneList(topScenes("play_count"), "play_count", t("plays"))}</section>
      <section class="kb-card kb-statcard"><h2>${t("Most O")}</h2>${sceneList(topScenes("o_counter"), "o_counter", t("O"))}</section>
      <section class="kb-card kb-statcard"><h2>${t("Top tags")}</h2>${nameList(topTags, (x) => "#/tag/" + x.id)}</section>
      <section class="kb-card kb-statcard"><h2>${t("Top performers")}</h2>${nameList(topPerformers, (x) => "#/extern/classic?path=" + encodeURIComponent("/performers/" + x.id))}</section>
      <section class="kb-card kb-statcard"><h2>${t("Top studios")}</h2>${nameList(topStudios, (x) => "#/extern/classic?path=" + encodeURIComponent("/studios/" + x.id))}</section>
    </div>
    <p class="kb-hint">${t("Top tags, performers and studios count plays and O of their scenes.")}</p>`;

  // Activity: one pair of bars per week
  function paintChart() {
    const now = weekStart(new Date());
    const start = new Date(now);
    start.setDate(start.getDate() - (weeks - 1) * 7);
    const pb = new Array(weeks).fill(0);
    const ob = new Array(weeks).fill(0);
    const idx = (x) => Math.floor((weekStart(x) - start) / (7 * 864e5) + 0.01);
    plays.forEach((x) => {
      const i = idx(x);
      if (i >= 0 && i < weeks) pb[i]++;
    });
    os.forEach((x) => {
      const i = idx(x);
      if (i >= 0 && i < weeks) ob[i]++;
    });
    const max = Math.max(1, ...pb, ...ob);
    const fmtW = (i) => {
      const x = new Date(start);
      x.setDate(x.getDate() + i * 7);
      return x.toLocaleDateString(locale(), { day: "numeric", month: "short" });
    };
    body.querySelector("[data-chart]").innerHTML =
      `<div class="kb-bars">${pb
        .map(
          (p, i) => `<div class="kb-bar" title="${esc(t("Week of {d}: {p} plays, {o} O", { d: fmtW(i), p, o: ob[i] }))}"><i class="is-plays" style="height:${(p / max) * 100}%"></i><i class="is-o" style="height:${(ob[i] / max) * 100}%"></i></div>`
        )
        .join("")}</div>` +
      `<div class="kb-bars-axis"><span>${fmtW(0)}</span><span>${fmtW(Math.floor(weeks / 2))}</span><span>${t("this week")}</span></div>` +
      (plays.length || os.length ? "" : `<p class="kb-hint">${t("No play history yet – it fills up as you watch.")}</p>`);
  }
  paintChart();

  // Weekday × hour (local time)
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  plays.forEach((x) => grid[(x.getDay() + 6) % 7][x.getHours()]++);
  const hmax = Math.max(1, ...grid.flat());
  const days = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: "short" })); // 1 Jan 2024 was a Monday
  body.querySelector("[data-heat]").innerHTML =
    grid
      .map(
        (row, di) =>
          `<div class="kb-heat-row"><span>${esc(days[di])}</span>${row
            .map((n, h) => `<i style="--a:${n ? 0.15 + (n / hmax) * 0.85 : 0}" title="${esc(t("{day} {h}:00 – {n} plays", { day: days[di], h, n }))}"></i>`)
            .join("")}</div>`
      )
      .join("") + `<div class="kb-heat-row kb-heat-axis"><span></span>${Array.from({ length: 24 }, (_, h) => `<em>${h % 6 === 0 ? h : ""}</em>`).join("")}</div>`;

  body.querySelector("[data-range]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-w]");
    if (!b) return;
    weeks = Number(b.dataset.w);
    store.set("statsWeeks", weeks);
    body.querySelectorAll("[data-w]").forEach((x) => x.classList.toggle("is-on", x === b));
    paintChart();
  });
}
