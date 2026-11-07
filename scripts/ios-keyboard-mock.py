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
LAYOUT = sys.argv[3] if len(sys.argv) > 3 else 'dock'
THREAD = '/devices/pockymoe-tour/threads/c27d9e41-5b8a-4f3c-8e61-2d4b7a9c1e01'
PROBE = '''<div id="kb-probe" role="img" aria-label="KBPROBE" style="position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;z-index:2147483647"></div>
<script>setInterval(() => {
  const v = window.visualViewport, root = getComputedStyle(document.documentElement), host = document.querySelector('.thread-graph-composer-host, form[data-composer-layout]');
  const box = host ? host.getBoundingClientRect() : null;
  document.getElementById('kb-probe').setAttribute('aria-label', 'KBPROBE ih=' + innerHeight + ' vh=' + (v && v.height) + ' vt=' + (v && v.offsetTop) + ' sy=' + scrollY
    + ' detail=' + root.getPropertyValue('--thread-detail-keyboard-inset') + ' composer=' + root.getPropertyValue('--thread-composer-keyboard-inset')
    + ' native=' + root.getPropertyValue('--remote-codex-native-height') + ' host=' + (box ? Math.round(box.top) + '/' + Math.round(box.bottom) : '-'));
}, 150);</script>'''
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
        page = (DIST / 'index.html').read_text().replace('<base href="./"', '<base href="/"')
        # The test reads the page's own viewport readings from this element.
        page = page.replace('</body>', PROBE + '</body>')
        # The phone's classic layout (no dock), when asked for.
        if LAYOUT == 'classic':
            page = page.replace('<head>', "<head><script>localStorage.setItem('pockymoe.phoneDock','off')</script>", 1)
        page = page.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(page)))
        self.end_headers()
        self.wfile.write(page)

    def log_message(self, *args):
        pass


ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
