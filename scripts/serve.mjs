// Minimal static server for local checks. Serves dist/ only.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
export function serve(port = 4173, rewrite = async (_url, body) => body) {
  const srv = http.createServer(async (req, res) => {
    try {
      let u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (u.endsWith('/')) u += 'index.html';
      const file = path.join(root, u);
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      const body = await rewrite(u, await readFile(file));
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await serve(Number(process.env.PORT) || 4173);
  console.log('http://127.0.0.1:' + (process.env.PORT || 4173));
}
