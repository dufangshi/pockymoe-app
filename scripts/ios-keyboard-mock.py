#!/usr/bin/env python3
"""Serves a built Pockymoe Web (local mode) for the iOS keyboard simulator check.

The page opens the guided tour's sample thread, which the Web answers in the
browser, so no Supervisor or relay is needed: only signing in and the runtime
configuration are answered here.
"""
import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIST = Path(sys.argv[1]).resolve()
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
THREAD = '/devices/pockymoe-tour/threads/c27d9e41-5b8a-4f3c-8e61-2d4b7a9c1e01'
ANSWERS = {
    '/api/auth/session': {'authenticated': True, 'authRequired': False, 'mode': 'local', 'username': 'owner'},
    '/api/config/runtime': {'mode': 'local', 'hostMode': 'standalone', 'appVersion': 'ci', 'hostCapabilities': {}},
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/':
            self.send_response(302)
            self.send_header('Location', THREAD)
            self.end_headers()
            return
        # Relative API paths arrive under the page's route too.
        for marker in ('/api/', '/relay/', '/ws'):
            if marker in path:
                path = path[path.index(marker):]
                break
        if path in ANSWERS:
            return self.send_json(200, ANSWERS[path])
        if path.startswith(('/api/', '/relay/', '/ws')):
            return self.send_json(404, {'code': 'not_found', 'message': 'not served by the keyboard check'})
        # The Web refers to its files relative to the page: a nested route asks
        # for /devices/.../assets/x.js. Serve the longest existing tail.
        parts = path.strip('/').split('/')
        found = next(('/' + '/'.join(parts[i:]) for i in range(len(parts)) if (DIST / '/'.join(parts[i:])).is_file()), None)
        if found:
            self.path = found
            return super().do_GET()
        # The page's routes all serve the index, based at the root (as the
        # Supervisor's SPA server adjusts its relative <base>).
        page = (DIST / 'index.html').read_text().replace('<base href="./"', '<base href="/"').encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(page)))
        self.end_headers()
        self.wfile.write(page)

    def log_message(self, *args):
        pass


ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
