'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { spawn, spawnSync } = require('child_process');
const https = require('https');
const db = require('./db');

// общие настройки сервера и приложений (адрес публикации ссылки, ссылка на APK)
const CFG = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'volna.config.json'), 'utf8')); } catch { return {}; }
})();
const TUNNEL = process.argv.includes('--tunnel') || process.env.TUNNEL === '1';
let publicUrl = null;

const PORT = Number(process.env.PORT) || 3000;
const MAX_VOICE = 10; // звонки идут напрямую между участниками (mesh), больше 10 тяжело
const SECRET = process.env.JWT_SECRET || loadSecret();

function loadSecret() {
  const file = path.join(db.DIR, 'secret.txt');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, s);
  return s;
}

// ---------- helpers ----------
const COLORS = ['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22', '#00a8fc'];
const uid = () => crypto.randomUUID();
const pubUser = (u) => ({ id: u.id, username: u.username, color: u.color });
const userById = (id) => db.data.users.find((u) => u.id === id);
const serverById = (id) => db.data.servers.find((s) => s.id === id);
const channelById = (id) => db.data.channels.find((c) => c.id === id);
const isMember = (serverId, userId) => db.data.members.some((m) => m.serverId === serverId && m.userId === userId);

function inviteCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s;
  do {
    s = '';
    for (let i = 0; i < 6; i++) s += a[crypto.randomInt(a.length)];
  } while (db.data.servers.some((x) => x.invite === s));
  return s;
}

function serverView(s) {
  return {
    id: s.id,
    name: s.name,
    ownerId: s.ownerId,
    invite: s.invite,
    channels: db.data.channels
      .filter((c) => c.serverId === s.id)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name, type: c.type })),
    members: db.data.members
      .filter((m) => m.serverId === s.id)
      .map((m) => userById(m.userId))
      .filter(Boolean)
      .map(pubUser),
  };
}

function createChannel(serverId, name, type) {
  const position = db.data.channels.filter((c) => c.serverId === serverId).length;
  const c = { id: uid(), serverId, name, type, position };
  db.data.channels.push(c);
  return c;
}

const msgView = (m) => ({
  id: m.id,
  channelId: m.channelId,
  text: m.text,
  ts: m.ts,
  author: pubUser(userById(m.userId) || { id: m.userId, username: 'удалён', color: '#80848e' }),
});

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '50kb' }));
// приложения Android/iOS открывают страницу со своего адреса (https://localhost, capacitor://localhost),
// поэтому API должен разрешать запросы с других источников
app.use('/api', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.get('/config.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache').send(
    `window.VOLNA_SERVER = '';\nwindow.VOLNA_DISCOVERY = '';\nwindow.VOLNA_ANDROID = ${JSON.stringify(CFG.android || '')};\n`
  );
});
app.use(express.static(path.join(__dirname, 'public')));

const NAME_RE = /^[\p{L}\p{N}_.\-]{2,24}$/u;

app.post('/api/register', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!NAME_RE.test(username)) return res.status(400).json({ error: 'Ник: 2–24 символа, буквы, цифры, _ . -' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль — минимум 6 символов' });
  if (db.data.users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Такой ник уже занят' });
  const user = {
    id: uid(),
    username,
    hash: await bcrypt.hash(password, 10),
    color: COLORS[crypto.randomInt(COLORS.length)],
    createdAt: Date.now(),
  };
  db.data.users.push(user);
  db.save();
  res.json({ token: jwt.sign({ id: user.id }, SECRET, { expiresIn: '60d' }), user: pubUser(user) });
});

app.post('/api/login', async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const user = db.data.users.find((u) => u.username.toLowerCase() === username);
  if (!user || !(await bcrypt.compare(String(req.body?.password || ''), user.hash)))
    return res.status(401).json({ error: 'Неверный ник или пароль' });
  res.json({ token: jwt.sign({ id: user.id }, SECRET, { expiresIn: '60d' }), user: pubUser(user) });
});

