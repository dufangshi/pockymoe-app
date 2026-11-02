#!/usr/bin/env python3
"""Disposable SPA file server for the Android Web/API origin separation check."""
import functools
import http.server
import pathlib
import sys


class SpaFiles(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        target = pathlib.Path(self.translate_path(self.path.split('?', 1)[0]))
        fallback = not target.exists() and not pathlib.PurePosixPath(self.path.split('?', 1)[0]).suffix
        if fallback or target.name == 'index.html' or self.path.split('?', 1)[0] == '/':
            # Match the relay/static deployment's root base for deep-link reloads,
            # including Web builds that emitted relative asset URLs.
            body = pathlib.Path(self.directory, 'index.html').read_bytes().replace(
                b'<head>', b'<head><base href="/">', 1)
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()


http.server.ThreadingHTTPServer(
    ('127.0.0.1', int(sys.argv[2])), functools.partial(SpaFiles, directory=sys.argv[1])
).serve_forever()
