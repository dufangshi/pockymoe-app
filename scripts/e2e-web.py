#!/usr/bin/env python3
"""Private Pages-style SPA fallback and optional same-origin relay proxy."""
import functools
import http.client
import http.server
import pathlib
import select
import socket
import sys
import urllib.parse

relay = urllib.parse.urlsplit(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else None
relay_front = '--relay-front' in sys.argv[4:]
browser_origin = sys.argv[5] if relay_front and len(sys.argv) > 5 else None


class SpaFiles(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def proxy(self):
        headers = {key: value for key, value in self.headers.items() if key.lower() not in {'host', 'content-length'}}
        # Only the configured loopback Web stands in for a same-site HTTPS sibling.
        # Keep Origin unchanged, so the real relay still checks its allowlist.
        if relay_front and self.headers.get('Origin') == browser_origin:
            for key in list(headers):
                if key.lower() == 'sec-fetch-site' and headers[key] == 'cross-site':
                    headers[key] = 'same-site'
        if self.headers.get('Upgrade', '').lower() == 'websocket':
            peer = socket.create_connection((relay.hostname, relay.port), timeout=60)
            try:
                raw_headers = ''.join(f'{k}: {v}\r\n' for k, v in headers.items())
                peer.sendall((f'GET {self.path} HTTP/1.1\r\nHost: {relay.netloc}\r\n' + raw_headers + '\r\n').encode())
                response = bytearray()
                while not response.endswith(b'\r\n\r\n'):
                    part = peer.recv(1)
                    if not part or len(response) > 65536:
                        return
                    response.extend(part)
                self.connection.sendall(response)
                while True:
                    ready, _, _ = select.select([self.connection, peer], [], [], 60)
                    if not ready:
                        break
                    for source in ready:
                        data = source.recv(65536)
                        if not data:
                            return
                        (peer if source is self.connection else self.connection).sendall(data)
            finally:
                peer.close()
                self.close_connection = True
            return
        upstream = http.client.HTTPConnection(relay.hostname, relay.port, timeout=60)
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        upstream.request(self.command, self.path, body=body or None, headers=headers)
        response = upstream.getresponse()
        self.send_response(response.status)
        for key, value in response.getheaders():
            if key.lower() not in {'transfer-encoding', 'connection', 'content-length'}:
                # localhost and 127.0.0.1 are different sites. Only this private
                # HTTP fixture needs third-party cookies; real HTTPS sibling hosts
                # retain the relay's normal SameSite=Lax policy.
                if relay_front and key.lower() == 'set-cookie':
                    value = value.replace('SameSite=Lax', 'SameSite=None')
                self.send_header(key, value)
        if response.status == 101:
            self.send_header('Connection', 'Upgrade')
            self.end_headers()
            self.wfile.flush()
            peer = upstream.sock
            try:
                while True:
                    ready, _, _ = select.select([self.connection, peer], [], [], 60)
                    if not ready:
                        break
                    for source in ready:
                        data = source.recv(65536)
                        if not data:
                            return
                        (peer if source is self.connection else self.connection).sendall(data)
            finally:
                upstream.close()
        else:
            data = response.read()
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            upstream.close()

    def do_POST(self):
        self.proxy() if relay and (relay_front or self.path.startswith('/relay/')) else self.send_error(404)

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST
    do_OPTIONS = do_POST

    def do_GET(self):
        if relay_front:
            return self.proxy()
        # A local browser page exercises the actual Custom Tab/deep-link round trip,
        # without sending an OAuth request to any provider.
        if self.path.startswith('/relay/auth/e2e-tab'):
            data = b'<html><title>Local sign-in return</title><a href="remotecodex://auth/callback?id=local-fixture">Return to Pockymoe</a></html>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if relay and self.path.startswith('/relay/'):
            return self.proxy()
        target = pathlib.Path(self.translate_path(self.path.split('?', 1)[0]))
        fallback = not target.exists() and not pathlib.PurePosixPath(self.path.split('?', 1)[0]).suffix
        if fallback or target.name == 'index.html' or self.path.split('?', 1)[0] == '/':
            body = pathlib.Path(self.directory, 'index.html').read_bytes().replace(b'<head>', b'<head><base href="/">', 1)
            self.send_response(404 if fallback else 200)
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
