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
"""

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

FOLDER = "PMV Generator"
INVALID = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
UPLOAD_ID = re.compile(r"^[a-z0-9]{6,40}$")


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


def main():
    data = json.loads(sys.stdin.read() or "{}")
    args = data.get("args") or {}
    mode = str(args.get("mode") or "")
    try:
        if mode == "save_chunk":
            out = save_chunk(Stash(data.get("server_connection")), args)
        else:
            raise ValueError(f"unknown mode: {mode or '(empty)'}")
    except Exception as e:
        print(f"\x01e\x02[PMV Generator] {e}", file=sys.stderr, flush=True)
        print(json.dumps({"error": str(e)}))
        return
    print(json.dumps({"output": out}))


if __name__ == "__main__":
    main()
