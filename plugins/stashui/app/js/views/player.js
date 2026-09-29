// Scene player: custom controls, timeline with thumbnails, resume, history,
// queue/random/endless, keyboard, placard with all details.

import { esc, icon, fmtDuration, store, toast, errorToast } from "../ui.js";
import { t } from "../i18n.js";
import { getScene, findItems, saveActivity, addPlay } from "../api.js";
import { toPiece } from "../pieces.js";
import { app, go, closeOverlay } from "../main.js";
import { placardHtml, bindPlacard } from "./placard.js";
import { similarScenes } from "../similar.js";
import { createVR, guessVR } from "../vr.js";
import { videoGlow } from "../theme.js";
import { BINS, watchRecorder, watchBins, motionBins, combine, peaks } from "../heat.js";

// Read Stash's sprite VTT: time ranges → region in the sprite image
async function loadSprites(vttUrl, spriteUrl) {
  try {
    const txt = await (await fetch(vttUrl)).text();
    const cues = [];
    const re = /(\d+):(\d+):(\d+)\.(\d+)\s+-->\s+(\d+):(\d+):(\d+)\.(\d+)\s*\n([^\n]+)/g;
    let m;
    const secs = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000;
    while ((m = re.exec(txt))) {
      const xywh = (m[9].match(/#xywh=(\d+),(\d+),(\d+),(\d+)/) || []).slice(1).map(Number);
      if (xywh.length === 4) cues.push({ start: secs(m[1], m[2], m[3], m[4]), end: secs(m[5], m[6], m[7], m[8]), xywh });
    }
    return cues.length ? { cues, url: spriteUrl } : null;
  } catch (e) {
    return null;
  }
}

export async function render(host, params) {
  document.body.classList.add("kb-noscroll");
  host.innerHTML = `<div class="kb-stage kb-player"><div class="kb-loading">${t("Loading …")}</div></div>`;
  let x = await getScene(params.id);
  if (!x) {
    host.innerHTML = `<div class="kb-stage"><div class="kb-empty"><b>${t("This scene no longer exists")}</b><button class="kb-btn" data-close>${t("Close")}</button></div></div>`;
    host.querySelector("[data-close]").onclick = closeOverlay;
    return;
  }
  const f = x.files[0] || {};
  const setShape = (w, h) => w && h && host.querySelector(".kb-stage") && host.querySelector(".kb-stage").style.setProperty("--ar", (w / h).toFixed(4));
  const prefs = Object.assign({ volume: 0.8, muted: false, auto: true, random: false, loop: false, panel: true, heat: true }, store.get("player", {}));
  const ctx = app.context || {};
  const inQueue = !!ctx.queue;

  host.innerHTML = `
    <div class="kb-stage kb-player${prefs.panel ? " has-panel" : ""}" tabindex="-1">
      <div class="kb-screen">
        <video class="kb-video" playsinline preload="auto" poster="${esc(x.paths.screenshot || "")}"></video>
        <div class="kb-bigplay" data-bigplay hidden>${icon("play")}</div>
        <div class="kb-resume-hint" data-resume hidden></div>
        <div class="kb-topbar">
          <button class="kb-btn is-icon is-ghost" data-close aria-label="${t("Close (Esc)")}" title="${t("Close (Esc)")}">${icon("back")}</button>
          <span class="kb-topbar-title">${esc(x.title || f.basename || "")}</span>
          <button class="kb-btn is-icon is-ghost" data-panel aria-label="${t("Details on/off (I)")}" title="${t("Details on/off (I)")}">${icon("info")}</button>
        </div>
        <div class="kb-controls">
          <div class="kb-timeline${prefs.heat ? " has-heat" : ""}" data-timeline>
            <canvas class="kb-tl-heat" data-heat width="800" height="40" hidden></canvas>
            <div class="kb-tl-buf" data-buf></div>
            <div class="kb-tl-played" data-played></div>
            <div class="kb-tl-resume" data-resmark hidden></div>
            <div class="kb-tl-knob" data-knob></div>
            <div class="kb-tl-hls" data-hls></div>
            <div class="kb-tl-peek" data-peek hidden><div class="kb-tl-peek-img" data-peekimg></div><span data-peektime></span></div>
          </div>
          <div class="kb-ctrl-row">
            <button class="kb-btn is-icon is-ghost" data-prev aria-label="${t("Previous (P)")}" title="${t("Previous (P)")}">${icon("prev")}</button>
            <button class="kb-btn is-icon is-ghost kb-playbtn" data-play aria-label="${t("Play/pause (Space)")}">${icon("play")}</button>
            <button class="kb-btn is-icon is-ghost" data-next aria-label="${t("Next (N)")}" title="${t("Next (N)")}">${icon("next")}</button>
            <span class="kb-time"><span data-cur>0:00</span> / <span data-dur>${fmtDuration(f.duration)}</span></span>
            <span class="kb-spacer"></span>
            <button class="kb-btn is-ghost kb-toggle${prefs.heat ? " is-on" : ""}" data-heatbtn title="${t("Highlights: heat curve and jump marks on the timeline (J jumps to the next one)")}">${icon("bolt")}<span>${t("Highlights")}</span></button>
            <button class="kb-btn is-ghost kb-toggle${prefs.random ? " is-on" : ""}" data-random title="${t("Play something random next")}">${icon("shuffle")}<span>${t("Random")}</span></button>
            <button class="kb-btn is-ghost kb-toggle${prefs.auto ? " is-on" : ""}" data-auto title="${t("Continue automatically at the end")}">${icon("next")}<span>${t("Endless")}</span></button>
            <button class="kb-btn is-ghost kb-toggle${prefs.loop ? " is-on" : ""}" data-loop title="${t("Repeat this scene")}">${icon("repeat")}<span>${t("Loop")}</span></button>
            <button class="kb-btn is-icon is-ghost" data-mute aria-label="${t("Sound on/off (M)")}" title="${t("Sound on/off (M)")}"></button>
            <input class="kb-vol" type="range" min="0" max="1" step="0.02" data-vol aria-label="${t("Volume")}">
            <span class="kb-pmenu-wrap"><button class="kb-btn is-icon is-ghost" data-menubtn aria-label="${t("Quality, subtitles, speed")}" title="${t("Quality, subtitles, speed")}">${icon("gear")}</button><div class="kb-pmenu" data-menu hidden></div></span>
            <button class="kb-btn is-icon is-ghost" data-fs aria-label="${t("Fullscreen (F)")}" title="${t("Fullscreen (F)")}">${icon("expand")}</button>
          </div>
        </div>
      </div>
      <aside class="kb-side" data-side>${placardHtml("scene", x)}<div class="kb-upnext" data-upnext></div><div class="kb-upnext kb-similar" data-similar></div></aside>
    </div>`;

  const stage = host.querySelector(".kb-stage");
  const $ = (s) => host.querySelector(s);
  const v = $("video");
  setShape(f.width, f.height);
  v.addEventListener("loadedmetadata", () => setShape(v.videoWidth, v.videoHeight));
  v.volume = prefs.volume;
  v.muted = prefs.muted;
  v.loop = prefs.loop;
  const savePrefs = () => store.set("player", prefs);

  // ---------- Source: direct stream, otherwise transcode ----------
  const streams = (x.sceneStreams || []).filter((s) => /mp4|webm/.test(s.mime_type || s.url));
  const sources = [x.paths.stream, ...streams.map((s) => s.url)].filter(Boolean);
  const picked = prefs.quality && streams.find((s) => s.label === prefs.quality);
  let srcIdx = picked ? Math.max(0, sources.indexOf(picked.url)) : 0;
  // Subtitles from Stash (served as WebVTT); the last chosen language comes on by itself
  const caps = x.paths.caption ? x.captions || [] : [];
  caps.forEach((c) => {
    const tr = document.createElement("track");
    tr.kind = "subtitles";
    tr.srclang = c.language_code;
    tr.label = c.language_code.toUpperCase() + (caps.filter((o) => o.language_code === c.language_code).length > 1 ? " (" + c.caption_type + ")" : "");
    tr.src = `${x.paths.caption}?lang=${encodeURIComponent(c.language_code)}&type=${encodeURIComponent(c.caption_type)}`;
    // Lines sit a bit higher so the control bar doesn't cover them (Chrome/Edge: via CSS in stage.css)
    if (!CSS.supports("selector(::-webkit-media-text-track-container)")) tr.addEventListener("load", () => [...(tr.track.cues || [])].forEach((c) => (c.line = -4)));
    v.appendChild(tr);
  });
  const setSubs = (i) => [...v.textTracks].forEach((tt, k) => (tt.mode = k === i ? "showing" : "disabled"));
  const subsOn = () => [...v.textTracks].findIndex((tt) => tt.mode === "showing");
  if (caps.length) {
    const want = caps.findIndex((c) => c.language_code === prefs.subs);
    setTimeout(() => setSubs(want));
  }
  function switchSource(i) {
    if (i === srcIdx) return;
    const at = v.currentTime;
    const playing = !v.paused;
    srcIdx = i;
    v.src = sources[i];
    v.currentTime = at;
    if (playing) v.play().catch(() => {});
  }
  // Menu: quality, subtitles, speed (one button instead of three – the bar is full enough)
  function menuHtml() {
    const q = [[0, t("Original (direct)")], ...streams.map((s) => [sources.indexOf(s.url), s.label])];
    const on = subsOn();
    const row = (attr, val, label, active) => `<button type="button" class="kb-pmenu-opt${active ? " is-on" : ""}" ${attr}="${val}">${active ? icon("check") : "<i></i>"}${esc(label)}</button>`;
    return `<div class="kb-pmenu-sec"><b>${t("Quality")}</b>${q.map(([i, l]) => row("data-q", i, l, i === srcIdx)).join("")}</div>` +
      (caps.length ? `<div class="kb-pmenu-sec"><b>${t("Subtitles")}</b>${row("data-sub", -1, t("Off"), on < 0)}${[...v.textTracks].map((tt, k) => row("data-sub", k, tt.label, on === k)).join("")}</div>` : "") +
      (vr ? `<div class="kb-pmenu-sec"><b>VR</b>${[["", t("Off")], ["180", "180°"], ["180sbs", t("180° side by side")], ["360", "360°"], ["360tb", t("360° top/bottom")], ["360sbs", t("360° side by side")]].map(([m, l]) => row("data-vr", m, l, vr.mode === m)).join("")}</div>` : "") +
      `<div class="kb-pmenu-sec"><b>${t("Speed")}</b><div class="kb-pmenu-speeds">${[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => `<button type="button" class="kb-chip${v.playbackRate === s ? " is-on" : ""}" data-rate="${s}">${s}×</button>`).join("")}</div></div>`;
  }
  // VR: remembered choice for this scene, otherwise guessed from file name and tags
  const vr = createVR($(".kb-screen"), v);
  const stopGlow = videoGlow(stage, v);
  const vrSaved = store.get("vrScenes", {});
  if (vr) vr.setMode(x.id in vrSaved ? vrSaved[x.id] : guessVR(f.basename, x.tags));
  const menu = $("[data-menu]");
  const closeMenu = () => (menu.hidden = true);
  const onDocDown = (e) => {
    if (!menu.hidden && !e.target.closest(".kb-pmenu-wrap")) closeMenu();
  };
  document.addEventListener("pointerdown", onDocDown, true);
  menu.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.q != null) {
      const i = Number(b.dataset.q);
      prefs.quality = i === 0 ? null : (streams.find((s) => s.url === sources[i]) || {}).label;
      savePrefs();
      switchSource(i);
    } else if (b.dataset.sub != null) {
      const i = Number(b.dataset.sub);
      setSubs(i);
      prefs.subs = i < 0 ? null : v.textTracks[i].language;
      savePrefs();
    } else if (b.dataset.vr != null) {
      vr.setMode(b.dataset.vr);
      store.set("vrScenes", Object.assign(store.get("vrScenes", {}), { [x.id]: b.dataset.vr }));
    } else if (b.dataset.rate) v.playbackRate = v.defaultPlaybackRate = Number(b.dataset.rate); // default: survives a quality switch
    menu.innerHTML = menuHtml();
  });
  v.addEventListener("error", () => {
    if (srcIdx < sources.length - 1) {
      const at = v.currentTime;
      v.src = sources[++srcIdx];
      v.currentTime = at;
      v.play().catch(() => {});
    } else toast(t("This video can't be played here"), "error");
  });
  v.src = sources[srcIdx];

  // Resume
  const dur = f.duration || 0;
  const resumeAt = x.resume_time && dur && x.resume_time > 5 && x.resume_time < dur * 0.95 ? x.resume_time : 0;
  if (resumeAt) {
    v.currentTime = resumeAt;
    const r = $("[data-resume]");
    r.innerHTML = `${t("Resume at {time}", { time: fmtDuration(resumeAt) })} <button class="kb-btn" data-fromstart>${t("From the start")}</button>`;
    r.hidden = false;
    setTimeout(() => (r.hidden = true), 6000);
    r.querySelector("[data-fromstart]").onclick = () => {
      v.currentTime = 0;
      r.hidden = true;
    };
    const mark = $("[data-resmark]");
    mark.hidden = false;
    mark.style.left = (resumeAt / dur) * 100 + "%";
  }
  v.play().catch(() => ($("[data-bigplay]").hidden = false));

  // ---------- History ----------
  const watch = watchRecorder(x.id, dur);
  let playedSec = 0;
  let lastTick = null;
  let counted = false;
  let lastSave = 0;
  const flushActivity = (force) => {
    if (!playedSec && !force) return;
    const p = playedSec;
    playedSec = 0;
    lastSave = Date.now();
    watch.flush();
    saveActivity(x.id, v.currentTime >= dur * 0.98 ? 0 : v.currentTime, p).catch(() => {});
  };
  v.addEventListener("timeupdate", () => {
    const now = performance.now();
    if (!v.paused && lastTick != null) {
      const sec = Math.min(1, (now - lastTick) / 1000) * v.playbackRate;
      playedSec += sec;
      watch.played(v.currentTime, sec);
    }
    lastTick = now;
    if (!counted && (v.currentTime > Math.min(15, dur * 0.1) || playedSec > 10)) {
      counted = true;
      addPlay(x.id).catch(() => {});
    }
    if (Date.now() - lastSave > 10000) flushActivity();
    paintTime();
  });
  v.addEventListener("pause", () => {
    lastTick = null;
    flushActivity(true);
    syncPlay();
    wake(); // show the controls right away (on touch screens there's no mouse movement that would)
  });
  v.addEventListener("play", syncPlay);
  v.addEventListener("progress", paintBuffer);

  // ---------- Timeline ----------
  const tl = $("[data-timeline]");
  function paintTime() {
    const d = v.duration || dur || 1;
    $("[data-played]").style.width = (v.currentTime / d) * 100 + "%";
    $("[data-knob]").style.left = (v.currentTime / d) * 100 + "%";
    $("[data-cur]").textContent = fmtDuration(v.currentTime);
    if (v.duration) $("[data-dur]").textContent = fmtDuration(v.duration);
  }
  function paintBuffer() {
    if (!v.buffered.length || !v.duration) return;
    $("[data-buf]").style.width = (v.buffered.end(v.buffered.length - 1) / v.duration) * 100 + "%";
  }
  const posFrom = (e) => {
    const r = tl.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  let sprites = null;
  const spritesReady = x.paths.vtt && x.paths.sprite ? loadSprites(x.paths.vtt, x.paths.sprite).then((s) => (sprites = s)) : Promise.resolve(null);

  // ---------- Highlights: heat curve + jump marks ----------
  let highlights = [];
  async function paintHeat() {
    const mot = await motionBins(await spritesReady, dur);
    const heat = combine(mot, watchBins(x.id));
    const cv = $("[data-heat]");
    if (!cv) return;
    if (!heat) {
      cv.hidden = true;
      return;
    }
    const g = cv.getContext("2d");
    const { width: W, height: H } = cv;
    g.clearRect(0, 0, W, H);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(255, 62, 138, .95)");
    grad.addColorStop(1, "rgba(255, 62, 138, .15)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, H);
    heat.forEach((h, i) => {
      const xx = ((i + 0.5) / BINS) * W;
      g.lineTo(xx, H - 3 - h * (H - 5));
    });
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    cv.hidden = false;
    highlights = peaks(heat, v.duration || dur);
    $("[data-hls]").innerHTML = highlights
      .map((sec) => `<button type="button" class="kb-tl-hl" data-hl="${sec}" style="left:${(sec / (v.duration || dur)) * 100}%" title="${t("Highlight at {time} (J)", { time: fmtDuration(sec) })}" aria-label="${t("Highlight at {time}", { time: fmtDuration(sec) })}"></button>`)
      .join("");
  }
  paintHeat();
  $("[data-hls]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hl]");
    if (!b) return;
    e.stopPropagation();
    v.currentTime = Number(b.dataset.hl);
    watch.seeked(v.currentTime);
    if (v.paused) v.play().catch(() => {});
  });
  function nextHighlight() {
    if (!highlights.length) return toast(t("No highlights for this scene yet"));
    const at = highlights.find((h) => h > v.currentTime + 2) ?? highlights[0];
    v.currentTime = at;
    watch.seeked(at);
    toast(t("Highlight at {time}", { time: fmtDuration(at) }));
  }
  tl.addEventListener("pointermove", (e) => {
    const p = posFrom(e);
    const at = p * (v.duration || dur);
    const peek = $("[data-peek]");
    peek.hidden = false;
    peek.style.left = p * 100 + "%";
    $("[data-peektime]").textContent = fmtDuration(at);
    const img = $("[data-peekimg]");
    const cue = sprites && sprites.cues.find((c) => at >= c.start && at < c.end);
    if (cue) {
      const [cx, cy, cw, ch] = cue.xywh;
      img.hidden = false;
      img.style.width = cw + "px";
      img.style.height = ch + "px";
      img.style.background = `url("${sprites.url}") -${cx}px -${cy}px`;
    } else img.hidden = true;
    if (scrubbing) v.currentTime = at;
  });
  tl.addEventListener("pointerleave", () => !scrubbing && ($("[data-peek]").hidden = true));
  let scrubbing = false;
  tl.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-hl]")) return; // jump mark: handles its own click
    scrubbing = true;
    tl.setPointerCapture(e.pointerId);
    v.currentTime = posFrom(e) * (v.duration || dur);
  });
  tl.addEventListener("pointerup", () => watch.seeked(v.currentTime));
  tl.addEventListener("pointerup", () => {
    scrubbing = false;
    $("[data-peek]").hidden = true;
  });

  // ---------- Controls ----------
  function syncPlay() {
    $("[data-play]").innerHTML = icon(v.paused ? "play" : "pause");
    $("[data-bigplay]").hidden = !v.paused || v.currentTime > 0.5 ? true : false;
    stage.classList.toggle("is-paused", v.paused);
  }
  function syncVol() {
    $("[data-mute]").innerHTML = icon(v.muted || v.volume === 0 ? "mute" : "volume");
    $("[data-vol]").value = v.muted ? 0 : v.volume;
  }
  syncVol();
  syncPlay();
  const toggle = () => (v.paused ? v.play().catch(() => {}) : v.pause());

  // Controls hide when idle
  let idle;
  const wake = () => {
    stage.classList.remove("is-idle");
    clearTimeout(idle);
    idle = setTimeout(() => !v.paused && stage.classList.add("is-idle"), 2600);
  };
  stage.addEventListener("pointermove", wake);
  wake();
  // Touch: the first tap on a player whose controls are hidden only brings them back (like other
  // video apps) – the next tap pauses. Mouse clicks pause right away as before.
  let tapWoke = false;
  let lastPointer = "mouse";
  stage.addEventListener("pointerdown", (e) => {
    lastPointer = e.pointerType;
    if (e.pointerType === "mouse") return;
    tapWoke = stage.classList.contains("is-idle");
    wake();
  });

  host.addEventListener("click", (e) => {
    const el = e.target;
    const woke = tapWoke;
    tapWoke = false;
    if (el.closest("[data-close]")) return closeOverlay();
    if (el.closest("[data-play]") || el.closest("[data-bigplay]")) return toggle();
    if (el === v) return woke ? undefined : toggle();
    if (el.closest(".kb-vr")) return woke || vr.dragged() ? undefined : toggle(); // a drag looks around, a click pauses
    if (el.closest("[data-next]")) return next(1);
    if (el.closest("[data-prev]")) return next(-1);
    if (el.closest("[data-fs]")) return fullscreen();
    if (el.closest("[data-menubtn]")) {
      if (menu.hidden) menu.innerHTML = menuHtml();
      menu.hidden = !menu.hidden;
      return;
    }
    if (el.closest("[data-mute]")) {
      v.muted = !v.muted;
      prefs.muted = v.muted;
      savePrefs();
      return syncVol();
    }
    if (el.closest("[data-panel]")) {
      prefs.panel = !prefs.panel;
      savePrefs();
      return stage.classList.toggle("has-panel", prefs.panel);
    }
    if (el.closest("[data-heatbtn]")) {
      prefs.heat = !prefs.heat;
      savePrefs();
      el.closest("[data-heatbtn]").classList.toggle("is-on", prefs.heat);
      return tl.classList.toggle("has-heat", prefs.heat);
    }
    const sim = el.closest("[data-simgo]");
    if (sim) return openScene(sim.dataset.simgo);
    for (const k of ["random", "auto", "loop"]) {
      const b = el.closest(`[data-${k}]`);
      if (b) {
        prefs[k] = !prefs[k];
        savePrefs();
        b.classList.toggle("is-on", prefs[k]);
        if (k === "loop") v.loop = prefs.loop;
        return;
      }
    }
    const up = el.closest("[data-upgo]");
    if (up) return jump(Number(up.dataset.upgo));
  });
  // Double click = fullscreen with the mouse only: on touch screens two quick taps (show controls, pause)
  // would count as a double click
  v.addEventListener("dblclick", () => lastPointer === "mouse" && fullscreen());
  $("[data-vol]").addEventListener("input", (e) => {
    v.volume = Number(e.target.value);
    v.muted = v.volume === 0;
    prefs.volume = v.volume;
    prefs.muted = v.muted;
    savePrefs();
    syncVol();
  });

  // Fullscreen shows only the picture (the info bar steps aside via CSS). On phones a landscape video
  // turns the screen to landscape. iPhones only allow fullscreen for the video itself → native player.
  async function fullscreen() {
    if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
    if (stage.requestFullscreen) {
      try {
        await stage.requestFullscreen({ navigationUI: "hide" });
        if (v.videoWidth > v.videoHeight && screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(() => {});
        return;
      } catch (e) { /* not allowed – try the video element below */ }
    }
    if (v.webkitEnterFullscreen) {
      try {
        return v.webkitEnterFullscreen();
      } catch (e) { /* not available either */ }
    }
    toast(t("Fullscreen not allowed"));
  }
  // Fullscreen: mouse at the right edge slides the info panel in (can be switched off in the settings)
  stage.addEventListener("pointermove", (e) => {
    if (document.fullscreenElement !== stage || e.pointerType !== "mouse" || prefs.fsPanel === false) return;
    const side = $("[data-side]");
    if (e.clientX >= innerWidth - 12) stage.classList.add("is-peek");
    else if (stage.classList.contains("is-peek") && e.clientX < innerWidth - side.offsetWidth - 40) stage.classList.remove("is-peek");
  });
  const onFsChange = () => {
    stage.classList.remove("is-peek");
    if (!document.fullscreenElement && screen.orientation && screen.orientation.unlock) {
      try {
        screen.orientation.unlock();
      } catch (e) { /* not locked */ }
    }
  };
  document.addEventListener("fullscreenchange", onFsChange);

  // ---------- Next / previous ----------
  // Order: queue > list it was opened from > random from the library
  function upcoming() {
    if (inQueue) {
      const q = store.get("queue", []);
      const pos = store.get("queuePos", 0);
      return { list: q.map((it) => ({ kind: it.kind, id: it.id, title: it.title, thumb: it.thumb })), pos };
    }
    if (ctx.pieces) {
      const list = ctx.pieces.filter((p) => p.kind === "scene");
      return { list, pos: list.findIndex((p) => p.id === x.id) };
    }
    return { list: [], pos: -1 };
  }
  async function next(dir) {
    flushActivity(true);
    if (prefs.random && dir > 0) {
      try {
        const r = await findItems("scene", { per_page: 1, sort: "random_" + Math.floor(Math.random() * 1e8) });
        if (r.items[0]) return openScene(r.items[0].id);
      } catch (e) {
        return errorToast(e, "Random");
      }
    }
    const { list, pos } = upcoming();
    const i = pos + dir;
    if (i < 0 || i >= list.length) return toast(dir > 0 ? t("That was the last video") : t("This is the first video"));
    jump(i);
  }
  function jump(i) {
    const { list } = upcoming();
    const it = list[i];
    if (!it) return;
    if (inQueue) store.set("queuePos", i);
    if (ctx.index != null && !inQueue) ctx.index = i;
    if (it.kind === "image") return go("image/" + it.id, true);
    openScene(it.id);
  }
  function openScene(id) {
    go("scene/" + id, true);
  }
  v.addEventListener("ended", () => {
    flushActivity(true);
    if (!prefs.loop && prefs.auto) next(1);
  });

  // "Up next" in the placard
  function paintUpnext() {
    const { list, pos } = upcoming();
    const rest = list.slice(pos + 1, pos + 6);
    $("[data-upnext]").innerHTML = rest.length
      ? `<h3>${inQueue ? t("Up next in the queue") : t("Up next")}</h3>` +
        rest
          .map((it, k) => `<button class="kb-upnext-item" data-upgo="${pos + 1 + k}">${it.thumb ? `<img alt="" src="${esc(it.thumb)}">` : ""}<span>${esc(it.title || it.id)}</span></button>`)
          .join("")
      : prefs.random
      ? `<h3>${t("Up next")}</h3><p class="kb-plc-meta">${t("Something random from the library.")}</p>`
      : "";
  }
  paintUpnext();

  // "Similar" in the placard – loads in the background
  async function paintSimilar() {
    const box = $("[data-similar]");
    if (!box) return;
    box.innerHTML = `<h3>${t("Similar")}</h3><p class="kb-plc-meta">${t("Searching …")}</p>`;
    try {
      const list = await similarScenes(x.id, 8);
      if (!box.isConnected) return;
      box.innerHTML = list.length
        ? `<h3>${t("Similar")}</h3>` +
          list
            .map((it) => `<button class="kb-upnext-item" data-simgo="${esc(it.id)}">${it.thumb ? `<img alt="" loading="lazy" src="${esc(it.thumb)}">` : ""}<span><b>${esc(it.title)}</b><small>${esc(it.why)}</small></span></button>`)
            .join("")
        : "";
    } catch (e) {
      box.innerHTML = "";
    }
  }
  paintSimilar();

  // ---------- Placard ----------
  const side = $("[data-side]");
  const plc = bindPlacard(side, "scene", () => x, {
    refresh: async () => {
      x = await getScene(x.id);
      side.innerHTML = placardHtml("scene", x) + '<div class="kb-upnext" data-upnext></div><div class="kb-upnext kb-similar" data-similar></div>';
      paintUpnext();
      paintSimilar();
    },
    onDeleted: () => {
      closeOverlay();
      if (ctx.hang) ctx.hang.remove(["scene:" + x.id]);
    },
    goFolder: () => goToFolder(f.path),
  });
  async function goToFolder(path) {
    const { loadFolders } = await import("../api.js");
    const tree = await loadFolders();
    const dir = (path || "").split(/[\\/]/).slice(0, -1).join("\\");
    const n = [...tree.nodes.values()].find((n) => n.path === dir);
    if (n) go("folder/" + n.id);
  }

  // ---------- Keyboard ----------
  const onKey = (e) => {
    if (e.target.closest && e.target.closest("input, textarea, select, .kb-drawer, .kb-dialog")) return;
    if (document.querySelector("#overlay-root .kb-drawer, #overlay-root .kb-dialog")) return;
    const k = e.key.toLowerCase();
    let handled = true;
    if (k === "escape") document.fullscreenElement ? document.exitFullscreen() : closeOverlay();
    else if (k === " " || k === "k") toggle();
    else if (k === "arrowright") (v.currentTime += e.shiftKey ? 30 : 5), watch.seeked(v.currentTime);
    else if (k === "arrowleft") (v.currentTime -= e.shiftKey ? 30 : 5), watch.seeked(v.currentTime);
    else if (k === "j") nextHighlight();
    else if (k === "arrowup") (v.volume = Math.min(1, v.volume + 0.05)), (prefs.volume = v.volume), syncVol();
    else if (k === "arrowdown") (v.volume = Math.max(0, v.volume - 0.05)), (prefs.volume = v.volume), syncVol();
    else if (k === "m") (v.muted = !v.muted), syncVol();
    else if (k === "f") fullscreen();
    else if (k === "n") next(1);
    else if (k === "p") next(-1);
    else if (k === "i") $("[data-panel]").click();
    else if (k === "h") plc.fav().catch((err) => errorToast(err, "Favorite"));
    else if (k === "o") plc.o(1).catch((err) => errorToast(err, "O counter"));
    else if (/^[1-5]$/.test(k)) plc.rate(Number(k)).catch((err) => errorToast(err, "Rating"));
    else if (/^[0-9]$/.test(k)) v.currentTime = (Number(k) / 10) * (v.duration || dur);
    else handled = false;
    if (handled) {
      e.preventDefault();
      wake();
    }
  };
  document.addEventListener("keydown", onKey);
  stage.focus();

  return () => {
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("fullscreenchange", onFsChange);
    document.removeEventListener("pointerdown", onDocDown, true);
    if (vr) vr.destroy();
    stopGlow();
    flushActivity(true);
    const tEnd = v.currentTime;
    v.pause();
    v.removeAttribute("src");
    v.load();
    savePrefs();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    // Update progress in the grid
    if (ctx.hang) {
      const p = ctx.hang.pieces.find((q) => q.kind === "scene" && q.id === x.id);
      if (p && dur) ctx.hang.update(Object.assign({}, p, { resume: tEnd && tEnd < dur * 0.98 ? tEnd / dur : 0 }));
    }
  };
}