// STUN/TURN для звонков. TURN задаётся переменными окружения (см. README).
app.get('/api/config', (req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(','),
      username: process.env.TURN_USER,
      credential: process.env.TURN_PASS,
    });
  }
  res.json({ iceServers, publicUrl });
});

// ---------- Socket.IO ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, maxHttpBufferSize: 1e6, pingInterval: 20000, pingTimeout: 25000 });

io.use((socket, next) => {
  try {
    const { id } = jwt.verify(socket.handshake.auth?.token, SECRET);
    const u = userById(id);
    if (!u) return next(new Error('auth'));
    socket.user = u;
    next();
  } catch {
    next(new Error('auth'));
  }
});

const online = new Map(); // userId -> кол-во подключений
const voice = new Map(); // channelId -> Map(socketId -> состояние)
const voiceOf = new Map(); // socketId -> channelId

const voiceList = (channelId) => [...(voice.get(channelId)?.values() || [])];

function broadcastVoice(channelId) {
  const ch = channelById(channelId);
  if (ch) io.to('s:' + ch.serverId).emit('voice:state', { channelId, states: voiceList(channelId) });
}

function leaveVoice(socket) {
  const chId = voiceOf.get(socket.id);
  if (!chId) return;
  voiceOf.delete(socket.id);
  const m = voice.get(chId);
  if (m) {
    m.delete(socket.id);
    if (!m.size) voice.delete(chId);
  }
  socket.leave('v:' + chId);
  io.to('v:' + chId).emit('voice:peer-left', { socketId: socket.id });
  broadcastVoice(chId);
}

function kickFromVoice(channelId, userId) {
  for (const st of voiceList(channelId)) {
    if (userId && st.userId !== userId) continue;
    const sk = io.sockets.sockets.get(st.socketId);
    if (sk) {
      leaveVoice(sk);
      sk.emit('voice:kicked');
    }
  }
}

function voiceSnapshot(servers) {
  const snap = {};
  for (const s of servers) for (const c of s.channels) if (c.type === 'voice' && voice.has(c.id)) snap[c.id] = voiceList(c.id);
  return snap;
}

const reply = (cb, v) => {
  if (typeof cb === 'function') cb(v);
};

