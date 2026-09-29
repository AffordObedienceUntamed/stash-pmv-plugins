"""PMV Generator – a small backend for things the browser can't do on its own.

Called through Stash's `runPluginOperation` (interface: raw):

* mode "save_chunk": write a PMV Generator recording into the library piece by piece.
      args:   {"mode": "save_chunk", "name": "PMV – Song", "upload": "<id>", "index": 0,
               "data": "<base64>", "last": false}
      output: {"received": <bytes>}                    while more parts are coming
              {"path": "...", "dir": "...", "fixed": bool}   after the last part
  The target is always the folder "PMV Generator" in the first video library. Browser recordings
  (MediaRecorder) carry no duration; if ffmpeg can be found, the file is remuxed without
  re-encoding so Stash gets duration, previews and seeking right.

* mode "extract_audio": cut the sound out of a scene with ffmpeg (optionally only a part of it).
      args:   {"mode": "extract_audio", "scene_id": "12", "start": 0, "end": 0, "save": false}
      output: {"id": "<id>", "size": <bytes>, "name": "...", "saved": "<path or null>"}
  AAC in an .m4a – every browser can decode that. With "save", a copy goes into
  "PMV Generator/Songs" in the library. The file itself is fetched with "audio_chunk".

* mode "audio_chunk": one piece of an extracted sound file, as base64.
      args:   {"mode": "audio_chunk", "id": "<id>", "offset": 0}
      output: {"data": "<base64>", "size": <bytes>, "last": bool}   the last piece removes the file

* modes "rg_api" and "rg_download": RedGifs clips in the show – the API detour for pages not
  opened via localhost and saving clips into the library. The code lives in rgbackend.py
  (shared with Media Storm, copied by tools/build.py).
"""

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

FOLDER = "PMV Generator"
INVALID = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
UPLOAD_ID = re.compile(r"^[a-z0-9]{6,40}$")
AUDIO_CHUNK = 3 * 1024 * 1024


def log(msg):
    print(f"\x01i\x02[PMV Generator] {msg}", file=sys.stderr, flush=True)


class Stash:
    def __init__(self, conn):
        conn = {str(k).lower(): v for k, v in (conn or {}).items()}
        host = str(conn.get("host") or "localhost")
        if host in ("0.0.0.0", ""):
            host = "127.0.0.1"
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        self.url = f"{str(conn.get('scheme') or 'http').lower()}://{host}:{int(conn.get('port') or 9999)}/graphql"
        self.headers = {"Content-Type": "application/json"}
        if conn.get("apikey"):
            self.headers["ApiKey"] = str(conn["apikey"])
        cookie = conn.get("sessioncookie")
        if isinstance(cookie, dict):
            cookie = {str(k).lower(): v for k, v in cookie.items()}
            if cookie.get("value"):
                self.headers["Cookie"] = f"{cookie.get('name') or 'session'}={cookie['value']}"
        self.dir = conn.get("dir") or ""

    def gql(self, query):
        req = urllib.request.Request(self.url, json.dumps({"query": query}).encode(), self.headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as res:
            d = json.load(res)
        if d.get("errors"):
            raise RuntimeError("Stash: " + "; ".join(e.get("message", "") for e in d["errors"]))
        return d["data"]

    def target_dir(self):
        stashes = self.gql("query { configuration { general { stashes { path excludeVideo } } } }")["configuration"]["general"]["stashes"] or []
        lib = next((s for s in stashes if not s.get("excludeVideo")), None)
        if not lib:
            raise RuntimeError("No Stash library for videos is set up")
        return os.path.join(lib["path"].rstrip("\\/"), FOLDER)

    def ffmpeg(self):
        """Prefer Stash's own ffmpeg, otherwise the one from the PATH."""
        try:
            p = self.gql("query { configuration { general { ffmpegPath } } }")["configuration"]["general"].get("ffmpegPath")
            if p and os.path.isfile(p):
                return p
        except Exception:
            pass  # older Stash versions don't know the field
        found = shutil.which("ffmpeg")
        if found:
            return found
        for base in filter(None, [self.dir, os.path.join(os.path.expanduser("~"), ".stash")]):
            for name in ("ffmpeg.exe", "ffmpeg"):
                p = os.path.join(base, name)
                if os.path.isfile(p):
                    return p
        return None


def safe_name(name):
    name = INVALID.sub("_", str(name or "")).strip().rstrip(". ")
    name = re.sub(r"\s+", " ", name)[:100].strip()
    return name or "PMV"


def save_chunk(stash, args):
    upload = str(args.get("upload") or "")
    if not UPLOAD_ID.match(upload):
        raise ValueError("invalid upload id")
    index = int(args.get("index") or 0)
    folder = stash.target_dir()
    os.makedirs(folder, exist_ok=True)
    part = os.path.join(folder, f".upload-{upload}.part")
    data = base64.b64decode(str(args.get("data") or ""), validate=True)
    if index == 0:
        with open(part, "wb") as f:
            f.write(data)
    else:
        if not os.path.exists(part):
            raise ValueError("start of upload missing")
        with open(part, "ab") as f:
            f.write(data)
    if not args.get("last"):
        return {"received": os.path.getsize(part)}

    base = safe_name(args.get("name"))
    path = os.path.join(folder, base + ".webm")
    n = 2
    while os.path.exists(path):
        path = os.path.join(folder, f"{base} ({n}).webm")
        n += 1

    fixed = False
    ff = stash.ffmpeg()
    if ff:
        # Remux without re-encoding: writes duration and seek points
        tmp = path + ".tmp.webm"
        try:
            subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-y", "-i", part, "-c", "copy", tmp],
                           check=True, timeout=600, stdin=subprocess.DEVNULL, capture_output=True)
            os.replace(tmp, path)
            os.remove(part)
            fixed = True
        except (subprocess.SubprocessError, OSError) as e:
            log(f"ffmpeg remux failed, saving unchanged: {e}")
            if os.path.exists(tmp):
                os.remove(tmp)
    if not fixed:
        os.replace(part, path)
    log(f"PMV saved: {path}")
    return {"path": path, "dir": folder, "fixed": fixed}


