"""Stash UI – a small backend for what the browser can't do on its own.

Called through Stash's `runPluginOperation` (interface: raw):

* mode "funscript_list": every .funscript in the Stash library folders (to pick one in the player).
      args:   {"mode": "funscript_list", "scene_id": "12"}
      output: {"files": [{"path", "name", "dir", "size", "mtime", "paired"}], "current": "<path or null>",
               "truncated": bool}
  "paired": a video with the same name lies next to it (it already belongs to one); "current": the
  funscript the scene has now (next to its video).

* mode "funscript_save": give a scene a funscript. Stash finds funscripts by their name – next to
  the video, with the same name and the extension .funscript (video.mp4 → video.funscript) – so the
  file is written there; then the video is scanned again so Stash marks the scene as interactive.
  That's what keeps the choice: it stays with the video, also after a restart and in classic Stash.
      args:   {"mode": "funscript_save", "scene_id": "12", "source": "<a .funscript in the library>"}
          or  {"mode": "funscript_save", "scene_id": "12", "content": "<the .funscript as text>"}
      output: {"path": "...", "replaced": bool}
  The video's path comes from Stash (not from the browser); a source must lie in a library folder.
  A funscript that was there before is kept as "<name>.funscript.bak".

* mode "funscript_remove": the scene's funscript goes aside (renamed to .funscript.bak), Stash scans.
      args:   {"mode": "funscript_remove", "scene_id": "12"}
      output: {"removed": bool}
"""

import json
import os
import sys
import urllib.request

MAX_SIZE = 30 * 1024 * 1024


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

    def gql(self, query, variables=None):
        req = urllib.request.Request(self.url, json.dumps({"query": query, "variables": variables or {}}).encode(), self.headers, method="POST")
        with urllib.request.urlopen(req, timeout=30) as res:
            d = json.load(res)
        if d.get("errors"):
            raise RuntimeError("Stash: " + "; ".join(e.get("message", "") for e in d["errors"]))
        return d["data"]


MAX_LIST = 20000
SKIP_DIRS = {".git", "$recycle.bin", "system volume information", "node_modules", ".trash", "@eadir"}


def libraries(stash):
    st = stash.gql("query { configuration { general { stashes { path excludeVideo } videoExtensions } } }")["configuration"]["general"]
    roots = [os.path.realpath(s["path"]) for s in (st.get("stashes") or []) if s.get("path")]
    exts = {"." + e.lower().lstrip(".") for e in (st.get("videoExtensions") or ["mp4", "m4v", "mov", "wmv", "avi", "mpg", "mpeg", "mkv", "webm", "flv"])}
    return roots, exts


def inside(path, roots):
    p = os.path.normcase(os.path.realpath(path))
    for r in roots:
        r = os.path.normcase(r)
        try:
            if os.path.commonpath([p, r]) == r:
                return True
        except ValueError:
            pass  # another drive
    return False


def scene_video(stash, sid):
    if not sid.isdigit():
        raise ValueError("no scene")
    files = stash.gql("query($id: ID!) { findScene(id: $id) { files { path } } }", {"id": sid})["findScene"]
    if not files or not files.get("files"):
        raise ValueError("the scene has no file")
    return files["files"][0]["path"]


def funscript_list(stash, args):
    roots, exts = libraries(stash)
    current = None
    sid = str(args.get("scene_id") or "")
    if sid:
        try:
            f = os.path.splitext(scene_video(stash, sid))[0] + ".funscript"
            current = f if os.path.isfile(f) else None
        except Exception:
            pass
    out = []
    truncated = False
    for root in roots:
        for d, dirs, files in os.walk(root):
            dirs[:] = [x for x in dirs if x.lower() not in SKIP_DIRS and not x.startswith(".")]
            low = {f.lower() for f in files}
            for f in files:
                if not f.lower().endswith(".funscript"):
                    continue
                p = os.path.join(d, f)
                stem = f[: -len(".funscript")].lower()
                try:
                    stt = os.stat(p)
                except OSError:
                    continue
                out.append({"path": p, "name": f, "dir": d, "size": stt.st_size, "mtime": int(stt.st_mtime),
                            "paired": any(stem + e in low for e in exts)})
                if len(out) >= MAX_LIST:
                    truncated = True
                    break
            if truncated:
                break
        if truncated:
            break
    return {"files": out, "current": current, "truncated": truncated}


