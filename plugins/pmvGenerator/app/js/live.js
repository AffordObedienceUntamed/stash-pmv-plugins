// Live music: the generator listens to one app on this PC (Spotify or any other) and finds the beats
// while the music plays. The sound comes from the plugin's small helper (applisten.cs – Windows'
// process loopback: only that app, games and the rest stay out) as a stream of raw 16-bit mono audio.
//
// Beat tracking, the same ideas as beats.js but running along:
// 1. Onset curve every 512 samples: energy rises in the bass (kick drum) and in the whole signal.
// 2. Tempo every ~¼ s: autocorrelation of the last 8 s, weighted around 120 BPM and towards the tempo
//    found so far (so it doesn't jump between half and double).
// 3. Phase: the beat grid that fits the onsets of the last 4 s best.
// 4. Beats are announced about one beat ahead and nudged towards the grid – the generator gets them
//    in time and cuts right on the beat. Energy per beat (0–1) is measured when the beat has sounded.
//
// The song object looks like analyzeSong()'s (name, bpm, beats, energy) – the arrays just keep growing.

import { gql } from "./api.js";

const SR = 48000;
const HOP = 512;
const FPS = SR / HOP;
const KEEP = Math.round(FPS * 12); // onset history
const TEMPO_WIN = Math.round(FPS * 8);
const PHASE_WIN = Math.round(FPS * 4);
const MIN_DATA = Math.round(FPS * 3); // before that: still listening
const SILENT_RMS = 0.004;

// The helper, via the plugin backend → { port, token, app }
export async function liveConnect(app, plugin = "pmvGenerator") {
  const d = await gql(`mutation($p: ID!, $a: Map) { runPluginOperation(plugin_id: $p, args: $a) }`, { p: plugin, a: { mode: "live_start", app } });
  const out = d.runPluginOperation;
  if (!out) throw new Error("No answer from the PMV Generator backend – is Python in the PATH?");
  if (out.error) throw new Error(out.error);
  return out.output || out;
}

// Spotify's window title is "Artist - Song" while it plays, "Spotify Premium" etc. when paused
export const songTitle = (st) => {
  const t = (st && st.title) || "";
  return / - /.test(t) && !/^spotify( premium| free)?$/i.test(t) ? t.replace(" - ", " – ") : "";
};

export async function liveStatus(conn) {
  const r = await fetch(`http://127.0.0.1:${conn.port}/status?t=${conn.token}`, { cache: "no-store" }).catch(() => null);
  if (!r) throw new Error("The listening helper can't be reached – the browser has to run on the Stash computer");
  if (!r.ok) throw new Error(`Listening helper: HTTP ${r.status}`);
  return r.json();
}

export class LiveAudio {
  constructor(conn) {
    this.conn = conn;
    this.app = conn.app || "Spotify";
    this.song = { name: this.app, bpm: 0, beats: [], energy: [], duration: Infinity, live: true, beatLen: 0.5, peaks: new Float32Array(0) };
    this.samples = 0; // audio received (samples)
    this.offset = null; // clock: performance time (s) − audio time, lower envelope
    this.lastArrive = 0;
    // filters and frames
    this.lp = { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0 };
    this.makeLowpass(160);
    this.acc = 0;
    this.accLow = 0;
    this.accN = 0;
    this.frame = 0; // frames done
    this.prevLow = 1e-6;
    this.prevAll = 1e-6;
    this.raw = []; // raw onsets (moving average window)
    this.rawSum = 0;
    this.var = 1;
    this.ons = []; // normalized onsets of the last KEEP frames
    this.rms = []; // loudness per frame, same window
    this.first = 0; // frame index of ons[0]
    this.period = null; // frames per beat
    this.phaseFrame = null; // a grid beat (frame index)
    this.next = null; // next beat to announce (s)
    this.sinceTrack = 0; // frames since the tracking started (after a reset)
    this.beatRms = []; // loudness of past beats (for 0–1)
    this.pending = []; // announced beats whose energy isn't measured yet: { k, t }
    this.silent = true;
    this.title = "";
  }

  makeLowpass(f) {
    const w = (2 * Math.PI * f) / SR;
    const q = Math.SQRT1_2;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    Object.assign(this.lp, { b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 });
  }

  // ---------- Stream ----------

  async start() {
    this.ctl = new AbortController();
    const r = await fetch(`http://127.0.0.1:${this.conn.port}/pcm?t=${this.conn.token}`, { signal: this.ctl.signal, cache: "no-store" }).catch(() => null);
    if (!r || !r.ok || !r.body) throw new Error("The listening helper can't be reached – the browser has to run on the Stash computer");
    this.reader = r.body.getReader();
    this.pump();
    this.pollStatus();
  }

