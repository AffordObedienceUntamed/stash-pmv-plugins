"""Stash UI – a small backend for what the browser can't do on its own.

Called through Stash's `runPluginOperation` (interface: raw):

* mode "funscript_save": give a scene a funscript. Stash finds funscripts by their name – next to
  the video, with the same name and the extension .funscript (video.mp4 → video.funscript) – so the
  file is written there; then the video is scanned again so Stash marks the scene as interactive.
      args:   {"mode": "funscript_save", "scene_id": "12", "content": "<the .funscript as text>"}
      output: {"path": "...", "replaced": bool}
  The video's path comes from Stash (not from the browser). A funscript that was there before is
  kept as "<name>.funscript.bak".
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


def funscript_save(stash, args):
    sid = str(args.get("scene_id") or "")
    if not sid.isdigit():
        raise ValueError("no scene")
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


def main():
    data = json.loads(sys.stdin.read() or "{}")
    args = data.get("args") or {}
    mode = str(args.get("mode") or "")
    try:
        if mode == "funscript_save":
            out = funscript_save(Stash(data.get("server_connection")), args)
        else:
            raise ValueError(f"unknown mode: {mode or '(empty)'}")
    except Exception as e:
        print(f"\x01e\x02[Stash UI] {e}", file=sys.stderr, flush=True)
        print(json.dumps({"error": str(e)}))
        return
    print(json.dumps({"output": out}))


if __name__ == "__main__":
    main()