def funscript_save(stash, args):
    sid = str(args.get("scene_id") or "")
    if not sid.isdigit():
        raise ValueError("no scene")
    source = str(args.get("source") or "")
    if source:
        roots, _ = libraries(stash)
        if not source.lower().endswith(".funscript") or not os.path.isfile(source) or not inside(source, roots):
            raise ValueError("that funscript isn't in a Stash library folder")
        with open(source, encoding="utf-8-sig", errors="replace") as f:
            args = dict(args, content=f.read())
    content = str(args.get("content") or "")
    if len(content.encode()) > MAX_SIZE:
        raise ValueError("the funscript is too big")
    try:
        fs = json.loads(content)
    except Exception:
        raise ValueError("that's not a funscript (not JSON)")
    acts = fs.get("actions") if isinstance(fs, dict) else None
    if not isinstance(acts, list) or not acts or not all(isinstance(a, dict) and "at" in a and "pos" in a for a in acts[:50]):
        raise ValueError("that's not a funscript (no actions with at/pos)")
    files = stash.gql("query($id: ID!) { findScene(id: $id) { files { path } } }", {"id": sid})["findScene"]
    if not files or not files.get("files"):
        raise ValueError("the scene has no file")
    video = files["files"][0]["path"]
    if not os.path.isfile(video):
        raise ValueError(f"the video file can't be reached from here: {video}")
    target = os.path.splitext(video)[0] + ".funscript"  # like Stash: the extension replaced
    if source and os.path.normcase(os.path.realpath(source)) == os.path.normcase(os.path.realpath(target)):
        # it's already the one next to the video – only let Stash look again
        stash.gql("mutation($i: ScanMetadataInput!) { metadataScan(input: $i) }", {"i": {"paths": [video], "rescan": True}})
        return {"path": target, "replaced": False}
    replaced = os.path.exists(target)
    if replaced:
        os.replace(target, target + ".bak")
    tmp = target + ".part"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    os.replace(tmp, target)
    # Stash notices the funscript when it scans the video again
    stash.gql("mutation($i: ScanMetadataInput!) { metadataScan(input: $i) }", {"i": {"paths": [video], "rescan": True}})
    return {"path": target, "replaced": replaced}


def funscript_remove(stash, args):
    video = scene_video(stash, str(args.get("scene_id") or ""))
    target = os.path.splitext(video)[0] + ".funscript"
    if not os.path.isfile(target):
        return {"removed": False}
    os.replace(target, target + ".bak")
    stash.gql("mutation($i: ScanMetadataInput!) { metadataScan(input: $i) }", {"i": {"paths": [video], "rescan": True}})
    return {"removed": True}


def main():
    data = json.loads(sys.stdin.read() or "{}")
    args = data.get("args") or {}
    mode = str(args.get("mode") or "")
    try:
        if mode == "funscript_list":
            out = funscript_list(Stash(data.get("server_connection")), args)
        elif mode == "funscript_save":
            out = funscript_save(Stash(data.get("server_connection")), args)
        elif mode == "funscript_remove":
            out = funscript_remove(Stash(data.get("server_connection")), args)
        else:
            raise ValueError(f"unknown mode: {mode or '(empty)'}")
    except Exception as e:
        print(f"\x01e\x02[Stash UI] {e}", file=sys.stderr, flush=True)
        print(json.dumps({"error": str(e)}))
        return
    print(json.dumps({"output": out}))


if __name__ == "__main__":
    main()
