// One-shot fetch for the GitHub Actions (no-server) option — durable version.
// Keeps a self-refreshing token chain so it never expires, connects, grabs one
// snapshot, writes events.json. The token lives only in the Actions cache
// (token.txt), never in the public repo.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const API = 'https://ru-api.funtimeevents.su';
const WS_URL = 'wss://ru-api.funtimeevents.su/v1/app/ws';

async function makeSocket(url) {
  if (globalThis.WebSocket) return new globalThis.WebSocket(url);
  const mod = await import('ws');
  return new mod.WebSocket(url);
}

// seed: rolling cached token, else the repo secret
let token = (existsSync('token.txt') ? readFileSync('token.txt', 'utf8').trim() : '')
  || (process.env.FTE_TOKEN || '').trim();

// bearer-refresh mints a fresh 7-day token from the current one — no cookie needed
async function refresh(t) {
  if (!t) return t;
  try {
    const r = await fetch(API + '/v1/app/auth/me', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t },
      body: '{}',
    });
    const j = await r.json();
    if (j && j.success && j.jwt) return j.jwt;
  } catch {}
  return t;
}

token = await refresh(token);
if (token) writeFileSync('token.txt', token); // persisted via Actions cache, stays private

const result = await new Promise(async (resolve) => {
  if (!token) return resolve({ updated: Date.now(), count: 0, events: [], error: 'no token' });
  let ws;
  try { ws = await makeSocket(WS_URL + '?token=' + encodeURIComponent(token)); }
  catch { return resolve({ updated: Date.now(), count: 0, events: [], error: 'socket' }); }
  let done = false;
  const fin = (d) => { if (done) return; done = true; try { ws.close(); } catch {} resolve(d); };
  ws.onopen = () => { try { ws.send('ping'); } catch {} };
  ws.onmessage = (ev) => {
    const t = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
    let m; try { m = JSON.parse(t); } catch { return; }
    if (m && Array.isArray(m.events)) fin({ updated: Date.now(), count: m.events.length, events: m.events });
  };
  ws.onerror = () => fin({ updated: Date.now(), count: 0, events: [], error: 'ws' });
  setTimeout(() => fin({ updated: Date.now(), count: 0, events: [], error: 'timeout' }), 12000);
});

writeFileSync('events.json', JSON.stringify(result));
console.log('events:', result.count, result.error || 'ok');
