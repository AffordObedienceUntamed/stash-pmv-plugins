// Mini player: the video keeps playing small in a corner while you browse. The player hands over its
// <video> element (moved, not copied – so it doesn't stop); history keeps counting through the player's
// own listeners. Drag it into any corner; "Back to the player" continues at the same spot.

import { esc, icon, store } from "./ui.js";
import { t } from "./i18n.js";
import { app, go } from "./main.js";

let cur = null; // { el, v, id, onLeave }

export function startMini({ video, id, title, onLeave }) {
  stopMini();
  const wasPlaying = !video.paused;
  const el = document.createElement("div");
  el.className = "kb-mini is-" + store.get("miniCorner", "br");
  el.innerHTML = `
    <div class="kb-mini-screen" data-mscreen></div>
    <div class="kb-mini-bar">
      <button type="button" data-mplay aria-label="${t("Play/pause")}"></button>
      <button type="button" class="kb-mini-title" data-mopen title="${t("Back to the player")}">${esc(title)}</button>
      ${document.pictureInPictureEnabled ? `<button type="button" data-mpip title="${t("Picture in picture – floats above other windows")}">${icon("pip")}</button>` : ""}
      <button type="button" data-mopen title="${t("Back to the player")}">${icon("expand")}</button>
      <button type="button" data-mclose title="${t("Close")}">${icon("close")}</button>
    </div>
    <div class="kb-mini-prog"><i data-mprog></i></div>`;
  el.querySelector("[data-mscreen]").appendChild(video);
  document.body.appendChild(el);
  if (wasPlaying && video.paused) video.play().catch(() => {});
  video.controls = false;

  const playBtn = el.querySelector("[data-mplay]");
  const prog = el.querySelector("[data-mprog]");
  const paint = () => (playBtn.innerHTML = icon(video.paused ? "play" : "pause"));
  const tick = () => (prog.style.width = video.duration ? `${(video.currentTime / video.duration) * 100}%` : "0%");
  video.addEventListener("play", paint);
  video.addEventListener("pause", paint);
  video.addEventListener("timeupdate", tick);
  paint();
  tick();

  // Drag anywhere, let go → it snaps into the nearest corner
  let drag = null;
  el.querySelector("[data-mscreen]").addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = el.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    el.classList.add("is-dragging");
    Object.assign(el.style, { left: drag.left + dx + "px", top: drag.top + dy + "px", right: "auto", bottom: "auto" });
  });
  el.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (!moved) {
      if (e.target.closest("[data-mscreen]")) video.paused ? video.play().catch(() => {}) : video.pause();
      return;
    }
    const r = el.getBoundingClientRect();
    const corner = (r.top + r.height / 2 < innerHeight / 2 ? "t" : "b") + (r.left + r.width / 2 < innerWidth / 2 ? "l" : "r");
    store.set("miniCorner", corner);
    el.classList.remove("is-dragging", "is-tl", "is-tr", "is-bl", "is-br");
    el.classList.add("is-" + corner);
    el.style.left = el.style.top = el.style.right = el.style.bottom = "";
  });

  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-mplay]")) video.paused ? video.play().catch(() => {}) : video.pause();
    else if (e.target.closest("[data-mpip]")) video.requestPictureInPicture().catch(() => {});
    else if (e.target.closest("[data-mopen]")) {
      const at = video.currentTime;
      stopMini();
      app.miniResume = { id, at }; // the player starts right there
      go("scene/" + id);
    } else if (e.target.closest("[data-mclose]")) stopMini();
  });
  cur = { el, v: video, id, onLeave };
}

// Ends the mini player (saves the watching progress through the player). Returns { id, at } or null.
export function stopMini() {
  if (!cur) return null;
  const { el, v, id, onLeave } = cur;
  cur = null;
  const at = v.currentTime;
  try {
    onLeave && onLeave();
  } catch (e) {}
  if (document.pictureInPictureElement === v) document.exitPictureInPicture().catch(() => {});
  v.pause();
  v.removeAttribute("src");
  v.load();
  el.remove();
  return { id, at };
}

export const miniActive = () => !!cur;
