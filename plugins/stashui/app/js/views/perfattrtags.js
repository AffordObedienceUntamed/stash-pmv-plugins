// "Attributes as tags": what the performers say about themselves (eye color, hair color, ethnicity …) written as tags – “Blue Eyes”,
// “Blonde Hair” … – so one search in the tag fields finds them, the tag pages count them and every filter that knows tags works.
// The tags are made when they don't exist; performers that have the tag keep it, nothing is taken away.

import { esc, openDrawer, errorToast, toast, fmtNum } from "../ui.js";
import { t } from "../i18n.js";
import { gql, createTag, lookTokens } from "../api.js";
import { tagsCache } from "./tagpicker.js";

const FIELDS = [
  ["eye_color", "Eye color", "{v} Eyes"],
  ["hair_color", "Hair color", "{v} Hair"],
  ["ethnicity", "Ethnicity", "{v}"],
];

export async function openAttrTags({ onDone } = {}) {
  const d = openDrawer({
    title: t("Attributes as tags"),
    body: `<p class="kb-hint">${t("Writes what the performers say about themselves as tags – e.g. “Blue Eyes”. Missing tags are made; nothing is taken away from anyone.")}</p><div data-body><p class="kb-hint">${t("Loading …")}</p></div>`,
    foot: `<span class="kb-spacer"></span><button class="kb-btn" data-cancel>${t("Close")}</button><button class="kb-btn is-primary" data-go disabled>${t("Add the tags")}</button>`,
  });
  const el = d.el;
  const body = el.querySelector("[data-body]");
  el.querySelector("[data-cancel]").onclick = d.close;
  const go = el.querySelector("[data-go]");

  let people;
  let tags;
  try {
    [people, tags] = await Promise.all([
      gql(`query AttrTagPeople { findPerformers(filter: { per_page: -1 }) { performers { id eye_color hair_color ethnicity tags { id } } } }`, {}, { heavy: true }).then((r) => r.findPerformers.performers),
      tagsCache(true),
    ]);
  } catch (e) {
    body.innerHTML = `<p class="kb-hint kb-pe-err">${esc(e.message)}</p>`;
    return;
  }
  const opt = { eye_color: true, hair_color: true, ethnicity: false };
  const pat = { eye_color: FIELDS[0][2], hair_color: FIELDS[1][2], ethnicity: FIELDS[2][2] };
  const nameOf = (f, v) => pat[f].replace("{v}", v).trim();
  const byName = new Map(tags.map((x) => [x.name.toLowerCase(), x]));
  const alias = new Map();
  tags.forEach((x) => (x.aliases || []).forEach((a) => alias.set(a.toLowerCase(), x)));

  // field → value → [performer ids]
  const plan = () => {
    const out = [];
    for (const [f] of FIELDS) {
      if (!opt[f]) continue;
      const m = new Map();
      for (const p of people) for (const v of lookTokens(f, p[f])) (m.get(v) || m.set(v, []).get(v)).push(p);
      for (const [v, list] of [...m].sort((a, b) => b[1].length - a[1].length)) {
        const name = nameOf(f, v);
        const tag = byName.get(name.toLowerCase()) || alias.get(name.toLowerCase()) || null;
        const need = tag ? list.filter((p) => !(p.tags || []).some((x) => x.id === tag.id)) : list;
        out.push({ f, v, name, tag, list, need });
      }
    }
    return out;
  };
  let rows = [];
  const paint = () => {
    rows = plan();
    const todo = rows.filter((r) => r.need.length);
    body.innerHTML = `${FIELDS.map(
      ([f, label]) => `<div class="kb-form-row"><label class="kb-chk"><input type="checkbox" data-f="${f}"${opt[f] ? " checked" : ""}> ${t(label)}</label>
        <input class="kb-field" type="text" data-pat="${f}" value="${esc(pat[f])}" aria-label="${esc(t("Tag name"))}" title="${esc(t("The tag's name; {v} is the value"))}"></div>`,
    ).join("")}
      <div class="kb-attr-list">${
        todo
          .slice(0, 200)
          .map((r) => `<div class="kb-attr-row"><b>${esc(r.name)}</b><small>${r.tag ? t("tag exists") : t("new tag")}</small><span>${t("{n} performers", { n: fmtNum(r.need.length) })}</span></div>`)
          .join("") || `<p class="kb-hint">${t("Nothing to add – every performer has the tags already.")}</p>`
      }</div>`;
    go.disabled = !todo.length;
    go.textContent = todo.length ? t("Add {n} tags", { n: todo.length }) : t("Add the tags");
  };
  body.addEventListener("change", (e) => {
    const c = e.target.closest("[data-f]");
    if (c) opt[c.dataset.f] = c.checked;
    const p = e.target.closest("[data-pat]");
    if (p) pat[p.dataset.pat] = p.value.trim() || "{v}";
    paint();
  });
  paint();

  go.onclick = async () => {
    go.disabled = true;
    go.textContent = t("Working …");
    try {
      for (const r of rows.filter((x) => x.need.length)) {
        const tag = r.tag || (await createTag(r.name));
        const ids = r.need.map((p) => p.id);
        try {
          await gql(`mutation($i: BulkPerformerUpdateInput!) { bulkPerformerUpdate(input: $i) { id } }`, { i: { ids, tag_ids: { ids: [tag.id], mode: "ADD" } } });
        } catch (e) {
          // a Stash without the bulk update: one performer after the other
          for (const p of r.need) {
            const have = (p.tags || []).map((x) => x.id);
            await gql(`mutation($i: PerformerUpdateInput!) { performerUpdate(input: $i) { id } }`, { i: { id: p.id, tag_ids: [...have, tag.id] } });
          }
        }
        r.need.forEach((p) => (p.tags = (p.tags || []).concat([{ id: tag.id }])));
        byName.set(r.name.toLowerCase(), tag);
      }
      tagsCache(true);
      toast(t("Tags added"), "ok");
      onDone && onDone();
      paint();
    } catch (e) {
      errorToast(e, "Attributes as tags");
      paint();
    }
  };
}