io.on('connection', (socket) => {
  const me = socket.user;
  const on = (ev, fn) =>
    socket.on(ev, (payload, cb) => {
      if (typeof payload === 'function') {
        cb = payload;
        payload = {};
      }
      try {
        fn(payload || {}, cb);
      } catch (e) {
        console.error(ev, e);
        reply(cb, { error: 'Ошибка сервера' });
      }
    });
  const myServerIds = () => db.data.members.filter((m) => m.userId === me.id).map((m) => m.serverId);
  const accessChannel = (id) => {
    const c = channelById(id);
    return c && isMember(c.serverId, me.id) ? c : null;
  };

  socket.join('u:' + me.id);
  for (const sid of myServerIds()) socket.join('s:' + sid);
  const count = (online.get(me.id) || 0) + 1;
  online.set(me.id, count);
  if (count === 1) for (const sid of myServerIds()) socket.to('s:' + sid).emit('presence', { userId: me.id, online: true });

  on('init', (_, cb) => {
    const servers = myServerIds().map(serverById).filter(Boolean).map(serverView);
    const ids = new Set([me.id]);
    servers.forEach((s) => s.members.forEach((u) => ids.add(u.id)));
    reply(cb, {
      user: pubUser(me),
      servers,
      online: [...ids].filter((id) => online.has(id)),
      voice: voiceSnapshot(servers),
    });
  });

  // ----- серверы -----
  on('server:create', ({ name }, cb) => {
    name = String(name || '').trim().slice(0, 40);
    if (!name) return reply(cb, { error: 'Введи название' });
    if (db.data.servers.filter((s) => s.ownerId === me.id).length >= 30) return reply(cb, { error: 'Слишком много серверов' });
    const s = { id: uid(), name, ownerId: me.id, invite: inviteCode(), createdAt: Date.now() };
    db.data.servers.push(s);
    db.data.members.push({ serverId: s.id, userId: me.id, joinedAt: Date.now() });
    createChannel(s.id, 'общий', 'text');
    createChannel(s.id, 'Голосовой', 'voice');
    db.save();
    io.in('u:' + me.id).socketsJoin('s:' + s.id);
    const view = serverView(s);
    socket.to('u:' + me.id).emit('server:added', view);
    reply(cb, { server: view });
  });

  on('server:join', ({ code }, cb) => {
    code = String(code || '').trim().toUpperCase();
    const s = db.data.servers.find((x) => x.invite === code);
    if (!s) return reply(cb, { error: 'Сервер с таким кодом не найден' });
    const fresh = !isMember(s.id, me.id);
    if (fresh) {
      db.data.members.push({ serverId: s.id, userId: me.id, joinedAt: Date.now() });
      db.save();
    }
    io.in('u:' + me.id).socketsJoin('s:' + s.id);
    const view = serverView(s);
    socket.to('u:' + me.id).emit('server:added', view);
    if (fresh) {
      socket.to('s:' + s.id).emit('member:joined', { serverId: s.id, user: pubUser(me) });
      socket.to('s:' + s.id).emit('presence', { userId: me.id, online: true });
    }
    reply(cb, {
      server: view,
      online: view.members.map((u) => u.id).filter((id) => online.has(id)),
      voice: voiceSnapshot([view]),
    });
  });

  on('server:leave', ({ serverId }, cb) => {
    const s = serverById(serverId);
    if (!s || !isMember(s.id, me.id)) return reply(cb, { error: 'Нет доступа' });
    if (s.ownerId === me.id) return reply(cb, { error: 'Владелец не может выйти — только удалить сервер' });
    for (const c of db.data.channels) if (c.serverId === s.id && c.type === 'voice') kickFromVoice(c.id, me.id);
    db.data.members = db.data.members.filter((m) => !(m.serverId === s.id && m.userId === me.id));
    db.save();
    io.in('u:' + me.id).socketsLeave('s:' + s.id);
    io.to('u:' + me.id).emit('server:removed', { serverId: s.id });
    io.to('s:' + s.id).emit('member:left', { serverId: s.id, userId: me.id });
    reply(cb, { ok: true });
  });

  on('server:delete', ({ serverId }, cb) => {
    const s = serverById(serverId);
    if (!s || s.ownerId !== me.id) return reply(cb, { error: 'Нет прав' });
    const chIds = new Set();
    for (const c of db.data.channels) {
      if (c.serverId !== s.id) continue;
      chIds.add(c.id);
      if (c.type === 'voice') kickFromVoice(c.id);
    }
    db.data.messages = db.data.messages.filter((m) => !chIds.has(m.channelId));
    db.data.channels = db.data.channels.filter((c) => c.serverId !== s.id);
    db.data.members = db.data.members.filter((m) => m.serverId !== s.id);
    db.data.servers = db.data.servers.filter((x) => x.id !== s.id);
    db.save();
    io.to('s:' + s.id).emit('server:removed', { serverId: s.id });
    io.in('s:' + s.id).socketsLeave('s:' + s.id);
    reply(cb, { ok: true });
  });

  // ----- каналы -----
  on('channel:create', ({ serverId, name, type }, cb) => {
    const s = serverById(serverId);
    if (!s || s.ownerId !== me.id) return reply(cb, { error: 'Создавать каналы может только владелец' });
    type = type === 'voice' ? 'voice' : 'text';
    name = String(name || '').trim().slice(0, 32);
    if (type === 'text') name = name.toLowerCase().replace(/\s+/g, '-');
    if (!name) return reply(cb, { error: 'Введи название' });
    if (db.data.channels.filter((c) => c.serverId === s.id).length >= 50) return reply(cb, { error: 'Слишком много каналов' });
    const c = createChannel(s.id, name, type);
    db.save();
    const view = { id: c.id, name: c.name, type: c.type };
    io.to('s:' + s.id).emit('channel:created', { serverId: s.id, channel: view });
    reply(cb, { channel: view });
  });

  on('channel:delete', ({ channelId }, cb) => {
    const c = channelById(channelId);
    const s = c && serverById(c.serverId);
    if (!s || s.ownerId !== me.id) return reply(cb, { error: 'Нет прав' });
    if (c.type === 'voice') kickFromVoice(c.id);
    db.data.messages = db.data.messages.filter((m) => m.channelId !== c.id);
    db.data.channels = db.data.channels.filter((x) => x.id !== c.id);
    db.save();
    io.to('s:' + s.id).emit('channel:deleted', { serverId: s.id, channelId: c.id });
    reply(cb, { ok: true });
  });

  on('channel:history', ({ channelId, before }, cb) => {
    const c = accessChannel(channelId);
    if (!c || c.type !== 'text') return reply(cb, { error: 'Нет доступа' });
    const list = db.data.messages.filter((m) => m.channelId === c.id && (!before || m.ts < before)).slice(-50);
    reply(cb, { messages: list.map(msgView) });
  });

  // ----- сообщения -----
  const rate = { t: 0, n: 0 };
  on('message:send', ({ channelId, text }, cb) => {
    const c = accessChannel(channelId);
    if (!c || c.type !== 'text') return reply(cb, { error: 'Нет доступа' });
    text = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!text) return reply(cb, { error: 'Пустое сообщение' });
    if (text.length > 2000) return reply(cb, { error: 'Максимум 2000 символов' });
    const now = Date.now();
    if (now - rate.t > 3000) {
      rate.t = now;
      rate.n = 0;
    }
    if (++rate.n > 8) return reply(cb, { error: 'Слишком быстро, подожди секунду' });
    const m = { id: uid(), channelId: c.id, userId: me.id, text, ts: now };
    db.data.messages.push(m);
    db.save();
    io.to('s:' + c.serverId).emit('message', msgView(m));
    reply(cb, { ok: true, id: m.id });
  });

  on('message:delete', ({ id }, cb) => {
    const i = db.data.messages.findIndex((m) => m.id === id);
    if (i < 0) return reply(cb, { error: 'Сообщение не найдено' });
    const m = db.data.messages[i];
    const c = channelById(m.channelId);
    const s = c && serverById(c.serverId);
    if (!s || !isMember(s.id, me.id) || (m.userId !== me.id && s.ownerId !== me.id)) return reply(cb, { error: 'Нет прав' });
    db.data.messages.splice(i, 1);
    db.save();
    io.to('s:' + s.id).emit('message:deleted', { id, channelId: c.id });
    reply(cb, { ok: true });
  });

  on('typing', ({ channelId }) => {
    const c = accessChannel(channelId);
    if (c) socket.to('s:' + c.serverId).emit('typing', { channelId: c.id, user: pubUser(me) });
  });

  // ----- голос -----
  on('voice:join', ({ channelId, muted }, cb) => {
    const c = accessChannel(channelId);
    if (!c || c.type !== 'voice') return reply(cb, { error: 'Нет доступа' });
    leaveVoice(socket);
    const peers = voiceList(c.id);
    if (peers.length >= MAX_VOICE) return reply(cb, { error: `Канал заполнен (максимум ${MAX_VOICE})` });
    const st = {
      socketId: socket.id,
      userId: me.id,
      username: me.username,
      color: me.color,
      muted: !!muted,
      deafened: false,
      video: false,
      screen: false,
    };
    if (!voice.has(c.id)) voice.set(c.id, new Map());
    voice.get(c.id).set(socket.id, st);
    voiceOf.set(socket.id, c.id);
    socket.to('v:' + c.id).emit('voice:peer-joined', st);
    socket.join('v:' + c.id);
    broadcastVoice(c.id);
    reply(cb, { peers });
  });

  on('voice:leave', () => leaveVoice(socket));

  on('voice:update', (p) => {
    const chId = voiceOf.get(socket.id);
    const st = chId && voice.get(chId)?.get(socket.id);
    if (!st) return;
    for (const k of ['muted', 'deafened', 'video', 'screen']) if (k in p) st[k] = !!p[k];
    broadcastVoice(chId);
  });

  // пересылка WebRTC-сигналов только между участниками одного канала
  on('voice:signal', ({ to, data }) => {
    const chId = voiceOf.get(socket.id);
    if (!chId || voiceOf.get(to) !== chId) return;
    io.to(to).emit('voice:signal', { from: socket.id, data });
  });

  socket.on('disconnect', () => {
    leaveVoice(socket);
    const n = (online.get(me.id) || 1) - 1;
    if (n <= 0) {
      online.delete(me.id);
      for (const sid of myServerIds()) io.to('s:' + sid).emit('presence', { userId: me.id, online: false });
    } else online.set(me.id, n);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Волна запущена: http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || [])
      if (a.family === 'IPv4' && !a.internal) console.log(`  В локальной сети: http://${a.address}:${PORT}`);
  if (TUNNEL) startTunnel();
  else console.log('  (для доступа из интернета запусти с --tunnel или через start.bat)\n');
});

