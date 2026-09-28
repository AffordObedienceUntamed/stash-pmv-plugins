// Tasks: running jobs with progress, plus scan, generate, clean and auto tag.
// The checkboxes start with Stash's defaults and can be saved there as defaults too.

import { esc, icon, toast, errorToast, fmtAgo, confirmDialog } from "../ui.js";
import { gql } from "../api.js";
import { typeInfo, fieldHtml, readFields, selection } from "../forms.js";
import { onJobs, pokeJobs } from "../jobs.js";

const TASKS = [
  { id: "scan", title: "Scan for new files", text: "Looks for new, changed and moved files in the library folders.", input: "ScanMetadataInput", mutation: "metadataScan", defaults: "scan", primary: true },
  { id: "generate", title: "Generate previews", text: "Generates missing covers, hover previews, timeline images and more.", input: "GenerateMetadataInput", mutation: "metadataGenerate", defaults: "generate",
    hide: ["sceneIDs", "markerIDs", "imageIDs", "galleryIDs", "previewOptions"] },
  { id: "autotag", title: "Auto tag", text: "Assigns tags whose name appears in the file path (e.g. folder “Outdoor” → tag “Outdoor”).", input: "AutoTagMetadataInput", mutation: "metadataAutoTag", defaults: "autoTag", custom: "autotag" },
  { id: "clean", title: "Clean", text: "Removes items whose files no longer exist. Start as a dry run first and check the log.", input: "CleanMetadataInput", mutation: "metadataClean", danger: true },
];

export async function render(main) {
  main.innerHTML = `
    <header class="kb-head"><div class="kb-head-title">
      <h1 class="kb-h1">Tasks</h1>
      <p class="kb-sub">Scan, generate previews, clean up. Tasks keep running in the background, even when you leave the page.</p>
    </div></header>
    <section class="kb-jobs" data-jobs></section>
    <div class="kb-cards" data-cards><div class="kb-loading">Loading …</div></div>`;
  const stop = onJobs((jobs) => paintJobs(main.querySelector("[data-jobs]"), jobs));
  main.querySelector("[data-jobs]").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-stop]");
    const all = e.target.closest("[data-stopall]");
    try {
      if (b) await gql(`mutation($id: ID!) { stopJob(job_id: $id) }`, { id: b.dataset.stop });
      if (all) await gql(`mutation { stopAllJobs }`);
      if (b || all) pokeJobs();
    } catch (err) {
      errorToast(err, "Stop");
    }
  });

  let defaults = {};
  try {
    const sel = await selection("ConfigDefaultSettingsResult", 2);
    defaults = (await gql(`query { configuration { defaults { ${sel} } } }`)).configuration.defaults || {};
  } catch (e) { /* without defaults */ }

  // Without saved defaults: the same presets as the Stash interface
  const FALLBACK = {
    scan: { scanGenerateCovers: true, scanGeneratePreviews: true, scanGenerateSprites: true, scanGeneratePhashes: true, scanGenerateThumbnails: true },
    generate: { covers: true, previews: true, sprites: true, phashes: true, imageThumbnails: true, markers: true, markerScreenshots: true },
  };
  const cards = await Promise.all(TASKS.map((t) => cardHtml(t, defaults[t.defaults] || FALLBACK[t.defaults] || {})));
  const box = main.querySelector("[data-cards]");
  box.innerHTML = cards.join("");
  box.addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = TASKS.find((x) => x.id === e.target.dataset.task);
    const input = readFields(e.target);
    if (t.custom === "autotag") {
      input.tags = e.target.querySelector("[data-at-tags]").checked ? ["*"] : [];
      input.performers = e.target.querySelector("[data-at-perf]").checked ? ["*"] : [];
      input.studios = e.target.querySelector("[data-at-stud]").checked ? ["*"] : [];
    }
    if (t.danger && input.dryRun === false) {
      const r = await confirmDialog({ title: "Really clean up?", text: "Items without a file are removed from Stash. This can't be undone.", ok: "Clean up", danger: true });
      if (!r.ok) return;
    }
    try {
      await gql(`mutation($i: ${t.input}!) { ${t.mutation}(input: $i) }`, { i: input });
      toast(`${t.title}: started`, "ok");
      pokeJobs();
    } catch (err) {
      errorToast(err, t.title);
    }
  });
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-savedef]");
    if (!b) return;
    const t = TASKS.find((x) => x.id === b.dataset.savedef);
    const form = b.closest("form");
    try {
      await gql(`mutation($i: ConfigDefaultSettingsInput!) { configureDefaults(input: $i) { __typename } }`, { i: { [t.defaults]: readFields(form) } });
      toast("Saved as default", "ok");
    } catch (err) {
      errorToast(err, "Save default");
    }
  });
  return stop;
}