def audio_tmp(aid):
    return os.path.join(tempfile.gettempdir(), f"pmvgen-audio-{aid}.m4a")


def extract_audio(stash, args):
    ff = stash.ffmpeg()
    if not ff:
        raise RuntimeError("ffmpeg not found – Stash normally brings its own (Settings → System → ffmpeg)")
    sid = str(args.get("scene_id") or "")
    if not sid.isdigit():
        raise ValueError("invalid scene id")
    scene = stash.gql('query { findScene(id: "%s") { title files { path basename duration } } }' % sid)["findScene"]
    if not scene or not scene["files"]:
        raise RuntimeError("Scene or file not found")
    f = scene["files"][0]
    start = max(0.0, float(args.get("start") or 0))
    end = float(args.get("end") or 0)
    if end and end <= start:
        raise ValueError("the end is before the start")
    # Old leftovers (a closed tab never fetched its file)
    for old in os.listdir(tempfile.gettempdir()):
        if old.startswith("pmvgen-audio-"):
            p = os.path.join(tempfile.gettempdir(), old)
            try:
                if time.time() - os.path.getmtime(p) > 3600:
                    os.remove(p)
            except OSError:
                pass
    aid = os.urandom(8).hex()
    out = audio_tmp(aid)
    cmd = [ff, "-hide_banner", "-loglevel", "error", "-y"]
    if start:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", f["path"]]
    if end:
        cmd += ["-t", f"{end - start:.3f}"]
    cmd += ["-vn", "-map", "0:a:0", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]
    r = subprocess.run(cmd, timeout=900, stdin=subprocess.DEVNULL, capture_output=True, text=True, errors="replace")
    if r.returncode != 0 or not os.path.exists(out):
        err = (r.stderr or "").strip()
        if "matches no streams" in err:
            raise RuntimeError("This video has no sound")
        raise RuntimeError("ffmpeg: " + (err.splitlines()[-1] if err else f"exit code {r.returncode}"))
    name = safe_name(scene.get("title") or os.path.splitext(f.get("basename") or "")[0] or f"Scene {sid}")
    saved = None
    if args.get("save"):
        folder = os.path.join(stash.target_dir(), "Songs")
        os.makedirs(folder, exist_ok=True)
        saved = os.path.join(folder, name + ".m4a")
        n = 2
        while os.path.exists(saved):
            saved = os.path.join(folder, f"{name} ({n}).m4a")
            n += 1
        shutil.copyfile(out, saved)
        log(f"Sound saved: {saved}")
    return {"id": aid, "size": os.path.getsize(out), "name": name, "saved": saved}


def audio_chunk(args):
    aid = str(args.get("id") or "")
    if not re.match(r"^[0-9a-f]{16}$", aid):
        raise ValueError("invalid id")
    path = audio_tmp(aid)
    if not os.path.exists(path):
        raise RuntimeError("the extracted sound is gone – extract it again")
    offset = max(0, int(args.get("offset") or 0))
    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        fh.seek(offset)
        data = fh.read(AUDIO_CHUNK)
    last = offset + len(data) >= size
    if last:
        try:
            os.remove(path)
        except OSError:
            pass
    return {"data": base64.b64encode(data).decode("ascii"), "size": size, "last": last}


def main():
    data = json.loads(sys.stdin.read() or "{}")
    args = data.get("args") or {}
    mode = str(args.get("mode") or "")
    try:
        if mode == "save_chunk":
            out = save_chunk(Stash(data.get("server_connection")), args)
        elif mode == "extract_audio":
            out = extract_audio(Stash(data.get("server_connection")), args)
        elif mode == "audio_chunk":
            out = audio_chunk(args)
        elif mode == "rg_api":
            import rgbackend
            out = rgbackend.api(args.get("path"))
        elif mode == "rg_download":
            import rgbackend
            out = rgbackend.download(args)
        else:
            raise ValueError(f"unknown mode: {mode or '(empty)'}")
    except Exception as e:
        print(f"\x01e\x02[PMV Generator] {e}", file=sys.stderr, flush=True)
        print(json.dumps({"error": str(e)}))
        return
    print(json.dumps({"output": out}))


if __name__ == "__main__":
    main()
