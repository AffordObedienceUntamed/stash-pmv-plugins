// Funscript variants of one video: the stacked heatmap (one stripe per script, with its label, length
// and a warning when something is off) – used by the Handy menu and the funscript picker in the player.
// The data comes from Stash UI's backend (mode "funscript_variants", see ../../backend.py).

import { esc, fmtDuration } from "./ui.js";
import { t } from "./i18n.js";

// speed (units per second) → a colour: calm = blue, fast = red
const FULL = 450;
const tint = (sp) => (sp <= 0 ? "rgba(128,128,128,.14)" : `hsl(${Math.round(215 - 215 * Math.min(1, sp / FULL))} 70% 46%)`);

// What's wrong with a script, in words (null: nothing)
export function issueText(v, duration) {
  const len = fmtDuration(v.length || 0);
  if (v.issues.includes("broken")) return t("Broken – no usable movements");
  if (v.issues.includes("long")) return t("{len} – longer than the video ({dur})", { len, dur: fmtDuration(duration) });
  if (v.issues.includes("short")) return t("{len} – much shorter than the video ({dur})", { len, dur: fmtDuration(duration) });
  return null;
}

// The stripe: the script's speed over time, drawn on a track as long as the longer one of script and video.
// A script that ends early leaves a hatched rest, one that runs on is tinted red after the video's end.
export function stripe(v, duration) {
  const len = v.length || 0;
  const scale = Math.max(len, duration, 1);
  const f = (len / scale) * 100;
  const sp = v.speed || [];
  const stops = sp.map((s, i) => `${tint(s)} ${((i / sp.length) * f).toFixed(2)}% ${(((i + 1) / sp.length) * f).toFixed(2)}%`);
  const bg = stops.length ? `linear-gradient(90deg, ${stops.join(",")}, transparent ${f.toFixed(2)}%)` : "none";
  const end = duration && len > duration ? `<i class="kb-fsv-over" style="left:${((duration / scale) * 100).toFixed(2)}%"></i>` : "";
  const miss = duration && len && len < duration ? `<i class="kb-fsv-miss" style="left:${f.toFixed(2)}%"></i>` : "";
  return `<span class="kb-fsv-bar" style="background:${bg}">${end}${miss}</span>`;
}

// The script that's in use: the remembered one if it's still there, else the one with the video's name
export function activeOf(data, savedPath) {
  const vs = (data && data.variants) || [];
  const norm = (p) => String(p || "").replace(/\\/g, "/").toLowerCase();
  return vs.find((v) => savedPath && norm(v.path) === norm(savedPath)) || vs.find((v) => v.main) || vs[0] || null;
}

// The stack as HTML; every row is a button with data-fsvpath (the file's path)
export function stackHtml(data, active) {
  const vs = data.variants || [];
  if (!vs.length) return "";
  return `<div class="kb-fsv">${vs
    .map((v) => {
      const warn = issueText(v, data.duration);
      const on = active && active.path === v.path;
      return `<button type="button" class="kb-fsv-row${on ? " is-on" : ""}${warn ? " has-issue" : ""}" data-fsvpath="${esc(v.path)}" title="${esc(v.name)}">
        <span class="kb-fsv-lab"><b>${esc(v.label || t("Standard"))}</b><small>${v.length ? fmtDuration(v.length) : "–"}${v.actions ? ` · ${t("{n} movements", { n: v.actions })}` : ""}</small></span>
        ${stripe(v, data.duration)}
        <span class="kb-fsv-tag">${on ? t("in use") : ""}</span>
        ${warn ? `<span class="kb-fsv-warn">⚠ ${esc(warn)}</span>` : ""}</button>`;
    })
    .join("")}</div>`;
}
