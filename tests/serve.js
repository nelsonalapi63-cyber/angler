'use strict';
// Tiny static server for tests (no dependencies).
//   const { start } = require('./serve'); const srv = await start(); srv.url; srv.close()
//   node tests/serve.js                 → serves the repository root at :8787 (no caching, like a dev server)
//   node tests/serve.js --dist          → serves dist/ with gzip and cache headers, roughly what GitHub Pages sends (for Lighthouse)
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest', '.txt', '.xml']);

function start(port, opts) {
  opts = opts || {};
  const ROOT = path.resolve(opts.root || path.join(__dirname, '..'));
  const prod = !!opts.prod;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      if (p.endsWith('/')) p += 'index.html';
      let file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (prod && fs.existsSync(path.join(ROOT, '404.html'))) { file = path.join(ROOT, '404.html'); res.statusCode = 404; }
        else { res.writeHead(404); return res.end('not found'); }
      }
      const ext = path.extname(file);
      const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': prod ? (ext === '.html' ? 'public, max-age=600' : 'public, max-age=31536000') : 'no-store' };
      const gzip = prod && COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      if (gzip) { headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding'; }
      res.writeHead(res.statusCode || 200, headers);
      const stream = fs.createReadStream(file);
      (gzip ? stream.pipe(zlib.createGzip({ level: 6 })) : stream).pipe(res);
    });
    server.listen(port || 0, '127.0.0.1', () => resolve({ url: 'http://127.0.0.1:' + server.address().port + '/', close: () => server.close() }));
  });
}
module.exports = { start };
if (require.main === module) {
  const dist = process.argv.includes('--dist');
  start(8787, dist ? { root: path.join(__dirname, '..', 'dist'), prod: true } : {}).then(s => console.log('serving ' + (dist ? 'dist/' : 'the repository') + ' at ' + s.url));
}
