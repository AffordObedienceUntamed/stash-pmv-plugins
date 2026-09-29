// Stash GraphQL – all queries and mutations in one place.

import { t, locale } from "./i18n.js";

export async function gql(query, variables) {
  const res = await fetch("/graphql", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(t("Stash answers with {status}", { status: res.status }));
  const json = await res.json();
  if (json.errors && json.errors.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

// ---------- Fragments ----------

export const F_SCENE = `id title details date rating100 o_counter play_count play_duration resume_time last_played_at organized created_at urls
  files { id width height duration size path basename video_codec frame_rate bit_rate }
  paths { screenshot preview webp stream sprite vtt }
  tags { id name }
  galleries { id title }`;

export const F_IMAGE = `id title details date rating100 o_counter organized created_at urls
  visual_files { __typename ... on ImageFile { id width height size path basename } ... on VideoFile { id width height size path basename duration } }
  paths { thumbnail image preview }
  tags { id name }
  galleries { id title folder { path } files { path } }`;

export const F_GALLERY = `id title details date rating100 organized created_at image_count urls
  folder { id path }
  files { path }
  paths { cover preview }
  cover { id visual_files { ... on ImageFile { width height } ... on VideoFile { width height } } }
  tags { id name }`;

export const F_TAG = `id name description favorite image_path scene_count image_count gallery_count aliases
  parents { id name } children { id name }`;

// ---------- Lists ----------

const KIND = {
  scene: { query: "findScenes", filterArg: "scene_filter", filterType: "SceneFilterType", list: "scenes", frag: F_SCENE },
  image: { query: "findImages", filterArg: "image_filter", filterType: "ImageFilterType", list: "images", frag: F_IMAGE },
  gallery: { query: "findGalleries", filterArg: "gallery_filter", filterType: "GalleryFilterType", list: "galleries", frag: F_GALLERY },
};

export async function findItems(kind, find, filter) {
  const k = KIND[kind];
  const d = await gql(
    `query($f: FindFilterType, $x: ${k.filterType}) { r: ${k.query}(filter: $f, ${k.filterArg}: $x) { count ${k.list} { ${k.frag} } } }`,
    { f: find, x: filter || {} }
  );
  return { count: d.r.count, items: d.r[k.list] };
}

export async function countItems(kind, filter) {
  const k = KIND[kind];
  const d = await gql(`query($x: ${k.filterType}) { r: ${k.query}(filter: { per_page: 0 }, ${k.filterArg}: $x) { count } }`, { x: filter || {} });
  return d.r.count;
}

export async function getScene(id) {
  const d = await gql(`query($id: ID!) { findScene(id: $id) { ${F_SCENE} sceneStreams { url mime_type label } } }`, { id });
  return d.findScene;
}
export async function getImage(id) {
  const d = await gql(`query($id: ID!) { findImage(id: $id) { ${F_IMAGE} } }`, { id });
  return d.findImage;
}
export async function getGallery(id) {
  const d = await gql(`query($id: ID!) { findGallery(id: $id) { ${F_GALLERY} } }`, { id });
  return d.findGallery;
}
export async function getTag(id) {
  const d = await gql(`query($id: ID!) { findTag(id: $id) { ${F_TAG} } }`, { id });
  return d.findTag;
}

export async function findTags(q, perPage, sort) {
  const d = await gql(
    `query($f: FindFilterType) { findTags(filter: $f) { count tags { ${F_TAG} } } }`,
    { f: { q: q || undefined, per_page: perPage || -1, sort: sort || "name", direction: sort && sort !== "name" ? "DESC" : "ASC" } }
  );
  return d.findTags;
}

export async function stats() {
  const d = await gql(`query { stats { scene_count image_count gallery_count tag_count scenes_duration scenes_size images_size total_play_count total_play_duration } }`);
  return d.stats;
}

// ---------- Folders ----------

let folderCache = null;
// All folders with their number of images/videos (including subfolders); empty ones are hidden.
// Scenes and images are counted, not files: Stash keeps folder and file entries even after
// deleting (without "delete file" the file stays, with it the folder stays) – such folders should disappear.
export function loadFolders(force) {
  if (folderCache && !force) return folderCache;
  folderCache = (async () => {
    const d = await gql(`query {
      findFolders(filter: { per_page: -1 }) { folders { id path basename parent_folder { id } } }
      findScenes(filter: { per_page: -1 }) { scenes { files { parent_folder { id } } } }
      findImages(filter: { per_page: -1 }) { images { visual_files { ... on ImageFile { parent_folder { id } } ... on VideoFile { parent_folder { id } } } } }
    }`);
    const nodes = new Map();
    for (const f of d.findFolders.folders) {
      nodes.set(f.id, { id: f.id, path: f.path, name: f.basename || f.path, parent: f.parent_folder && f.parent_folder.id, kids: [], img: 0, vid: 0 });
    }
    const count = (file, key) => {
      const n = file && file.parent_folder && nodes.get(file.parent_folder.id);
      if (n) n[key]++;
    };
    d.findScenes.scenes.forEach((x) => count(x.files[0], "vid"));
    d.findImages.images.forEach((x) => count(x.visual_files[0], "img"));
    for (const n of nodes.values()) {
      const p = n.parent && nodes.get(n.parent);
      if (p) p.kids.push(n);
    }
    const total = (n) => {
      n.timg = n.img;
      n.tvid = n.vid;
      n.kids.forEach((k) => {
        total(k);
        n.timg += k.timg;
        n.tvid += k.tvid;
      });
    };
    let roots = [...nodes.values()].filter((n) => !n.parent || !nodes.has(n.parent));
    roots.forEach(total);
    const keep = (list) => list.filter((n) => n.timg + n.tvid > 0);
    roots = keep(roots);
    // Skip empty intermediate levels like a bare drive root
    while (roots.length === 1 && !roots[0].img && !roots[0].vid && keep(roots[0].kids).length === 1) roots = keep(roots[0].kids);
    const sortRec = (n) => {
      n.kids = keep(n.kids).sort((a, b) => a.name.localeCompare(b.name, locale(), { numeric: true, sensitivity: "base" }));
      n.kids.forEach(sortRec);
    };
    roots.forEach(sortRec);
    roots.sort((a, b) => a.name.localeCompare(b.name, locale(), { numeric: true }));
    return { nodes, roots };
  })().catch((e) => {
    folderCache = null;
    throw e;
  });
  return folderCache;
}

// After deleting, scanning, cleaning …: recount folders and refresh all displays (navigation, counts)
export function libraryChanged() {
  folderCache = null;
  window.dispatchEvent(new Event("stash:library-changed"));
}

// ---------- Favorites (tag "Favorite") ----------

let favTag = null;
export async function favoriteTagId(create) {
  if (favTag) return favTag;
  const d = await gql(`query { findTags(tag_filter: { name: { value: "Favorite", modifier: EQUALS } }, filter: { per_page: 1 }) { tags { id } } }`);
  const t = d.findTags.tags[0];
  if (t) return (favTag = t.id);
  if (!create) return null;
  const c = await gql(`mutation { tagCreate(input: { name: "Favorite", description: "Favorites (the heart in Stash UI)" }) { id } }`);
  return (favTag = c.tagCreate.id);
}

export async function setFavorite(kind, ids, on) {
  const tagId = await favoriteTagId(true);
  const m = { scene: "bulkSceneUpdate", image: "bulkImageUpdate", gallery: "bulkGalleryUpdate" }[kind];
  const t = { scene: "BulkSceneUpdateInput", image: "BulkImageUpdateInput", gallery: "BulkGalleryUpdateInput" }[kind];
  await gql(`mutation($i: ${t}!) { ${m}(input: $i) { id } }`, { i: { ids, tag_ids: { ids: [tagId], mode: on ? "ADD" : "REMOVE" } } });
}

// ---------- Changes ----------

const UPDATE = {
  scene: ["sceneUpdate", "SceneUpdateInput"],
  image: ["imageUpdate", "ImageUpdateInput"],
  gallery: ["galleryUpdate", "GalleryUpdateInput"],
};
export async function updateItem(kind, input) {
  const [m, t] = UPDATE[kind];
  await gql(`mutation($i: ${t}!) { ${m}(input: $i) { id } }`, { i: input });
}

const BULK = {
  scene: ["bulkSceneUpdate", "BulkSceneUpdateInput"],
  image: ["bulkImageUpdate", "BulkImageUpdateInput"],
  gallery: ["bulkGalleryUpdate", "BulkGalleryUpdateInput"],
};
export async function bulkUpdate(kind, input) {
  const [m, t] = BULK[kind];
  await gql(`mutation($i: ${t}!) { ${m}(input: $i) { id } }`, { i: input });
}

export async function destroyItems(kind, ids, deleteFile) {
  const map = {
    scene: ["scenesDestroy", "ScenesDestroyInput"],
    image: ["imagesDestroy", "ImagesDestroyInput"],
    gallery: ["galleryDestroy", "GalleryDestroyInput"],
  };
  const [m, t] = map[kind];
  await gql(`mutation($i: ${t}!) { ${m}(input: $i) }`, { i: { ids, delete_file: !!deleteFile, delete_generated: true } });
  libraryChanged();
}

export async function createTag(name) {
  const d = await gql(`mutation($n: String!) { tagCreate(input: { name: $n }) { id name } }`, { n: name });
  return d.tagCreate;
}

export async function addO(kind, id) {
  if (kind === "scene") {
    const d = await gql(`mutation($id: ID!) { sceneAddO(id: $id) { count } }`, { id });
    return d.sceneAddO.count;
  }
  const d = await gql(`mutation($id: ID!) { imageIncrementO(id: $id) }`, { id });
  return d.imageIncrementO;
}
export async function removeO(kind, id) {
  if (kind === "scene") {
    const d = await gql(`mutation($id: ID!) { sceneDeleteO(id: $id) { count } }`, { id });
    return d.sceneDeleteO.count;
  }
  const d = await gql(`mutation($id: ID!) { imageDecrementO(id: $id) }`, { id });
  return d.imageDecrementO;
}

export async function saveActivity(id, resumeTime, playDuration) {
  await gql(`mutation($id: ID!, $r: Float, $p: Float) { sceneSaveActivity(id: $id, resume_time: $r, playDuration: $p) }`, { id, r: resumeTime, p: playDuration });
}
export async function addPlay(id) {
  await gql(`mutation($id: ID!) { sceneAddPlay(id: $id) { count } }`, { id });
}
