// A dependency-free static server for the exported site, used by `npm start`
// and by Playwright. Nothing about the product needs a server; this exists so
// the end-to-end tests can exercise the same files that get deployed.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'out');
const port = Number(process.env.PORT || 3100);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const candidates = [join(root, clean)];
  if (!extname(clean)) {
    candidates.push(join(root, clean, 'index.html'));
    candidates.push(join(root, `${clean.replace(/\/$/, '')}.html`));
  }
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

createServer((req, res) => {
  const file = resolve(req.url || '/');
  if (!file) {
    const notFound = join(root, '404.html');
    if (existsSync(notFound)) {
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      createReadStream(notFound).pipe(res);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  process.stdout.write(`patternwall static server on http://localhost:${port}\n`);
});
