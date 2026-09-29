#!/usr/bin/env node
// Local stand-in for Archie's secrets proxy, for HubSpot calls during development only.
// Forwards http://localhost:8787/<path> → https://api.hubapi.com/<path> with the token from
// the HUBSPOT_TOKEN env var. The token never touches the repo or the browser.
//
//   HUBSPOT_TOKEN=pat-… node scripts/dev-proxy.mjs
//
// On Archie this script is not used: src/lib/hubspot.js calls archie.secrets.proxy instead.
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = process.env.DEV_ORIGIN ?? 'http://localhost:5173';
const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) {
  console.error('HUBSPOT_TOKEN is not set. Run: HUBSPOT_TOKEN=pat-… node scripts/dev-proxy.mjs');
  process.exit(1);
}

http
  .createServer(async (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    if (!/^\/crm\//.test(req.url)) {
      res.writeHead(403, cors);
      return res.end('only /crm/* is proxied');
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const upstream = await fetch(`https://api.hubapi.com${req.url}`, {
        method: req.method,
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: body || undefined,
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { ...cors, 'Content-Type': 'application/json' });
      res.end(text);
      console.log(`${req.method} ${req.url} → ${upstream.status}`);
    } catch (err) {
      res.writeHead(502, cors);
      res.end(JSON.stringify({ message: String(err) }));
    }
  })
  .listen(PORT, () => console.log(`HubSpot dev proxy on http://localhost:${PORT} → api.hubapi.com (for ${ORIGIN})`));
