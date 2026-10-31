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
let SECRET = null; // ключ подписи входа; берётся из JWT_SECRET или хранится в базе

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // старый вариант хранения — файл data/secret.txt
  const file = path.join(db.DIR, 'secret.txt');
  if (!db.data.secret && fs.existsSync(file)) db.data.secret = fs.readFileSync(file, 'utf8').trim();
  if (!db.data.secret) db.data.secret = crypto.randomBytes(32).toString('hex');
  db.save();
  return db.data.secret;
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const SMTP_ON = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const APP_SCHEME = 'ru.volna.messenger';
app.set('trust proxy', true);

const issue = (u) => ({ token: jwt.sign({ id: u.id }, SECRET, { expiresIn: '60d' }), user: pubUser(u) });
const nameTaken = (n, exceptId) => db.data.users.some((u) => u.id !== exceptId && u.username.toLowerCase() === n.toLowerCase());
const userByEmail = (e) => db.data.users.find((u) => u.email && u.email === e);
function uniqueName(base) {
  base = String(base || '').normalize('NFKC').replace(/[^\p{L}\p{N}_.\-]+/gu, '_').replace(/^[_.-]+|[_.-]+$/g, '').slice(0, 20);
  if (base.length < 2) base = 'user';
  let n = base, i = 1;
  while (nameTaken(n)) n = `${base}_${++i}`;
  return n;
}
function createUser({ username, hash = null, email = null, googleId = null }) {
  const user = { id: uid(), username, hash, email, googleId, color: COLORS[crypto.randomInt(COLORS.length)], createdAt: Date.now() };
  db.data.users.push(user);
  db.save();
  return user;
}

// какие способы входа включены на этом сервере
app.get('/api/auth/options', (req, res) => res.json({ google: !!(GOOGLE_ID && GOOGLE_SECRET), email: SMTP_ON }));

// ----- ник и пароль -----
app.post('/api/register', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!NAME_RE.test(username)) return res.status(400).json({ error: 'Ник: 2–24 символа — буквы, цифры, _ . -' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль — минимум 6 символов' });
  if (nameTaken(username)) return res.status(409).json({ error: 'Такой ник уже занят' });
  const user = createUser({ username, hash: await bcrypt.hash(password, 10) });
  res.json(issue(user));
});

app.post('/api/login', async (req, res) => {
  const login = String(req.body?.username || '').trim().toLowerCase();
  const user = db.data.users.find((u) => u.username.toLowerCase() === login || (u.email && u.email === login));
  if (user && !user.hash) return res.status(401).json({ error: 'У этого аккаунта нет пароля — войди через Google или по коду на почту' });
  if (!user || !(await bcrypt.compare(String(req.body?.password || ''), user.hash)))
    return res.status(401).json({ error: 'Неверный ник или пароль' });
  res.json(issue(user));
});