// ---------- туннель в интернет (Cloudflare Quick Tunnel) ----------
function download(url, dest, redirects = 8) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'volna' } }, (r) => {
        if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && redirects > 0) {
          r.resume();
          return download(new URL(r.headers.location, url).href, dest, redirects - 1).then(resolve, reject);
        }
        if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
        const tmp = dest + '.part';
        const f = fs.createWriteStream(tmp);
        r.pipe(f);
        f.on('finish', () => f.close(() => { fs.renameSync(tmp, dest); resolve(); }));
        f.on('error', reject);
      })
      .on('error', reject);
  });
}

async function cloudflaredBin() {
  const exe = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const local = path.join(__dirname, 'tools', exe);
  if (fs.existsSync(local)) return local;
  if (spawnSync(process.platform === 'win32' ? 'where' : 'which', ['cloudflared']).status === 0) return 'cloudflared';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const file = { win32: `cloudflared-windows-${arch}.exe`, linux: `cloudflared-linux-${arch}` }[process.platform];
  if (!file) throw new Error('установи cloudflared вручную (brew install cloudflared)');
  console.log('  Скачиваю cloudflared (один раз)…');
  fs.mkdirSync(path.dirname(local), { recursive: true });
  await download(`https://github.com/cloudflare/cloudflared/releases/latest/download/${file}`, local);
  if (process.platform !== 'win32') fs.chmodSync(local, 0o755);
  return local;
}

