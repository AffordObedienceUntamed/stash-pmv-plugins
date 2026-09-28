// Scenes, images or galleries – the whole library of one kind.

import { esc } from "../ui.js";
import { mediaBrowser, KIND_NAME } from "./media.js";

const INTRO = {
  scene: "All videos in the library.",
  image: "All images and clips in the library.",
  gallery: "All galleries – folders and archives full of images.",
};

export function render(main, params, query) {
  const kind = params.kind;
  main.innerHTML = `
    <header class="kb-head">
      <div class="kb-head-title">
        <h1 class="kb-h1">${KIND_NAME[kind][1]}</h1>
        <p class="kb-sub" data-count>${esc(INTRO[kind])}</p>
      </div>
    </header>
    <section data-browser></section>`;
  const b = mediaBrowser(main.querySelector("[data-browser]"), { kinds: [kind], query });
  return () => b.destroy();
}