async function cardHtml(t, def) {
  const ti = await typeInfo(t.input);
  const hide = new Set([...(t.hide || []), "filter", ...(t.custom === "autotag" ? ["tags", "performers", "studios"] : [])]);
  const fields = await Promise.all(
    ti.inputFields
      .filter((f) => !hide.has(f.name))
      .map((f) => fieldHtml(f.name, f.type, def[f.name] != null ? def[f.name] : f.name === "dryRun" ? true : undefined))
  );
  const extra =
    t.custom === "autotag"
      ? `<label class="kb-set kb-set-bool"><span class="kb-set-label"><b>Tags</b></span><span class="kb-switch"><input type="checkbox" data-at-tags checked><i></i></span></label>
         <label class="kb-set kb-set-bool"><span class="kb-set-label"><b>Performer</b></span><span class="kb-switch"><input type="checkbox" data-at-perf><i></i></span></label>
         <label class="kb-set kb-set-bool"><span class="kb-set-label"><b>Studios</b></span><span class="kb-switch"><input type="checkbox" data-at-stud><i></i></span></label>`
      : "";
  return `<form class="kb-card" data-task="${t.id}">
    <h2>${esc(t.title)}</h2><p>${esc(t.text)}</p>
    <details class="kb-card-opts"><summary>Options</summary>${extra}${fields.join("")}</details>
    <div class="kb-card-acts"><button type="submit" class="kb-btn ${t.primary ? "is-primary" : ""}">${icon("play")}Start</button>
    ${t.defaults ? `<button type="button" class="kb-btn is-ghost" data-savedef="${t.id}">Save options as default</button>` : ""}</div>
  </form>`;
}

function paintJobs(box, jobs) {
  if (!box) return;
  if (!jobs.length) {
    box.innerHTML = `<p class="kb-hint">Nothing is running right now.</p>`;
    return;
  }
  box.innerHTML =
    `<div class="kb-jobs-head"><h2 class="kb-h2">Running now</h2><button class="kb-btn is-ghost" data-stopall>${icon("stop")}Stop all</button></div>` +
    jobs
      .map((j) => {
        const p = j.progress != null && j.progress >= 0 ? Math.round(j.progress * 100) : null;
        const state = { READY: "waiting", RUNNING: p != null ? p + " %" : "running", STOPPING: "stopping …", FINISHED: "done", CANCELLED: "cancelled", FAILED: "failed" }[j.status];
        return `<div class="kb-job is-${j.status.toLowerCase()}">
          <div class="kb-job-top"><b>${esc(j.description)}</b><span>${state}</span>
          ${j.status === "RUNNING" || j.status === "READY" ? `<button class="kb-btn is-icon is-ghost" data-stop="${j.id}" aria-label="Stop">${icon("stop")}</button>` : ""}</div>
          <div class="kb-job-bar"><i style="width:${p != null ? p : j.status === "RUNNING" ? 100 : 0}%"${p == null && j.status === "RUNNING" ? ' class="is-indet"' : ""}></i></div>
          ${(j.subTasks || []).length ? `<small>${esc(j.subTasks.slice(-2).join(" · "))}</small>` : j.startTime ? `<small>started ${esc(fmtAgo(j.startTime))}</small>` : ""}
        </div>`;
      })
      .join("");
}
