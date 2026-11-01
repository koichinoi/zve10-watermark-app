import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const limit = 48 * 1024 * 1024;
async function collect(stream, max = limit) {
  let total = 0; const chunks = [];
  for await (const chunk of stream) { total += chunk.length; if (total > max) throw new Error('size limit'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
export function createCloudServer({ upstream, root = resolve('pages-dist'), port = 5188 }) {
  const target = new URL(upstream);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error('AI_API_BASE must be an HTTP(S) base URL without credentials');
  const base = target.href.replace(/\/+$/, '');
  return http.createServer(async (req, res) => {
    const host = `127.0.0.1:${port}`; const origin = `http://${host}`;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); res.end(); return; }
    const route = new URL(req.url, origin).pathname;
    if (route.startsWith('/api/cloud/')) {
      if (!((route === '/api/cloud/models' && req.method === 'GET') || (route === '/api/cloud/images/edits' && req.method === 'POST'))) { res.writeHead(404); res.end(); return; }
      if (!/^Bearer \S+$/.test(req.headers.authorization ?? '')) { res.writeHead(401); res.end(); return; }
      if (req.method === 'POST' && !req.headers['content-type']?.startsWith('multipart/form-data;')) { res.writeHead(415); res.end(); return; }
      const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 300000);
      res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      try {
        const body = req.method === 'POST' ? await collect(req, 20 * 1024 * 1024) : undefined;
        const response = await fetch(base + route.slice('/api/cloud'.length), { method: req.method, headers: { Authorization: req.headers.authorization, ...(body ? { 'Content-Type': req.headers['content-type'] } : {}) }, body, signal: abort.signal, redirect: 'error' });
        const data = response.body ? await collect(response.body) : Buffer.alloc(0);
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        // Do not reflect upstream error bodies: gateways can include credentials or internal request details.
        res.end(response.ok ? data : JSON.stringify({ error: { message: 'Upstream request failed' } }));
      } catch { if (!res.destroyed) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"Local connection failed or timed out"}}'); } }
      finally { clearTimeout(timer); }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let relative;
    try { relative = decodeURIComponent(route).replace(/^\/zve10-watermark-app\/?/, '').replace(/^\/+/, '') || 'index.html'; } catch { res.writeHead(400); res.end(); return; }
    const file = resolve(root, relative);
    if (!file.startsWith(resolve(root) + sep)) { res.writeHead(403); res.end(); return; }
    try {
      const content = await readFile(file);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404); res.end('Not found. Build pages first.'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.env.AI_API_BASE) throw new Error('Set AI_API_BASE to your gateway /v1 URL. API Key is entered only in the webpage.');
  const port = Number(process.env.PORT || 5188);
  const server = createCloudServer({ upstream: process.env.AI_API_BASE, port });
  server.listen(port, '127.0.0.1', () => console.log(`Open http://127.0.0.1:${port}/zve10-watermark-app/`));
}
