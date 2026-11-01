"""Loopback static Pages server with SPA fallback; no proxy or API handlers."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


class StaticHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "application/javascript", ".mjs": "application/javascript", ".wasm": "application/wasm"}

    def send_head(self):
        root = Path(self.directory).resolve()
        relative = unquote(urlsplit(self.path).path).lstrip("/")
        candidate = (root / relative).resolve()
        if not candidate.is_relative_to(root):
            self.send_error(403)
            return None
        if not candidate.exists() and not Path(relative).suffix:
            self.path = "/index.html"
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--port", required=True, type=int)
    args = parser.parse_args()
    ThreadingHTTPServer(("127.0.0.1", args.port), partial(StaticHandler, directory=args.directory)).serve_forever()
