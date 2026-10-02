"""Vista local para revisar la interfaz sin tocar el almacenamiento de la extensión.

Ejecutar: python3 tools/preview.py
Abrir: http://127.0.0.1:8765/panel/index.html
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHIM = r"""
const previewListeners = [];
window.chrome = {runtime: {}, storage: {onChanged: {addListener(fn) {previewListeners.push(fn);}}, local: {
  get(keys, cb) { const out = {}; for (const key of keys) out[key] = localStorage.getItem('chatlog-review:' + key); queueMicrotask(() => cb(out)); },
  set(values, cb) {
    const changes = {};
    try {
      for (const [key, value] of Object.entries(values)) {
        const oldValue = localStorage.getItem('chatlog-review:' + key);
        localStorage.setItem('chatlog-review:' + key, value);
        changes[key] = {oldValue, newValue: value};
      }
    } catch (error) { chrome.runtime.lastError = {message: error.message}; }
    cb(); delete chrome.runtime.lastError;
    previewListeners.forEach(fn => fn(changes, 'local'));
  },
  getBytesInUse(keys, cb) {
    let bytes = 0; for (const key of Object.keys(localStorage)) if (key.startsWith('chatlog-review:')) bytes += new TextEncoder().encode(localStorage.getItem(key)).length;
    cb(bytes);
  }
}}, downloads: {download({url, filename}, cb) {
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); cb();
}}};
"""

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        route = self.path.split('?', 1)[0]
        if route == '/review-storage.js':
            content = SHIM.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
            self.end_headers()
            self.wfile.write(content)
            return
        if route == '/panel/index.html':
            html = (ROOT / 'panel/index.html').read_text()
            html = html.replace('<head>', '<head><script src="/review-storage.js"></script>')
            html = html.replace('<body>', '<body><p style="padding:12px;background:#fff5d6">Revisión local 2.0.1 · Datos de prueba independientes de tu extensión instalada.</p>')
            content = html.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(content)
            return
        if not route.startswith(('/panel/', '/docs/', '/manuals/', '/icons/')) and route != '/script.js':
            self.send_error(404)
            return
        if '..' in route:
            self.send_error(404)
            return
        super().do_GET()

if __name__ == '__main__':
    print('Revisión local: http://127.0.0.1:8765/panel/index.html', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8765), Handler).serve_forever()
