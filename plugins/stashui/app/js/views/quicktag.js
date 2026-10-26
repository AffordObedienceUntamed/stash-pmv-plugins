// T on a card: a small tag box right at the card – the tags it has (× takes one away) and a field to add more; every change is applied at once.
// Esc, a click outside or Enter in the empty field closes it. (The bigger "Edit" form with performers, studio and rating is still the E key.)

import { esc, errorToast, toast } from "../ui.js";
import { t } from "../i18n.js";
import { bulkUpdate } from "../api.js";
import { tagPicker } from "./tagpicker.js";

let open = null;

export function closeHoverTagBox() {
  if (open) open();
}

export function openHoverTagBox(kind, piece, anchor, onSaved) {
  closeHoverTagBox();
  let tags = (piece.tags || []).map((x) => ({ id: x.id, name: x.name }));
  let changed = false;
  const box = document.createElement("div");
  box.className = "kb-qtag";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", t("Tags"));
  box.innerHTML = `<div class="kb-qtag-head"><b>${esc(piece.title || piece.id)}</b><button type="button" class="kb-btn is-icon is-ghost" data-x aria-label="${t("Close")}">×</button></div>
    <div class="kb-chips" data-have></div>
    <div class="kb-tagpick" data-add></div>
    <small class="kb-hint">${t("Enter adds the highlighted tag · Esc closes")}</small>`;
  document.body.appendChild(box);

  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = Math.min(360, innerWidth - 16);
    box.style.width = w + "px";
    let left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
    const h = box.offsetHeight;
    let top = r.bottom + 8;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 8);
    box.style.left = left + "px";
    box.style.top = top + "px";
  };
  const paintHave = () => {
    const el = box.querySelector("[data-have]");
    el.innerHTML = tags.map((x) => `<span class="kb-chip is-on" data-id="${esc(x.id)}">${esc(x.name)}<button type="button" data-rm="${esc(x.id)}" aria-label="${t("Remove")}">×</button></span>`).join("");
    el.hidden = !tags.length;
    place();
  };
  const apply = async (ids, mode) => {
    try {
      await bulkUpdate(kind, { ids: [piece.id], tag_ids: { ids, mode } });
      changed = true;
    } catch (e) {
      errorToast(e, "Tags");
      return false;
    }
    return true;
  };

  const picker = tagPicker(box.querySelector("[data-add]"), {
    allowCreate: true,
    placeholder: t("Search or create a tag"),
    onChange: async () => {
      const fresh = picker.picked.filter((x) => !tags.some((y) => y.id === x.id));
      picker.set([]);
      if (!fresh.length) return;
      if (await apply(fresh.map((x) => x.id), "ADD")) {
        tags = tags.concat(fresh);
        piece.tags = tags.map((x) => ({ id: x.id, name: x.name }));
        paintHave();
        box.querySelector("input").focus();
      }
    },
  });

  box.querySelector("[data-have]").addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-rm]");
    if (!rm) return;
    if (await apply([rm.dataset.rm], "REMOVE")) {
      tags = tags.filter((x) => x.id !== rm.dataset.rm);
      piece.tags = tags.map((x) => ({ id: x.id, name: x.name }));
      paintHave();
    }
  });
  const close = () => {
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    removeEventListener("hashchange", close);
    box.remove();
    open = null;
    if (changed) {
      toast(t("Tags saved"), "ok");
      onSaved && onSaved();
    }
  };
  const onDown = (e) => !box.contains(e.target) && !(e.target.closest && e.target.closest(".kb-drawer, .kb-dialog")) && close(); // (the tag tree of its field is a drawer)
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Enter" && e.target.matches && e.target.matches("input") && !e.target.value.trim() && !box.querySelector(".kb-sugg:not([hidden]) .is-active")) {
      e.preventDefault();
      close();
    }
  };
  box.querySelector("[data-x]").onclick = close;
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  addEventListener("hashchange", close);
  open = close;
  paintHave();
  box.querySelector("input").focus();
}
