// The Discover overview: the page of the plugin stashDiscover by ufousox007 (https://github.com/k6cc/stash-jav-tools), used with the
// author's permission. The code lives in js/vendor/stashdiscover/ (his files, with the changes listed at their tops); this file only
// connects it to Stash UI: the language, the plugin backend (stash-box questions with the API key Stash has for the box, Jackett,
// qBittorrent), the plugin settings, the stylesheet, and the pictures of the stash-box (Stash's page policy blocks foreign pictures,
// so they are fetched by the backend – like the covers of the search).

import { runBackend } from "../interactive.js";
import { setPluginConfig } from "../api.js";
import { lang } from "../i18n.js";
import { lazyCovers } from "./perfstats.js";

let cssDone = false;
function stylesheet() {
  if (cssDone) return;
  cssDone = true;
  const own = document.querySelector('link[rel="stylesheet"][href*="app.css"]');
  const v = own ? new URL(own.href).search : "";
  for (const f of ["stashdiscover.css", "stashui-compat.css"]) { // his stylesheet, then the Stash classes he leaves to Stash's own
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "js/vendor/stashdiscover/" + f + v;
    document.head.appendChild(link);
  }
}

const domain = (host) => String(host || "").split(".").slice(-2).join(".");

export async function mountOverview(host) {
  window.__ssdLocale = lang;
  window.__ssdBackend = (args) => runBackend(args);
  window.__ssdSaveConfig = (key, value) => setPluginConfig("stashui", { [key]: value });
  stylesheet();
  await import("../vendor/stashdiscover/ssd.js");
  await import("../vendor/stashdiscover/discover.js");
  const SSD = window.SSD;
  const root = document.createElement("div");
  root.className = "ssd-dp-page";
  host.appendChild(root);
  let boxes = [];
  SSD.getStashBoxes().then((b) => (boxes = b)).catch(() => {});

  // pictures of the stash-box: not loaded by the page (blocked) but handed over by the backend
  const fetchCover = (img) => {
    const url = img.getAttribute("src") || "";
    if (!/^https?:\/\//i.test(url) || img.dataset.ssdPic) return;
    let h = "";
    try {
      const u = new URL(url);
      if (u.origin === location.origin) return;
      h = u.hostname;
    } catch (e) {
      return;
    }
    const box = boxes.find((b) => {
      try {
        return domain(new URL(b.endpoint).hostname) === domain(h);
      } catch (e) {
        return false;
      }
    });
    if (!box) return;
    img.dataset.ssdPic = "1";
    img.removeAttribute("src");
    img.dataset.cover = url;
    lazyCovers(img.parentElement, box.endpoint, null);
    // his onerror hides the picture when the page can't load it – it is on its way through the backend instead
    img.style.visibility = "";
  };
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (node.tagName === "IMG") fetchCover(node);
    else node.querySelectorAll && node.querySelectorAll("img[src]").forEach(fetchCover);
  };
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") scan(m.target);
      else m.addedNodes.forEach(scan);
    }
  });
  mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  // pictures in the scene window (it sits on the body, not in the page)
  const mo2 = new MutationObserver((list) => {
    for (const m of list) m.addedNodes.forEach((n) => n.nodeType === 1 && (n.matches(".ssd-modal-overlay") || n.querySelector(".ssd-modal-overlay")) && (scan(n), mo.observe(n, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] })));
  });
  mo2.observe(document.body, { childList: true });

  const off = SSD.discoverMount(root);
  return () => {
    mo.disconnect();
    mo2.disconnect();
    try {
      off && off();
    } catch (e) {
      /* the page is gone anyway */
    }
    document.querySelectorAll(".ssd-modal-overlay, .ssd-performer-card, .hover-popover-content").forEach((n) => n.remove());
    root.remove();
  };
}