// ----- код на почту -----
const emailCodes = new Map(); // email -> { hash, exp, tries, sentAt }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let mailer = null;
function getMailer() {
  if (!mailer) {
    const port = Number(process.env.SMTP_PORT) || 465;
    mailer = require('nodemailer').createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return mailer;
}

app.post('/api/email/send', async (req, res) => {
  if (!SMTP_ON) return res.status(503).json({ error: 'Вход по коду на этом сервере пока не включён' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Проверь адрес почты' });
  const prev = emailCodes.get(email);
  if (prev && Date.now() - prev.sentAt < 60e3) return res.status(429).json({ error: 'Новый код можно запросить через минуту' });
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  emailCodes.set(email, { hash: sha(email + code), exp: Date.now() + 10 * 60e3, tries: 0, sentAt: Date.now() });
  try {
    await getMailer().sendMail({
      from: process.env.SMTP_FROM || `Волна <${process.env.SMTP_USER}>`,
      to: email,
      subject: `${code} — код для входа в Волну`,
      text: `Твой код для входа: ${code}\n\nОн действует 10 минут. Если ты не запрашивал код — просто проигнорируй письмо.`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:16px;color:#111">
        <p>Твой код для входа в Волну:</p>
        <p style="font-size:34px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>
        <p style="color:#666">Код действует 10 минут. Если ты не запрашивал его — просто проигнорируй письмо.</p></div>`,
    });
  } catch (e) {
    emailCodes.delete(email);
    console.error('  ! Почта:', e.message);
    return res.status(502).json({ error: 'Не удалось отправить письмо, попробуй позже' });
  }
  res.json({ ok: true, exists: !!userByEmail(email) });
});

app.post('/api/email/verify', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').replace(/\D/g, '');
  const e = emailCodes.get(email);
  if (!e || e.exp < Date.now()) return res.status(400).json({ error: 'Код устарел — запроси новый' });
  if (e.tries >= 5) { emailCodes.delete(email); return res.status(429).json({ error: 'Слишком много попыток — запроси новый код' }); }
  if (sha(email + code) !== e.hash) { e.tries++; return res.status(400).json({ error: 'Неверный код' }); }
  let user = userByEmail(email);
  if (!user) {
    const username = String(req.body?.username || '').trim();
    if (!username) return res.json({ needUsername: true });
    if (!NAME_RE.test(username)) return res.status(400).json({ error: 'Ник: 2–24 символа — буквы, цифры, _ . -' });
    if (nameTaken(username)) return res.status(409).json({ error: 'Такой ник уже занят' });
    user = createUser({ username, email });
  }
  emailCodes.delete(email);
  res.json(issue(user));
});

// ----- Google -----
const oauthStates = new Map(); // state -> { app, exp }
const loginCodes = new Map(); // одноразовый код -> { userId, exp }
const baseUrl = (req) => HOSTED_URL || publicUrl || `${req.protocol}://${req.get('host')}`;
const resultPage = (title, body, target) => `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">${target ? `<meta http-equiv="refresh" content="0;url=${target}">` : ''}
<title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1a2e;color:#e8f4ff;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}
a{display:inline-block;margin-top:16px;padding:12px 22px;border-radius:999px;background:#63d8ff;color:#04202e;font-weight:700;text-decoration:none}</style></head>
<body><div><h2>${title}</h2><p>${body}</p>${target ? `<a href="${target}">Вернуться в Волну</a><script>location.replace(${JSON.stringify(target)})</script>` : ''}</div></body></html>`;

app.get('/auth/google', (req, res) => {
  if (!GOOGLE_ID || !GOOGLE_SECRET) return res.status(503).send(resultPage('Вход через Google не включён', 'Владелец сервера ещё не подключил Google.'));
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, { app: req.query.app === '1', exp: Date.now() + 10 * 60e3 });
  const q = new URLSearchParams({
    client_id: GOOGLE_ID,
    redirect_uri: baseUrl(req) + '/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q);
});

app.get('/auth/google/callback', async (req, res) => {
  const st = oauthStates.get(String(req.query.state || ''));
  oauthStates.delete(String(req.query.state || ''));
  if (!st || st.exp < Date.now() || !req.query.code) return res.status(400).send(resultPage('Ссылка устарела', 'Попробуй войти ещё раз.'));
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: GOOGLE_ID,
        client_secret: GOOGLE_SECRET,
        redirect_uri: baseUrl(req) + '/auth/google/callback',
        grant_type: 'authorization_code',
      }),
    });
    const t = await r.json();
    if (!t.id_token) throw new Error(t.error_description || t.error || 'Google не вернул данные');
    // id_token получен напрямую от Google по HTTPS — проверяем получателя и издателя
    const p = JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString());
    if (p.aud !== GOOGLE_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(p.iss)) throw new Error('неверный ответ Google');
    const email = p.email && p.email_verified ? String(p.email).toLowerCase() : null;
    let user = db.data.users.find((u) => u.googleId === p.sub) || (email && userByEmail(email));
    if (!user) user = createUser({ username: uniqueName(p.given_name || p.name || (email || '').split('@')[0]), email, googleId: p.sub });
    else if (!user.googleId) { user.googleId = p.sub; if (!user.email && email) user.email = email; db.save(); }
    const code = crypto.randomBytes(24).toString('hex');
    loginCodes.set(code, { userId: user.id, exp: Date.now() + 2 * 60e3 });
    const target = st.app ? `${APP_SCHEME}://auth?code=${code}` : `/#login=${code}`;
    res.send(resultPage('Готово!', 'Возвращаемся в Волну…', target));
  } catch (e) {
    console.error('  ! Google:', e.message);
    res.status(500).send(resultPage('Не получилось войти', 'Google не подтвердил вход. Попробуй ещё раз.'));
  }
});

app.post('/api/oauth/exchange', (req, res) => {
  const code = String(req.body?.code || '');
  const c = loginCodes.get(code);
  loginCodes.delete(code);
  const user = c && c.exp > Date.now() && userById(c.userId);
  if (!user) return res.status(401).json({ error: 'Вход устарел — попробуй ещё раз' });
  res.json(issue(user));
});

// чистим просроченные коды
setInterval(() => {
  const now = Date.now();
  for (const m of [emailCodes, oauthStates, loginCodes]) for (const [k, v] of m) if (v.exp < now) m.delete(k);
}, 5 * 60e3).unref();

// STUN/TURN для звонков. TURN задаётся переменными окружения (см. README).
app.get('/api/config', (req, res) => {
  const iceServers = [];
  // свой TURN (coturn с общим секретом): временные логины на сутки, без хранения паролей
  if (process.env.TURN_SECRET && process.env.TURN_HOST) {
    const h = process.env.TURN_HOST;
    const username = `${Math.floor(Date.now() / 1000) + 24 * 3600}:volna`;
    const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    iceServers.push({ urls: [`stun:${h}:3478`] });
    iceServers.push({ urls: [`turn:${h}:3478?transport=udp`, `turn:${h}:3478?transport=tcp`], username, credential });
  }
  iceServers.push({ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] });
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
      me: { email: me.email || null, hasPassword: !!me.hash, google: !!me.googleId },
      servers,
      online: [...ids].filter((id) => online.has(id)),
      voice: voiceSnapshot(servers),
    });
  });

  // ----- профиль -----
  on('profile:update', async ({ username, password }, cb) => {
    if (username !== undefined) {
      username = String(username).trim();
      if (!NAME_RE.test(username)) return reply(cb, { error: 'Ник: 2–24 символа — буквы, цифры, _ . -' });
      if (nameTaken(username, me.id)) return reply(cb, { error: 'Такой ник уже занят' });
      me.username = username;
      for (const m of voice.values()) for (const st of m.values()) if (st.userId === me.id) st.username = username;
    }
    if (password !== undefined && password !== '') {
      if (String(password).length < 6) return reply(cb, { error: 'Пароль — минимум 6 символов' });
      me.hash = await bcrypt.hash(String(password), 10);
    }
    db.save();
    const u = pubUser(me);
    io.to('u:' + me.id).emit('user:updated', u);
    for (const sid of myServerIds()) io.to('s:' + sid).emit('user:updated', u);
    for (const [chId, m] of voice) if ([...m.values()].some((st) => st.userId === me.id)) broadcastVoice(chId);
    reply(cb, { user: u, me: { email: me.email || null, hasPassword: !!me.hash, google: !!me.googleId } });
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

  // запасной путь для голоса: кусочки звука пересылаются остальным в канале
  socket.on('voice:audio', (data) => {
    const chId = voiceOf.get(socket.id);
    if (!chId || !data || data.byteLength > 4096) return;
    socket.volatile.to('v:' + chId).emit('voice:audio', { from: socket.id, data });
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

// адрес сервера на хостинге (Render подставляет RENDER_EXTERNAL_URL сам)
const HOSTED_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');

db.init()
  .then(() => {
    SECRET = loadSecret();
    server.listen(PORT, () => {
      console.log(`\n  Волна запущена: http://localhost:${PORT}`);
      if (HOSTED_URL) return startHosted();
      for (const list of Object.values(os.networkInterfaces()))
        for (const a of list || [])
          if (a.family === 'IPv4' && !a.internal) console.log(`  В локальной сети: http://${a.address}:${PORT}`);
      if (TUNNEL) startTunnel();
      else console.log('  (для доступа из интернета запусти с --tunnel или через start.bat)\n');
    });
  })
  .catch((e) => {
    console.error('  ! Не удалось открыть базу данных:', e.message);
    process.exit(1);
  });

// ---------- режим хостинга ----------
function startHosted() {
  publicUrl = HOSTED_URL;
  console.log(`  Публичный адрес: ${publicUrl}`);
  setTimeout(() => announce(publicUrl), 3000);
  setInterval(() => announce(publicUrl), 20 * 60 * 1000);
  // бесплатный Render засыпает через 15 минут тишины — не даём ему уснуть
  if (process.env.KEEP_AWAKE !== '0') {
    setInterval(() => {
      fetch(publicUrl + '/api/config').catch(() => {});
    }, 10 * 60 * 1000);
  }
}

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

// ---------- Tuna (российский туннель, бесплатный постоянный адрес, работает без VPN) ----------
const TUNA_FILE = path.join(db.DIR, 'tuna.json');
function tunaConfig() {
  const fixedDomain = CFG.tunaDomain || process.env.TUNA_DOMAIN || '';
  let c = null;
  if (process.env.TUNA_API_KEY) c = { apiKey: process.env.TUNA_API_KEY, subdomain: process.env.TUNA_SUBDOMAIN || '' };
  else try { c = JSON.parse(fs.readFileSync(TUNA_FILE, 'utf8')); } catch {}
  if (c && fixedDomain && !c.subdomain) c.subdomain = fixedDomain;
  return c;
}
function ask(q) {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); resolve(a.trim()); });
  });
}
async function setupTuna() {
  let cfg = tunaConfig();
  if (cfg || !process.stdin.isTTY) return cfg;
  console.log('\n  Постоянный адрес без VPN даёт Tuna (tuna.am), бесплатно.');
  console.log('  1) Зарегистрируйся на https://tuna.am  2) скопируй API-ключ из личного кабинета (начинается с tak_)');
  console.log('  3) скопируй имя бесплатного постоянного поддомена из личного кабинета.\n');
  const apiKey = await ask('  Вставь API-ключ Tuna (правый клик в этом окне = вставить) и нажми Enter: ');
  if (!apiKey) return null; // спросим снова при следующем запуске
  const subdomain = CFG.tunaDomain || (await ask('  Постоянный домен из кабинета Tuna (Enter — без него, адрес будет меняться): '));
  cfg = { apiKey, subdomain };
  fs.writeFileSync(TUNA_FILE, JSON.stringify(cfg));
  console.log('  Сохранено в data/tuna.json\n');
  return cfg;
}
async function tunaBin() {
  const exe = process.platform === 'win32' ? 'tuna.exe' : 'tuna';
  const local = path.join(__dirname, 'tools', exe);
  if (fs.existsSync(local)) return local;
  if (spawnSync(process.platform === 'win32' ? 'where' : 'which', ['tuna']).status === 0) return 'tuna';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const dir = path.join(__dirname, 'tools');
  fs.mkdirSync(dir, { recursive: true });
  console.log('  Скачиваю Tuna (один раз)…');
  if (process.platform === 'win32') {
    const zip = path.join(dir, 'tuna.zip');
    await download(`https://releases.tuna.am/tuna/latest/tuna_windows_${arch}.zip`, zip);
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path '${zip}' -DestinationPath '${dir}'`], { stdio: 'inherit' });
    fs.rmSync(zip, { force: true });
    if (r.status !== 0) throw new Error('не удалось распаковать Tuna');
  } else if (process.platform === 'linux') {
    const tgz = path.join(dir, 'tuna.tgz');
    await download(`https://releases.tuna.am/tuna/latest/tuna_linux_${arch}.tar.gz`, tgz);
    spawnSync('tar', ['-xzf', tgz, '-C', dir], { stdio: 'inherit' });
    fs.rmSync(tgz, { force: true });
    fs.chmodSync(local, 0o755);
  } else throw new Error('установи Tuna вручную: https://tuna.am');
  if (!fs.existsSync(local)) throw new Error('Tuna не нашёлся после распаковки');
  return local;
}

