// Plugins: on/off, settings, run tasks, reload. Install/update through classic Stash.

import { esc, icon, toast, errorToast } from "../ui.js";
import { gql } from "../api.js";
import { pokeJobs } from "../jobs.js";

export async function render(main) {
  main.innerHTML = `
    <header class="kb-head">
      <div class="kb-head-title">
        <h1 class="kb-h1">Plugins</h1>
        <p class="kb-sub">Extensions for Stash. Install or update plugins in classic Stash.</p>
      </div>
      <div class="kb-head-tools">
        <button class="kb-btn" data-reload>Reload</button>
        <a class="kb-btn" href="#/extern/classic-settings?path=${encodeURIComponent("/settings?tab=plugins")}">${icon("download")}Install & update</a>
      </div>
    </header>
    <div class="kb-plugins" data-list><div class="kb-loading">Loading …</div></div>`;
  const list = main.querySelector("[data-list]");

  async function load() {
    const d = await gql(`query {
      plugins { id name description version url enabled settings { name display_name description type } tasks { name description } }
      configuration { plugins }
    }`);
    const cfg = d.configuration.plugins || {};
    const plugins = d.plugins.slice().sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
    list.innerHTML = plugins
      .map((p) => {
        const values = cfg[p.id] || {};
        return `<article class="kb-plugin${p.enabled ? "" : " is-off"}" data-id="${esc(p.id)}">
          <header>
            <div><h2>${esc(p.name)}</h2><small>${esc([p.version ? "Version " + p.version : "", p.id].filter(Boolean).join(", "))}</small></div>
            <label class="kb-switch" title="${p.enabled ? "Turn off" : "Turn on"}"><input type="checkbox" data-enable${p.enabled ? " checked" : ""}><i></i></label>
          </header>
          ${p.description ? `<p>${esc(p.description)}</p>` : ""}
          ${p.settings && p.settings.length ? `<details><summary>Settings</summary><form data-settings>${p.settings
            .map((s) => {
              const v = values[s.name];
              const label = `<span class="kb-set-label"><b>${esc(s.display_name || s.name)}</b>${s.description ? `<small>${esc(s.description)}</small>` : ""}</span>`;
              if (s.type === "BOOLEAN") return `<label class="kb-set kb-set-bool">${label}<span class="kb-switch"><input type="checkbox" data-ps="${esc(s.name)}" data-pt="b"${v ? " checked" : ""}><i></i></span></label>`;
              if (s.type === "NUMBER") return `<label class="kb-set">${label}<input class="kb-field kb-num" type="number" data-ps="${esc(s.name)}" data-pt="n" value="${v == null ? "" : esc(v)}"></label>`;
              return `<label class="kb-set">${label}<input class="kb-field" data-ps="${esc(s.name)}" data-pt="s" value="${esc(v == null ? "" : v)}" spellcheck="false"></label>`;
            })
            .join("")}<button class="kb-btn is-primary" type="submit">Save</button></form></details>` : ""}
          ${p.tasks && p.tasks.length && p.enabled ? `<details><summary>Tasks</summary><div class="kb-ptasks">${p.tasks
            .map((t) => `<div class="kb-ptask"><div><b>${esc(t.name)}</b>${t.description ? `<small>${esc(t.description)}</small>` : ""}</div><button class="kb-btn" data-run="${esc(t.name)}">${icon("play")}Run</button></div>`)
            .join("")}</div></details>` : ""}
          ${p.url ? `<a class="kb-plugin-link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Project page</a>` : ""}
        </article>`;
      })
      .join("");
  }

  list.addEventListener("change", async (e) => {
    const en = e.target.closest("[data-enable]");
    if (!en) return;
    const id = en.closest("[data-id]").dataset.id;
    try {
      await gql(`mutation($m: BoolMap!) { setPluginsEnabled(enabledMap: $m) }`, { m: { [id]: en.checked } });
      window.dispatchEvent(new Event("stash:plugins-changed"));
      toast(`${en.checked ? "Turned on" : "Turned off"} – takes effect after reloading the page`, "ok");
      en.closest("[data-id]").classList.toggle("is-off", !en.checked);
    } catch (err) {
      en.checked = !en.checked;
      errorToast(err, "Plugin");
    }
  });
  list.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = e.target.closest("[data-id]").dataset.id;
    const input = {};
    e.target.querySelectorAll("[data-ps]").forEach((el) => {
      const t = el.dataset.pt;
      if (t === "b") input[el.dataset.ps] = el.checked;
      else if (t === "n") {
        if (el.value !== "") input[el.dataset.ps] = Number(el.value);
      } else if (el.value !== "") input[el.dataset.ps] = el.value;
    });
    try {
      await gql(`mutation($id: ID!, $i: Map!) { configurePlugin(plugin_id: $id, input: $i) }`, { id, i: input });
      toast("Plugin settings saved", "ok");
    } catch (err) {
      errorToast(err, "Save");
    }
  });
  list.addEventListener("click", async (e) => {
    const r = e.target.closest("[data-run]");
    if (!r) return;
    const id = r.closest("[data-id]").dataset.id;
    try {
      await gql(`mutation($id: ID!, $t: String!) { runPluginTask(plugin_id: $id, task_name: $t) }`, { id, t: r.dataset.run });
      toast(`“${r.dataset.run}” started`, "ok");
      pokeJobs();
    } catch (err) {
      errorToast(err, "Plugin task");
    }
  });
  main.querySelector("[data-reload]").onclick = async () => {
    try {
      await gql(`mutation { reloadPlugins }`);
      toast("Plugins reloaded", "ok");
      load();
    } catch (err) {
      errorToast(err, "Reload");
    }
  };
  await load();
}
