#!/usr/bin/env python3
"""Receive canvas captures from the running game and write them to disk.

The marketing stills are shot at 2880x1620 off the game's own canvas, which is
several megabytes of base64 once encoded — too much to hand back through a
browser-automation eval. So the page POSTs the raw PNG blob here instead and
this writes the bytes straight to a file.

Deliberately a SEPARATE process from `dev-server.py`: that file's entire job is
"static files, never cached", and it is load-bearing enough to have its own
warning in CLAUDE.md. A capture endpoint on it would be a second concern living
in the one file nobody should have to think about.

    python3 scripts/capture-sink.py [port] [outdir]

Then, from the page:

    canvas.toBlob(b => fetch('http://localhost:4178/shot/hero.png',
                             { method: 'POST', body: b }));
"""

import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

OUTDIR = Path('.')


class SinkHandler(BaseHTTPRequestHandler):
    def _cors(self):
        # The page is served from :4177 and posts to :4178 — a cross-origin
        # write, so the preflight has to be answered or the blob never arrives.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        name = os.path.basename(self.path.lstrip('/').replace('shot/', '', 1))
        if not name:
            self.send_response(400)
            self._cors()
            self.end_headers()
            return
        size = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(size)
        dest = OUTDIR / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        print(f'wrote {dest} ({len(data):,} bytes)', flush=True)
        self.send_response(200)
        self._cors()
        self.send_header('Content-Length', '2')
        self.end_headers()
        self.wfile.write(b'ok')

    def log_message(self, fmt, *args):
        pass


def main():
    global OUTDIR
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4178
    OUTDIR = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('.')
    OUTDIR.mkdir(parents=True, exist_ok=True)
    with ThreadingHTTPServer(('127.0.0.1', port), SinkHandler) as httpd:
        print(f'capture sink on http://localhost:{port} -> {OUTDIR.resolve()}', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
