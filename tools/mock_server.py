import http.server, ssl, os, glob, re
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'samples')
routes = {}
links = []
for f in glob.glob(os.path.join(ROOT, '*.mhtml')):
    raw = open(f, 'rb').read()
    url = re.search(rb'Snapshot-Content-Location: (\S+)', raw).group(1).decode()
    path = url.replace('https://www.zillow.com', '')
    name = os.path.basename(f).split(' _ ')[0]
    routes[path] = open(os.path.join(ROOT, 'html', name + '.html'), 'rb').read()
    links.append((path, name))
search = '<html><head><title>Sumter SC Real Estate</title></head><body><h1>Mock search</h1><div id="list" style="height:300px;overflow:auto">' + ''.join(
    f'<article style="height:200px"><a href="{p}">{n}</a></article>' for p, n in links) + '</div></body></html>'
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        p = self.path.split('?')[0]
        body = routes.get(p) or (search.encode() if p.startswith('/sumter') else None)
        if body is None:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
s = http.server.ThreadingHTTPServer(('127.0.0.1', 8443), H)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(os.path.join(ROOT, 'cert.pem'), os.path.join(ROOT, 'key.pem'))
s.socket = ctx.wrap_socket(s.socket, server_side=True)
s.serve_forever()
