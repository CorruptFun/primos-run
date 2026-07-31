#!/usr/bin/env python3
"""Static server for local development that never lets the browser cache.

`python3 -m http.server` answers with `Last-Modified` and no `Cache-Control`,
which makes every response heuristically cacheable. For an ES-module app with no
build step that is worse than it sounds: the browser keeps reusing the module it
already has, so you edit a file, reload, and are shown the PREVIOUS build with no
error and nothing in the console. It has cost this project real time more than
once — `dev/rig-test.html` and `dev/cloud-test.html` both cache-bust their own
imports specifically to dodge it, and the game itself cannot.

So dev is served with `no-store`. Production is GitHub Pages and is unaffected;
`sw.js` and its CACHE_VERSION remain the caching story that actually ships.

    python3 scripts/dev-server.py [port]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def send_response(self, code, message=None):
        super().send_response(code, message)

    # Suppress the 304 path entirely: without a validator the browser has to
    # re-fetch, which is the whole point. SimpleHTTPRequestHandler adds
    # Last-Modified in send_head(), and If-Modified-Since would otherwise still
    # earn a 304 even with no-store.
    def send_header(self, keyword, value):
        if keyword.lower() == 'last-modified':
            return
        super().send_header(keyword, value)

    def log_message(self, fmt, *args):
        # One line per request is noise for a page that pulls 30 modules.
        if not str(args[1] if len(args) > 1 else '').startswith('2'):
            super().log_message(fmt, *args)


def main():
    # argv wins, then the PORT env var (the preview harness's autoPort hands the
    # assigned port over this way), then the traditional default. The env path
    # exists so several sessions can each run their own server without editing
    # anything — port collisions between parallel chats cost real time once.
    import os
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    else:
        port = int(os.environ.get('PORT', 4177))
    handler = partial(NoCacheHandler, directory=str(ROOT))
    with ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        print(f'primos-run dev server on http://localhost:{port} (no-store)')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
