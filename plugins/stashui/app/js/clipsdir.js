// The one folder for all new clips, GIFs and edits (Settings → This interface → "Folder for new clips and GIFs", plugin setting clipsDir).
// With it set, the dialogs that make files say where they go instead of offering a "Clips" subfolder next to every original.

import { esc } from "./ui.js";
import { t } from "./i18n.js";
import { pluginConfig } from "./api.js";

let cache = null;
export const forgetClipsDir = () => (cache = null);
export async function clipsDir() {
  if (cache && Date.now() - cache.at < 20000) return cache.dir;
  let dir = "";
  try {
    dir = String((await pluginConfig("stashui")).clipsDir || "").trim();
  } catch (e) {
    dir = "";
  }
  cache = { at: Date.now(), dir };
  return dir;
}

// `ctl`: the checkbox / select of a dialog that decides "a subfolder Clips" – with the one folder set it is switched off and says so
export async function applyClipsDir(ctl) {
  if (!ctl) return;
  const dir = await clipsDir();
  if (!dir || !ctl.isConnected) return;
  const row = ctl.closest("label") || ctl.parentElement;
  ctl.disabled = true;
  if (ctl.type === "checkbox") ctl.checked = false;
  const text = row.querySelector("span:not(.kb-switch)") || row;
  if (ctl.tagName === "SELECT") row.querySelector("span").textContent = t("Saved in");
  if (ctl.tagName === "SELECT") ctl.innerHTML = `<option>${esc(dir)}</option>`;
  else text.textContent = t("Saved in {dir} (the folder for new clips in Settings)", { dir });
}