async function announce(url) {
  if (!CFG.discovery) return;
  try {
    const r = await fetch(CFG.discovery, { method: 'POST', body: url, headers: { Title: 'volna-server' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    console.log('  ! Не удалось опубликовать адрес для приложений:', e.message);
  }
}

let tunnelProc = null;
async function startTunnel() {
  let bin;
  try { bin = await cloudflaredBin(); } catch (e) { console.log('  ! Туннель не запущен:', e.message); return; }
  let fails = 0;
  const run = () => {
    console.log('  Поднимаю туннель в интернет…');
    const p = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    tunnelProc = p;
    let found = false;
    const onData = (buf) => {
      const m = String(buf).match(/https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/);
      if (!m || found) return;
      found = true;
      fails = 0;
      publicUrl = m[0];
      console.log(`\n  ✅ Сервер доступен из интернета: ${publicUrl}`);
      console.log('     Приложения на телефонах подключатся сами. Не закрывай это окно.\n');
      // ссылке нужно несколько секунд, чтобы заработать — публикуем чуть позже
      setTimeout(() => announce(publicUrl), 4000);
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => console.log('  ! cloudflared:', e.message));
    p.on('exit', (code) => {
      if (tunnelProc !== p) return;
      publicUrl = null;
      const wait = Math.min(60, 5 * 2 ** fails++);
      console.log(`  Туннель остановился (код ${code}), перезапускаю через ${wait} сек… (проверь интернет)`);
      setTimeout(run, wait * 1000);
    });
  };
  run();
  // напоминаем адрес, чтобы он не пропал из кэша
  setInterval(() => { if (publicUrl) announce(publicUrl); }, 20 * 60 * 1000);
}

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    db.flush();
    const p = tunnelProc;
    tunnelProc = null;
    p?.kill();
    process.exit(0);
  });
