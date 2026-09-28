// Watches Stash's job queue: counter in the navigation, message when done.

import { gql, libraryChanged } from "./api.js";
import { toast } from "./ui.js";
import { setJobCount } from "./main.js";

const listeners = new Set();
let last = new Map();
export let jobs = [];

export function onJobs(fn) {
  listeners.add(fn);
  fn(jobs);
  return () => listeners.delete(fn);
}

async function poll() {
  let next = 5000;
  try {
    const d = await gql(`query { jobQueue { id status description subTasks progress startTime endTime addTime error } }`);
    jobs = d.jobQueue || [];
    const now = new Map(jobs.map((j) => [j.id, j]));
    // Jobs that disappeared are finished
    let finished = false;
    last.forEach((j, id) => {
      if (!now.has(id)) {
        toast(`Done: ${j.description}`, "ok");
        finished = true;
      }
    });
    // Scan, clean etc. may have changed folders and items
    if (finished) libraryChanged();
    jobs.forEach((j) => {
      if (j.status === "FAILED" && (!last.get(j.id) || last.get(j.id).status !== "FAILED")) toast(`Failed: ${j.description}${j.error ? " – " + j.error : ""}`, "error");
    });
    last = now;
    setJobCount(jobs.filter((j) => j.status === "RUNNING" || j.status === "READY").length);
    listeners.forEach((fn) => fn(jobs));
    if (jobs.length) next = 1000;
  } catch (e) { /* Stash briefly unreachable */ }
  schedule(document.hidden ? Math.max(next, 5000) : next);
}

let timer;
function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(poll, ms);
}

export function watchJobs() {
  poll();
}

export function pokeJobs() {
  schedule(300);
}
