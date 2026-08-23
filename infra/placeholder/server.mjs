// Placeholder container for the phrasey-server Cloud Run service.
//
// It exists so the service is real and healthy before packages/server ships:
// GET /healthz and GET /health -> 200. /healthz is the path the Terraform
// startup/liveness probes use; Cloud Run's frontend reserves that exact path
// and 404s it for external callers, so /health is the alias you can curl.
// Everything else -> the same coming-soon page Firebase Hosting serves.
// scripts/deploy.sh replaces this image with the real game server.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const port = Number(process.env.PORT ?? 8080);
const page = readFileSync(new URL('./index.html', import.meta.url));

createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'phrasey-server', placeholder: true }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(page);
}).listen(port, '0.0.0.0', () => console.log(`phrasey placeholder listening on ${port}`));
