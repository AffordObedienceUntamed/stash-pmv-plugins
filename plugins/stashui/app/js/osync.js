// "Match the O video": an O video that shows this video running in its background is lined up with it once –
// then it plays along in a window whenever this video plays (see oclip.js).
// Both videos sit side by side. Put both on a moment you can recognise in each (a cut of the PMV, say) and press
// "These two match"; or let it find the match by the sound. Then play both together and nudge until it is right.

import { esc, icon, toast, errorToast, openDrawer } from "./ui.js";
import { t } from "./i18n.js";
import { findItems, getScene } from "./api.js";
import { runBackend } from "./interactive.js";
import { fpsOf, stepFrame, fmtExact } from "./frames.js";
import { oData, syncOf, setSync } from "./oclip.js";

export function openOSync({ scene, onDone }) {
  const cur = syncOf(scene.id);
  let other = null; // the O video: scene with paths + files
  let offset = cur ? cur.offset : 0; // O time = main time − offset
  let touched = !!cur;
  let playing = false;
  let raf = 0;

  const d = openDrawer({
    title: t("Match the O video"),
    body: `
      <p class="kb-hint">${t("1. Choose the O video.  2. Put both videos on a moment you can recognise in each – a cut of the PMV in the background, for example.  3. Press “These two match”. Then “Play both” to check; nudge until it fits.")}</p>
      <div class="kb-osync-pick" data-pick>
        <div class="kb-cut-find"><input class="kb-field" data-q placeholder="${esc(t("Search the O video …"))}" autocomplete="off"></div>
        <div class="kb-oc-grid" data-grid></div>
      </div>
      <div class="kb-osync-main" data-main hidden>
        <div class="kb-osync-head"><span class="kb-chip" data-chip></span><button type="button" class="kb-btn is-ghost" data-change>${t("Change")}</button></div>
        <div class="kb-osync-vids">
          ${["a", "b"]
            .map(
              (k) => `<figure class="kb-osync-fig">
            <figcaption>${k === "a" ? t("This video") : t("O video")} <b data-t${k}>0:00.000</b></figcaption>
            <video data-v${k} playsinline preload="auto" controls${k === "b" ? " muted" : ""}></video>
            <div class="kb-osync-step" data-step="${k}">
              <button type="button" class="kb-btn is-ghost" data-d="-5">−5 s</button>
              <button type="button" class="kb-btn is-ghost" data-d="-1">−1 s</button>
              <button type="button" class="kb-btn is-ghost" data-d="-0.1">−0.1</button>
              <button type="button" class="kb-btn is-ghost" data-f="-1" title="${esc(t("One frame earlier"))}">${icon("framePrev")}</button>
              <button type="button" class="kb-btn is-ghost" data-f="1" title="${esc(t("One frame later"))}">${icon("frameNext")}</button>
              <button type="button" class="kb-btn is-ghost" data-d="0.1">+0.1</button>
              <button type="button" class="kb-btn is-ghost" data-d="1">+1 s</button>
              <button type="button" class="kb-btn is-ghost" data-d="5">+5 s</button>
            </div>
          </figure>`
            )
            .join("")}
        </div>
        <div class="kb-osync-match">
          <button type="button" class="kb-btn is-primary" data-omatch>${icon("check")}${t("These two match")}</button>
          <button type="button" class="kb-btn is-ghost" data-auto title="${esc(t("Compares the sound of both videos – works when the O video has the music of this video in it"))}">${icon("music")}${t("Find it by the sound")}</button>
          <button type="button" class="kb-btn is-ghost" data-both>${icon("play")}${t("Play both")}</button>
        </div>
        <div class="kb-osync-off">
          <span data-offtxt></span>
          <span class="kb-osync-nudge" data-nudge title="${esc(t("+ the O video comes later in this video, − earlier"))}">
            <button type="button" class="kb-btn is-ghost" data-o="-1">−1 s</button>
            <button type="button" class="kb-btn is-ghost" data-o="-0.1">−0.1</button>
            <button type="button" class="kb-btn is-ghost" data-o="-0.04">−1 ${t("frame")}</button>
            <button type="button" class="kb-btn is-ghost" data-o="0.04">+1 ${t("frame")}</button>
            <button type="button" class="kb-btn is-ghost" data-o="0.1">+0.1</button>
            <button type="button" class="kb-btn is-ghost" data-o="1">+1 s</button>
          </span>
        </div>
        <p class="kb-hint" data-note></p>
      </div>`,
    foot: `<button class="kb-btn is-ghost" data-remove${cur ? "" : " hidden"}>${t("Remove the O video")}</button><span class="kb-spacer"></span><button class="kb-btn is-primary" data-save disabled>${t("Save")}</button>`,
    onClose: () => {
      cancelAnimationFrame(raf);
      va && va.pause();
      vb && vb.pause();
      va && va.removeAttribute("src");
      vb && vb.removeAttribute("src");
    },
  });
  const el = d.el;
  el.classList.add("kb-osync");
  const $ = (s) => el.querySelector(s);
  const va = $("[data-va]");
  const vb = $("[data-vb]");
  const fpsA = fpsOf(scene);
  let fpsB = 30;
  va.src = scene.paths.stream;

  // ---- the O video ----
  let reqId = 0;
  async function search() {
    const id = ++reqId;
    const q = $("[data-q]").value.trim();
    const grid = $("[data-grid]");
    grid.innerHTML = `<p class="kb-hint">${t("Loading …")}</p>`;
    try {
      const r = await findItems("scene", { q, per_page: 24, sort: "created_at", direction: "DESC" }, {}, null, { signal: undefined });
      if (id !== reqId) return;
      const ss = r.items.filter((s) => s.id !== scene.id);
      grid.innerHTML = ss.length
        ? ss
            .map(
              (s) => `<button type="button" class="kb-cut-scene" data-id="${s.id}" title="${esc(s.title || "")}"><img loading="lazy" alt="" src="${esc((s.paths || {}).screenshot || "")}"><span>${esc(s.title || (s.files[0] || {}).basename || "")}</span></button>`
            )
            .join("")
        : `<p class="kb-hint">${t("Nothing found.")}</p>`;
    } catch (e) {
      grid.innerHTML = "";
      errorToast(e, "O video");
    }
  }
  let qt = 0;
  $("[data-q]").oninput = () => {
    clearTimeout(qt);
    qt = setTimeout(search, 350);
  };
  $("[data-grid]").onclick = (e) => {
    const b = e.target.closest("[data-id]");
    if (b) choose(b.dataset.id);
  };
  $("[data-change]").onclick = () => {
    stop();
    $("[data-main]").hidden = true;
    $("[data-pick]").hidden = false;
    search();
  };

  async function choose(id) {
    try {
      other = await getScene(id);
    } catch (e) {
      return errorToast(e, "O video");
    }
    fpsB = fpsOf(other);
    vb.src = other.paths.stream;
    $("[data-pick]").hidden = true;
    $("[data-main]").hidden = false;
    $("[data-chip]").textContent = other.title || (other.files[0] || {}).basename || "";
    // start where it already was matched: the O video's own start
    const at = Math.max(0, offset);
    const go = () => {
      va.currentTime = at;
      vb.currentTime = Math.max(0, at - offset);
    };
    va.readyState ? go() : va.addEventListener("loadedmetadata", go, { once: true });
    paint();
  }

  // ---- showing the times, the offset ----
  function paint() {
    $("[data-ta]").textContent = fmtExact(va.currentTime);
    $("[data-tb]").textContent = fmtExact(vb.currentTime);
    $("[data-offtxt]").innerHTML = touched
      ? offset >= 0
        ? t("The O video starts {s} into this video.", { s: `<b>${fmtExact(offset)}</b>` })
        : t("This video is already {s} in when the O video starts.", { s: `<b>${fmtExact(-offset)}</b>` })
      : t("Not matched yet.");
    $("[data-save]").disabled = !other || !touched;
    $("[data-nudge]").classList.toggle("is-off", !touched);
  }
  ["timeupdate", "seeked", "loadedmetadata"].forEach((ev) => {
    va.addEventListener(ev, paint);
    vb.addEventListener(ev, paint);
  });

  // ---- stepping each video ----
  el.addEventListener("click", (e) => {
    const st = e.target.closest("[data-step] .kb-btn");
    if (!st) return;
    const k = st.closest("[data-step]").dataset.step;
    const v = k === "a" ? va : vb;
    if (st.dataset.f) stepFrame(v, k === "a" ? fpsA : fpsB, Number(st.dataset.f));
    else {
      v.pause();
      v.currentTime = Math.max(0, v.currentTime + Number(st.dataset.d));
    }
    if (playing) stop();
  });

  // ---- matching ----
  $("[data-omatch]").onclick = () => {
    offset = Math.round((va.currentTime - vb.currentTime) * 1000) / 1000;
    touched = true;
    toast(t("Matched: the O video lines up with this video."), "ok");
    paint();
  };
  $("[data-nudge]").onclick = (e) => {
    const b = e.target.closest("[data-o]");
    if (!b) return;
    if (!touched) {
      offset = Math.round((va.currentTime - vb.currentTime) * 1000) / 1000;
      touched = true;
    }
    // the O video moves later (a bigger offset means it starts later in this video)
    offset = Math.round((offset + Number(b.dataset.o)) * 1000) / 1000;
    follow(true);
    paint();
  };
  $("[data-auto]").onclick = async (e) => {
    if (!other) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    $("[data-note]").textContent = t("Comparing the sound … (this can take a few seconds)");
    try {
      const r = await runBackend({ mode: "sync_audio", scene_a: scene.id, scene_b: other.id });
      offset = r.offset;
      touched = true;
      follow(true);
      $("[data-note]").textContent = r.sure ? t("Found by the sound – check it with “Play both”.") : t("Not sure about this one (the sounds differ a lot) – check it with “Play both” and correct it by hand.");
      paint();
    } catch (err) {
      $("[data-note]").textContent = "";
      errorToast(err, "O video");
    } finally {
      btn.disabled = false;
    }
  };

  // ---- both together ----
  // the O video follows this one: O time = this time − offset (it waits at its first frame, or stops at its last)
  function follow(seek) {
    const want = va.currentTime - offset;
    const dur = vb.duration || Infinity;
    if (want < 0 || want >= dur) {
      !vb.paused && vb.pause();
      if (seek) vb.currentTime = Math.min(Math.max(0, want), Math.max(0, dur - 0.05));
      return;
    }
    if (seek || Math.abs(vb.currentTime - want) > 0.15) vb.currentTime = want;
    if (!va.paused && vb.paused) vb.play().catch(() => {});
    if (va.paused && !vb.paused) vb.pause();
  }
  function loop() {
    follow(false);
    raf = playing ? requestAnimationFrame(loop) : 0;
  }
  function stop() {
    playing = false;
    va.pause();
    vb.pause();
    $("[data-both]").innerHTML = `${icon("play")}${t("Play both")}`;
  }
  $("[data-both]").onclick = () => {
    if (playing) return stop();
    if (!touched) return toast(t("Match the two videos first (“These two match” or “Find it by the sound”)."), "error");
    playing = true;
    $("[data-both]").innerHTML = `${icon("pause")}${t("Stop")}`;
    va.play().catch(() => {});
    follow(true);
    raf = requestAnimationFrame(loop);
  };
  // pressing play on this video's own controls while matched: the O video comes along
  va.addEventListener("play", () => {
    if (touched && !playing) {
      playing = true;
      $("[data-both]").innerHTML = `${icon("pause")}${t("Stop")}`;
      raf = requestAnimationFrame(loop);
    }
  });
  va.addEventListener("pause", () => playing && va.paused && (follow(false), (playing = false), ($("[data-both]").innerHTML = `${icon("play")}${t("Play both")}`)));
  va.addEventListener("seeked", () => touched && follow(true));

  // ---- saving ----
  $("[data-save]").onclick = async () => {
    await oData();
    setSync(scene.id, { scene: other.id, offset, len: Math.max(1, Math.round((vb.duration || (other.files[0] || {}).duration || 0) * 100) / 100), title: other.title || (other.files[0] || {}).basename || "" });
    toast(t("The O video will play along with this video."), "ok");
    onDone && onDone();
    d.close();
  };
  $("[data-remove]").onclick = async () => {
    await oData();
    setSync(scene.id, null);
    onDone && onDone();
    d.close();
  };

  // ---- start ----
  if (cur) choose(cur.scene);
  else search();
}
