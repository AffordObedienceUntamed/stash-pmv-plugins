// Queue: play items one after another, reorder, shuffle.

import { esc, icon, store, plural, toast } from "../ui.js";
import { app, go, setQueueCount } from "../main.js";

export function render(main) {
  const draw = () => {
    const q = store.get("queue", []);
    const pos = store.get("queuePos", 0);
    main.innerHTML = `
      <header class="kb-head">
        <div class="kb-head-title">
          <h1 class="kb-h1">Queue</h1>
          <p class="kb-sub">${q.length ? plural(q.length, "item", "items") + " waiting." : "Empty. Select items in a view and add them here, or press “Play” there."}</p>
        </div>
        <div class="kb-head-tools"${q.length ? "" : " hidden"}>
          <button class="kb-btn" data-shuffle>${icon("shuffle")}Shuffle</button>
          <button class="kb-btn" data-clear>${icon("trash")}Clear</button>
          <button class="kb-btn is-primary" data-play>${icon("play")}${pos > 0 && pos < q.length ? "Continue from no. " + (pos + 1) : "Play"}</button>
        </div>
      </header>
      <ol class="kb-queue">${q
        .map(
          (it, i) => `<li class="${i === pos ? "is-current" : ""}" data-i="${i}" draggable="true">
            <span class="kb-queue-no">${i + 1}</span>
            ${it.thumb ? `<img alt="" loading="lazy" src="${esc(it.thumb)}">` : '<span class="kb-queue-ph"></span>'}
            <button class="kb-queue-title" data-go="${i}">${esc(it.title || it.id)}<small>${it.kind === "scene" ? "Scene" : "Image"}</small></button>
            <button class="kb-btn is-icon is-ghost" data-up="${i}" aria-label="Move up"${i ? "" : " disabled"}>↑</button>
            <button class="kb-btn is-icon is-ghost" data-down="${i}" aria-label="Move down"${i < q.length - 1 ? "" : " disabled"}>↓</button>
            <button class="kb-btn is-icon is-ghost" data-rm="${i}" aria-label="Remove">${icon("close")}</button>
          </li>`
        )
        .join("")}</ol>`;
  };
  const save = (q) => {
    store.set("queue", q);
    setQueueCount();
    draw();
  };
  const playFrom = (i) => {
    const q = store.get("queue", []);
    if (!q[i]) return;
    store.set("queuePos", i);
    app.context = { queue: true };
    go((q[i].kind === "scene" ? "scene/" : "image/") + q[i].id);
  };

  main.addEventListener("click", (e) => {
    const q = store.get("queue", []);
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.go != null) return playFrom(Number(t.dataset.go));
    if (t.dataset.rm != null) {
      q.splice(Number(t.dataset.rm), 1);
      return save(q);
    }
    if (t.dataset.up != null || t.dataset.down != null) {
      const i = Number(t.dataset.up != null ? t.dataset.up : t.dataset.down);
      const j = t.dataset.up != null ? i - 1 : i + 1;
      [q[i], q[j]] = [q[j], q[i]];
      return save(q);
    }
    if (t.matches("[data-shuffle]")) {
      for (let i = q.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [q[i], q[j]] = [q[j], q[i]];
      }
      store.set("queuePos", 0);
      toast("Shuffled");
      return save(q);
    }
    if (t.matches("[data-clear]")) {
      store.set("queuePos", 0);
      return save([]);
    }
    if (t.matches("[data-play]")) {
      const pos = store.get("queuePos", 0);
      return playFrom(pos < q.length ? pos : 0);
    }
  });

  // Drag to reorder
  let dragI = null;
  main.addEventListener("dragstart", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) dragI = Number(li.dataset.i);
  });
  main.addEventListener("dragover", (e) => {
    if (dragI != null && e.target.closest("li[data-i]")) e.preventDefault();
  });
  main.addEventListener("drop", (e) => {
    const li = e.target.closest("li[data-i]");
    if (!li || dragI == null) return;
    e.preventDefault();
    const q = store.get("queue", []);
    const [it] = q.splice(dragI, 1);
    q.splice(Number(li.dataset.i), 0, it);
    dragI = null;
    save(q);
  });

  draw();
}