let tunnelProc = null;
async function startTunnel() {
  // что запускаем: Tuna (если настроен) или временный туннель Cloudflare
  let t = null;
  const tuna = await setupTuna();
  if (tuna && tuna.apiKey) {
    try {
      const bin = await tunaBin();
      const args = ['http', String(PORT)];
      // полное имя (xxx.a.tuna.free / xxx.ru.tuna.am) — через --domain, просто имя — через --subdomain
      if (tuna.subdomain) args.push(tuna.subdomain.includes('.') ? `--domain=${tuna.subdomain}` : `--subdomain=${tuna.subdomain}`);
      t = { name: 'Tuna', bin, args, env: { ...process.env, TUNA_API_KEY: tuna.apiKey }, re: tuna.subdomain && tuna.subdomain.includes('.') ? new RegExp('(?:https://)?' + tuna.subdomain.replace(/\./g, '\\.')) : /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+(?:\.[a-z0-9-]+)*\.tuna\.(?:am|free)\b/ };
    } catch (e) {
      console.log('  ! Tuna не запустился:', e.message, '— беру Cloudflare');
    }
  }
  if (!t) {
    try {
      const bin = await cloudflaredBin();
      t = { name: 'Cloudflare', bin, args: ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], env: process.env, re: /https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/ };
    } catch (e) { console.log('  ! Туннель не запущен:', e.message); return; }
  }
  let fails = 0;
  const run = () => {
    console.log(`  Поднимаю туннель в интернет (${t.name})…`);
    const p = spawn(t.bin, t.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: t.env });
    tunnelProc = p;
    let found = false;
    const onData = (buf) => {
      const m = String(buf).match(t.re);
      if (!m || found) return;
      found = true;
      fails = 0;
      publicUrl = m[0].startsWith('http') ? m[0] : 'https://' + m[0];
      console.log(`\n  ✅ Сервер доступен из интернета: ${publicUrl}`);
      console.log('     Не закрывай это окно — пока оно открыто, Волна работает.\n');
      setTimeout(() => announce(publicUrl), 4000);
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => console.log(`  ! ${t.name}:`, e.message));
    p.on('exit', (code) => {
      if (tunnelProc !== p) return;
      publicUrl = null;
      const wait = Math.min(60, 5 * 2 ** fails++);
      console.log(`  Туннель остановился (код ${code}), перезапускаю через ${wait} сек… (проверь интернет)`);
      setTimeout(run, wait * 1000);
    });
  };
  run();
  setInterval(() => { if (publicUrl) announce(publicUrl); }, 20 * 60 * 1000);
}

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, async () => {
    const p = tunnelProc;
    tunnelProc = null;
    p?.kill();
    try { await Promise.race([db.flush(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
    process.exit(0);
  });