  async pump() {
    let rest = null;
    try {
      for (;;) {
        const { done, value } = await this.reader.read();
        if (done) break;
        let bytes = value;
        if (rest) {
          bytes = new Uint8Array(rest.length + value.length);
          bytes.set(rest);
          bytes.set(value, rest.length);
          rest = null;
        }
        const n = bytes.length >> 1;
        if (bytes.length & 1) rest = bytes.slice(bytes.length - 1);
        const pcm = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + n * 2));
        this.feed(pcm);
      }
    } catch (e) {
      if (e.name !== "AbortError") this.error = e.message;
    }
    this.ended = true;
  }

  async pollStatus() {
    while (!this.stopped) {
      try {
        const st = await liveStatus(this.conn);
        this.running = st.running;
        const t = songTitle(st);
        if (t && t !== this.title) {
          const change = !!this.title;
          this.title = t;
          this.song.name = t;
          if (change) this.reset(); // another song: find its tempo afresh
        }
      } catch (e) { /* helper gone – the stream ends too */ }
      await new Promise((res) => setTimeout(res, 1000));
    }
  }

  stop() {
    this.stopped = true;
    if (this.ctl) this.ctl.abort();
  }

  // Audio time (s) as it plays now: the stream's time, carried on between chunks (at most 0.15 s)
  pos() {
    if (this.offset == null) return 0;
    const audio = this.samples / SR;
    return Math.min(audio + 0.15, performance.now() / 1000 - this.offset);
  }

  // ---------- Analysis ----------

  feed(pcm) {
    const now = performance.now() / 1000;
    this.samples += pcm.length;
    const off = now - this.samples / SR;
    // The earliest arrival is the truth (network hiccups only make it later); after a gap start over
    if (this.offset == null || off < this.offset || off - this.offset > 0.5) this.offset = off;
    else this.offset += 0.0002; // follows slowly if the stream really runs later
    this.lastArrive = now;
    const lp = this.lp;
    for (let i = 0; i < pcm.length; i++) {
      const x = pcm[i] / 32768;
      const y = lp.b0 * x + lp.b1 * lp.x1 + lp.b2 * lp.x2 - lp.a1 * lp.y1 - lp.a2 * lp.y2;
      lp.x2 = lp.x1;
      lp.x1 = x;
      lp.y2 = lp.y1;
      lp.y1 = y;
      this.acc += x * x;
      this.accLow += y * y;
      if (++this.accN === HOP) {
        this.onFrame(this.accLow, this.acc);
        this.acc = this.accLow = this.accN = 0;
      }
    }
  }

  onFrame(eLow, eAll) {
    const f = this.frame++;
    const dl = Math.log(eLow + 1e-6) - Math.log(this.prevLow + 1e-6);
    const da = Math.log(eAll + 1e-6) - Math.log(this.prevAll + 1e-6);
    this.prevLow = eLow;
    this.prevAll = eAll;
    const raw = 0.65 * Math.max(0, dl) + 0.35 * Math.max(0, da);
    // minus the moving average of 0.4 s (only real peaks count), normalized by a running spread
    const w = Math.round(FPS * 0.4);
    this.raw.push(raw);
    this.rawSum += raw;
    if (this.raw.length > w) this.rawSum -= this.raw.shift();
    const o = Math.max(0, raw - this.rawSum / this.raw.length);
    this.var = 0.998 * this.var + 0.002 * o * o;
    const rms = Math.sqrt(eAll / HOP);
    this.ons.push(o / (Math.sqrt(this.var) || 1));
    this.rms.push(rms);
    if (this.ons.length > KEEP) {
      this.ons.shift();
      this.rms.shift();
      this.first++;
    }
    // Silence (paused): no beats; the tracking starts over when the music is back
    const quiet = this.rmsOver(Math.round(FPS * 0.6)) < SILENT_RMS;
    if (quiet !== this.silent) {
      this.silent = quiet;
      if (quiet) this.reset(true);
    }
    if (quiet) return;
    this.sinceTrack++;
    this.measure();
    if (this.sinceTrack >= MIN_DATA && this.sinceTrack % 24 === 0) this.estimate();
    this.announce();
  }

  rmsOver(n) {
    const a = this.rms;
    let s = 0;
    const from = Math.max(0, a.length - n);
    for (let i = from; i < a.length; i++) s += a[i] * a[i];
    return Math.sqrt(s / Math.max(1, a.length - from));
  }

  // After a pause or with another song: listen afresh (the old tempo only as a hint)
  reset(keepTempo) {
    this.sinceTrack = 0;
    this.next = null;
    this.phaseFrame = null;
    if (!keepTempo) this.period = null;
    const keep = Math.round(FPS * 0.2);
    this.first += Math.max(0, this.ons.length - keep);
    this.ons = this.ons.slice(-keep);
    this.rms = this.rms.slice(-keep);
  }

  onset(f) {
    const i = f - this.first;
    return i >= 0 && i < this.ons.length ? this.ons[i] : 0;
  }

  estimate() {
    const n = Math.min(this.ons.length, TEMPO_WIN, this.sinceTrack);
    const o = this.ons.slice(-n);
    const ac = (lag) => {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += o[i] * o[i + lag];
      return s / Math.max(1, n - lag);
    };
    const lagMin = Math.floor((60 * FPS) / 200);
    const lagMax = Math.ceil((60 * FPS) / 60);
    const prev = this.period;
    const score = (l) => {
      const bpm = (60 * FPS) / l;
      let w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
      if (prev) w *= 1 + 1.5 * Math.exp(-0.5 * ((l - prev) / (0.04 * prev)) ** 2);
      return w * (ac(l) + 0.5 * ac(2 * l));
    };
    const s = {};
    let best = lagMin;
    for (let l = lagMin - 1; l <= lagMax + 1; l++) s[l] = score(l);
    for (let l = lagMin; l <= lagMax; l++) if (s[l] > s[best]) best = l;
    const a = s[best - 1];
    const b = s[best];
    const c = s[best + 1];
    const d = a - 2 * b + c;
    let period = best + (d < 0 ? (0.5 * (a - c)) / d : 0);
    if (prev && Math.abs(period - prev) / prev < 0.08) period = prev + 0.3 * (period - prev); // smooth small changes
    this.period = period;
    this.song.bpm = (60 * FPS) / period;
    this.song.beatLen = period / FPS;
    // Phase: the grid that hits the most onsets in the last 4 s (recent beats count more)
    const end = this.frame - 1;
    const kMax = Math.floor(Math.min(PHASE_WIN, this.sinceTrack) / period);
    let bestPh = 0;
    let bestS = -1;
    for (let ph = 0; ph < period; ph += 0.5) {
      let sc = 0;
      for (let k = 0; k <= kMax; k++) {
        const f = end - ph - k * period;
        const i = Math.round(f);
        sc += Math.pow(0.9, k) * Math.max(this.onset(i - 1) * 0.5, this.onset(i), this.onset(i + 1) * 0.5);
      }
      if (sc > bestS) {
        bestS = sc;
        bestPh = ph;
      }
    }
    this.phaseFrame = end - bestPh;
  }

  // Announce beats about one beat ahead, nudged towards the grid
  announce() {
    if (this.phaseFrame == null) return;
    const P = this.period / FPS;
    const now = this.frame / FPS;
    const grid = (t) => {
      const g0 = this.phaseFrame / FPS;
      return g0 + Math.round((t - g0) / P) * P;
    };
    const beats = this.song.beats;
    const last = beats.length ? beats[beats.length - 1] : -Infinity;
    if (this.next == null) {
      this.next = grid(now + P * 0.5);
      while (this.next <= now + 0.02) this.next += P;
    } else {
      const g = grid(this.next);
      const err = g - this.next;
      this.next += Math.max(-0.12 * P, Math.min(0.12 * P, err)) * 0.6;
    }
    if (this.next < last + 0.5 * P) this.next = last + P;
    while (this.next < now + P + 0.12) {
      beats.push(this.next);
      const k = beats.length - 1;
      this.song.energy.push(this.song.energy[k - 1] || 0.5); // until it's measured
      this.pending.push({ k, t: this.next });
      this.next += P;
    }
  }

  // Energy of a beat once it has sounded: loudness of the beat before it, 0–1 against the last minute
  measure() {
    const now = this.frame / FPS;
    while (this.pending.length && this.pending[0].t <= now) {
      const { k, t } = this.pending.shift();
      const len = this.song.beatLen;
      const a = Math.round((t - len) * FPS);
      const b = Math.round(t * FPS);
      let s = 0;
      let c = 0;
      for (let f = a; f < b; f++) {
        const i = f - this.first;
        if (i >= 0 && i < this.rms.length) (s += this.rms[i] ** 2), c++;
      }
      const r = Math.sqrt(s / Math.max(1, c));
      this.beatRms.push(r);
      if (this.beatRms.length > 150) this.beatRms.shift();
      const sorted = this.beatRms.slice().sort((x, y) => x - y);
      const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] || 0;
      const lo = sorted.length >= 8 ? q(0.1) : 0;
      const span = (sorted.length >= 8 ? q(0.95) : sorted[sorted.length - 1]) - lo || 1;
      const e = Math.min(1, Math.max(0, (r - lo) / span));
      const en = this.song.energy;
      const prev = [en[k - 1], en[k - 2]].filter((x) => x != null);
      en[k] = (e + prev.reduce((x, y) => x + y, 0)) / (1 + prev.length); // smooth over the last beats
    }
  }
}
