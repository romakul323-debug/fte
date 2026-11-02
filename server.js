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
const HEX = /^#[0-9a-f]{6}$/i;
const RINGS = ['none', 'glow', 'neon', 'rainbow', 'aurora', 'pulse'];
const NAME_KINDS = ['solid', 'gradient', 'shine'];
const STATUSES = ['online', 'idle', 'dnd', 'invisible'];
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const hexOr = (v, d) => (HEX.test(String(v || '')) ? String(v).toLowerCase() : d);
const mediaOr = (v) => (/^[a-f0-9-]{36}$/.test(String(v || '')) ? String(v) : null);

// всё, что видят другие о пользователе
const pubUser = (u) => ({
  id: u.id,
  username: u.username,
  color: u.color,
  displayName: u.displayName || '',
  avatar: u.avatar || null,
  ring: u.ring || 'none',
  nameStyle: u.nameStyle || null,
  accent: u.accent || null,
  banner: u.banner || null,
  bio: u.bio || '',
  pronouns: u.pronouns || '',
  customStatus: u.customStatus || null,
  createdAt: u.createdAt || null,
});
const userById = (id) => db.data.users.find((u) => u.id === id);
const serverById = (id) => db.data.servers.find((s) => s.id === id);
const channelById = (id) => db.data.channels.find((c) => c.id === id);
const isMember = (serverId, userId) => db.data.members.some((m) => m.serverId === serverId && m.userId === userId);
const GONE = { id: 'gone', username: 'удалён', color: '#80848e' };

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

// личные переписки: канал типа dm на двоих
const dmOf = (a, b) => db.data.channels.find((c) => c.type === 'dm' && c.members.includes(a) && c.members.includes(b));
function dmView(c, meId) {
  const other = userById(c.members.find((x) => x !== meId) || meId) || GONE;
  return { id: c.id, type: 'dm', user: pubUser(other), lastTs: c.lastTs || c.createdAt || 0 };
}

const msgIndex = new Map(); // id -> сообщение (для ответов, правок, реакций)
function indexMessages() {
  msgIndex.clear();
  for (const m of db.data.messages) msgIndex.set(m.id, m);
}
const msgView = (m) => {
  const r = m.replyTo && msgIndex.get(m.replyTo);
  return {
    id: m.id,
    channelId: m.channelId,
    text: m.text,
    ts: m.ts,
    editedAt: m.editedAt || null,
    author: pubUser(userById(m.userId) || GONE),
    replyTo: m.replyTo
      ? r
        ? { id: r.id, authorId: r.userId, text: (r.text || (r.attachments?.length ? '🖼 Картинка' : '')).slice(0, 120) }
        : { id: m.replyTo, deleted: true }
      : null,
    attachments: m.attachments || [],
    reactions: m.reactions || {},
  };
};

// ---------- HTTP ----------
const app = express();
app.use('/api/media', express.json({ limit: '4mb' }));
app.use(express.json({ limit: '50kb' }));
// приложения Android/iOS открывают страницу со своего адреса (https://localhost, capacitor://localhost),
// поэтому API должен разрешать запросы с других источников
app.use('/api', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

// ---------- картинки ----------
const MEDIA_LIMITS = { avatar: 400e3, banner: 900e3, attachment: 2.5e6 };
const MEDIA_TYPES = { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1 };
function httpUser(req) {
  try {
    const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return userById(jwt.verify(t, SECRET).id) || null;
  } catch { return null; }
}
const uploadRate = new Map(); // userId -> [время загрузок]
app.post('/api/media', async (req, res) => {
  const u = httpUser(req);
  if (!u) return res.status(401).json({ error: 'Войди заново' });
  const kind = MEDIA_LIMITS[req.body?.kind] ? req.body.kind : 'attachment';
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(req.body?.data || ''));
  if (!m || !MEDIA_TYPES[m[1]]) return res.status(400).json({ error: 'Можно только картинки PNG, JPG, WEBP или GIF' });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MEDIA_LIMITS[kind]) return res.status(413).json({ error: 'Картинка слишком большая' });
  const now = Date.now();
  const recent = (uploadRate.get(u.id) || []).filter((t) => now - t < 60e3);
  if (recent.length >= 30) return res.status(429).json({ error: 'Слишком много загрузок, подожди минуту' });
  recent.push(now);
  uploadRate.set(u.id, recent);
  const id = uid();
  try { await db.putMedia(id, m[1], buf); } catch (e) { console.error('media', e.message); return res.status(500).json({ error: 'Не удалось сохранить' }); }
  res.json({ id, mime: m[1], size: buf.length });
});
app.get('/media/:id', async (req, res) => {
  const f = await db.getMedia(req.params.id);
  if (!f) return res.sendStatus(404);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('Access-Control-Allow-Origin', '*');
  res.type(f.mime).send(f.buf);
});

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

// соединение для звука из приложения на iPhone
const nativeWss = new (require('ws').WebSocketServer)({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
const screenWss = new (require('ws').WebSocketServer)({ noServer: true, maxPayload: 600 * 1024, perMessageDeflate: false });
server.on('upgrade', (req, sock, head) => {
  let u;
  try { u = new URL(req.url, 'http://x'); } catch { return; }
  if (u.pathname === '/ns') {
    // кадры экрана: по билету (Android) или «по заявке» (расширение iPhone не знает билета — берём ожидающий показ с того же адреса)
    let sl = screenLegs.get(u.searchParams.get('t') || '');
    if (!sl && u.searchParams.get('claim')) {
      const ip = clientIp(req);
      const waiting = [...screenLegs.values()].filter((x) => x.kind === 'ios' && !x.ws && !x.dead).sort((a, b) => b.at - a.at);
      sl = waiting.find((x) => x.ip && x.ip === ip) || (waiting.length === 1 ? waiting[0] : null);
    }
    if (!sl || sl.dead) {
      sock.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    screenWss.handleUpgrade(req, sock, head, (ws) => attachScreen(sl, ws));
    return;
  }
  if (u.pathname !== '/nv') return;
  const leg = legs.get(u.searchParams.get('t') || '');
  if (!leg || leg.dead) {
    sock.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  nativeWss.handleUpgrade(req, sock, head, (ws) => attachLeg(leg, ws));
});
setInterval(() => {
  for (const sl of screenLegs.values()) {
    const ws = sl.ws;
    if (!ws) continue;
    if (!ws.isAlive) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
  for (const leg of legByPub.values()) {
    const ws = leg.ws;
    if (!ws) continue;
    if (!ws.isAlive) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 15000).unref();

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

const SERVER_VERSION = 4;
const voiceList = (channelId) => [...(voice.get(channelId)?.values() || [])];

// «Нативный звук» (приложение на iPhone): звук звонка идёт не через WebView, а через отдельное
// WebSocket-соединение из Swift — так iOS не глушит звонок, когда приложение свёрнуто.
const legs = new Map(); // секрет -> нога звонка
const legByPub = new Map(); // публичный id ('n:…') -> нога
const legOf = new Map(); // socketId WebView -> нога
const voiceKey = (socket) => legOf.get(socket.id)?.pub || socket.id;

// статус, который видят другие: невидимка и отключённые — «не в сети»
const presenceOf = (u) => (!u || !online.has(u.id) ? 'offline' : u.status === 'invisible' ? 'offline' : STATUSES.includes(u.status) ? u.status : 'online');

// всем, кто может видеть пользователя: общие серверы и личные переписки
function audienceRooms(userId) {
  const rooms = new Set(['u:' + userId]);
  for (const m of db.data.members) if (m.userId === userId) rooms.add('s:' + m.serverId);
  for (const c of db.data.channels) if (c.type === 'dm' && c.members.includes(userId)) for (const x of c.members) rooms.add('u:' + x);
  return [...rooms];
}
function emitTo(rooms, ev, data) {
  let t = io;
  for (const r of rooms) t = t.to(r);
  t.emit(ev, data);
}
function channelRooms(c) {
  return c.type === 'dm' ? c.members.map((x) => 'u:' + x) : ['s:' + c.serverId];
}
function broadcastPresence(u) {
  emitTo(audienceRooms(u.id), 'presence', { userId: u.id, status: presenceOf(u) });
}

function voiceState(socket, u, muted, key) {
  return {
    socketId: key || socket.id,
    userId: u.id,
    username: u.username,
    displayName: u.displayName || '',
    color: u.color,
    avatar: u.avatar || null,
    ring: u.ring || 'none',
    muted: !!muted,
    deafened: false,
    video: false,
    screen: false,
  };
}

function broadcastVoice(channelId) {
  const ch = channelById(channelId);
  if (ch) emitTo(channelRooms(ch), 'voice:state', { channelId, states: voiceList(channelId) });
}

function removeVoiceEntry(chId, key) {
  const m = voice.get(chId);
  if (m) {
    m.delete(key);
    if (!m.size) voice.delete(chId);
  }
  endScreen(screenOf.get(key));
  io.to('v:' + chId).to('vw:' + chId).emit('voice:peer-left', { socketId: key });
  broadcastVoice(chId);
}

function leaveVoice(socket) {
  const chId = voiceOf.get(socket.id);
  if (!chId) return;
  voiceOf.delete(socket.id);
  const leg = legOf.get(socket.id);
  socket.leave('vw:' + chId);
  if (leg) return dropLeg(leg);
  socket.leave('v:' + chId);
  removeVoiceEntry(chId, socket.id);
}

function dropLeg(leg) {
  if (leg.dead) return;
  leg.dead = true;
  clearTimeout(leg.gone);
  legs.delete(leg.secret);
  legByPub.delete(leg.pub);
  if (leg.webSid) io.in(leg.webSid).socketsLeave('vw:' + leg.chId);
  if (leg.webSid && legOf.get(leg.webSid) === leg) {
    legOf.delete(leg.webSid);
    voiceOf.delete(leg.webSid);
  }
  try { leg.ws?.close(4000, 'left'); } catch {}
  removeVoiceEntry(leg.chId, leg.pub);
}

// звук для нативных участников канала: [длина id][id отправителя][μ-law]
function toLegs(chId, from, data) {
  let frame = null;
  for (const leg of legByPub.values()) {
    if (leg.chId !== chId || leg.pub === from || !leg.ws || leg.ws.readyState !== 1) continue;
    if (leg.ws.bufferedAmount > 48000) continue; // отстаёт — пропускаем кусочек, как volatile
    if (!frame) {
      const id = Buffer.from(from);
      frame = Buffer.concat([Buffer.from([id.length]), id, Buffer.from(data)]);
    }
    leg.ws.send(frame, { binary: true });
  }
}

// ---------- показ экрана с телефонов (JPEG-кадры) ----------
const screenLegs = new Map(); // секрет -> показ
const screenOf = new Map(); // ключ участника -> показ
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}
function endScreen(sl) {
  if (!sl || sl.dead) return;
  sl.dead = true;
  clearTimeout(sl.gone);
  screenLegs.delete(sl.secret);
  if (screenOf.get(sl.key) === sl) screenOf.delete(sl.key);
  try { sl.ws?.close(4000, 'stop'); } catch {}
  const st = voice.get(sl.chId)?.get(sl.key);
  if (st && st.frames) {
    st.frames = false;
    st.screen = false;
    st.video = false;
    broadcastVoice(sl.chId);
  }
  io.to('v:' + sl.chId).to('vw:' + sl.chId).emit('screen:end', { from: sl.key });
}
function attachScreen(sl, ws) {
  if (sl.dead) return ws.close(4000, 'stop');
  if (sl.ws) try { sl.ws.terminate(); } catch {}
  sl.ws = ws;
  clearTimeout(sl.gone);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  const st = voice.get(sl.chId)?.get(sl.key);
  if (st) {
    st.frames = true;
    st.screen = true;
    st.video = true;
    broadcastVoice(sl.chId);
  }
  let last = 0;
  ws.on('message', (data, isBinary) => {
    if (!isBinary || sl.dead || data.length < 100) return;
    const now = Date.now();
    if (now - last < 45) return; // не больше ~20 кадров в секунду
    last = now;
    let t = io.to('v:' + sl.chId).to('vw:' + sl.chId);
    if (sl.webSid) t = t.except(sl.webSid);
    t.volatile.emit('screen:frame', { from: sl.key, data });
  });
  ws.on('close', () => { if (sl.ws === ws) endScreen(sl); });
  ws.on('error', () => {});
}

function attachLeg(leg, ws) {
  if (leg.dead) return ws.close(4000, 'left');
  if (leg.ws && leg.ws !== ws) try { leg.ws.terminate(); } catch {}
  leg.ws = ws;
  ws.isAlive = true;
  clearTimeout(leg.gone);
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (data, isBinary) => {
    if (!isBinary || leg.dead || !data.length || data.length > 4096) return;
    const st = voice.get(leg.chId)?.get(leg.pub);
    if (!st || st.muted) return;
    io.to('v:' + leg.chId).volatile.emit('voice:audio', { from: leg.pub, data });
    toLegs(leg.chId, leg.pub, data);
  });
  ws.on('close', () => {
    if (leg.ws !== ws) return;
    leg.ws = null;
    // даём 25 секунд на переподключение (смена сети, туннель)
    leg.gone = setTimeout(() => dropLeg(leg), 25000);
  });
  ws.on('error', () => {});
}

function kickFromVoice(channelId, userId) {
  for (const st of voiceList(channelId)) {
    if (userId && st.userId !== userId) continue;
    const leg = legByPub.get(st.socketId);
    if (leg) {
      const sk = leg.webSid && io.sockets.sockets.get(leg.webSid);
      dropLeg(leg);
      sk?.emit('voice:kicked');
      continue;
    }
    const sk = io.sockets.sockets.get(st.socketId);
    if (sk) {
      leaveVoice(sk);
      sk.emit('voice:kicked');
    }
  }
}

function voiceSnapshot(channelIds) {
  const snap = {};
  for (const id of channelIds) if (voice.has(id)) snap[id] = voiceList(id);
  return snap;
}

const reply = (cb, v) => {
  if (typeof cb === 'function') cb(v);
};

io.on('connection', (socket) => {
  const me = socket.user;
  const on = (ev, fn) =>
    socket.on(ev, async (payload, cb) => {
      if (typeof payload === 'function') {
        cb = payload;
        payload = {};
      }
      try {
        await fn(payload || {}, cb);
      } catch (e) {
        console.error(ev, e);
        reply(cb, { error: 'Ошибка сервера' });
      }
    });
  const myServerIds = () => db.data.members.filter((m) => m.userId === me.id).map((m) => m.serverId);
  const myDms = () => db.data.channels.filter((c) => c.type === 'dm' && c.members.includes(me.id));
  // доступ к каналу: участник сервера или участник личной переписки
  const accessChannel = (id) => {
    const c = channelById(id);
    if (!c) return null;
    if (c.type === 'dm') return c.members.includes(me.id) ? c : null;
    return isMember(c.serverId, me.id) ? c : null;
  };
  const canSee = (otherId) =>
    otherId === me.id ||
    !!dmOf(me.id, otherId) ||
    db.data.members.some((m) => m.userId === otherId && isMember(m.serverId, me.id));
  const meInfo = () => ({ email: me.email || null, hasPassword: !!me.hash, google: !!me.googleId, status: me.status || 'online' });

  socket.join('u:' + me.id);
  for (const sid of myServerIds()) socket.join('s:' + sid);
  const count = (online.get(me.id) || 0) + 1;
  online.set(me.id, count);
  if (count === 1) broadcastPresence(me);

  on('init', (_, cb) => {
    const servers = myServerIds().map(serverById).filter(Boolean).map(serverView);
    const dms = myDms().map((c) => dmView(c, me.id)).sort((a, b) => b.lastTs - a.lastTs);
    const ids = new Set([me.id]);
    servers.forEach((s) => s.members.forEach((u) => ids.add(u.id)));
    dms.forEach((d) => ids.add(d.user.id));
    const presence = {};
    for (const id of ids) presence[id] = presenceOf(userById(id));
    const voiceIds = servers.flatMap((s) => s.channels.filter((c) => c.type === 'voice').map((c) => c.id)).concat(dms.map((d) => d.id));
    reply(cb, { version: SERVER_VERSION, user: pubUser(me), me: meInfo(), servers, dms, presence, voice: voiceSnapshot(voiceIds) });
  });

  // ----- профиль -----
  on('profile:update', async (p, cb) => {
    if (p.username !== undefined) {
      const username = String(p.username).trim();
      if (!NAME_RE.test(username)) return reply(cb, { error: 'Ник: 2–24 символа — буквы, цифры, _ . -' });
      if (nameTaken(username, me.id)) return reply(cb, { error: 'Такой ник уже занят' });
      me.username = username;
    }
    if (p.password !== undefined && p.password !== '') {
      if (String(p.password).length < 6) return reply(cb, { error: 'Пароль — минимум 6 символов' });
      me.hash = await bcrypt.hash(String(p.password), 10);
    }
    if (p.displayName !== undefined) me.displayName = clip(p.displayName, 32);
    if (p.bio !== undefined) me.bio = String(p.bio ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 190);
    if (p.pronouns !== undefined) me.pronouns = clip(p.pronouns, 24);
    if (p.color !== undefined) me.color = hexOr(p.color, me.color);
    if (p.accent !== undefined) me.accent = p.accent ? hexOr(p.accent, null) : null;
    if (p.ring !== undefined) me.ring = RINGS.includes(p.ring) ? p.ring : 'none';
    if (p.avatar !== undefined) me.avatar = mediaOr(p.avatar);
    if (p.nameStyle !== undefined) {
      const n = p.nameStyle || {};
      me.nameStyle = NAME_KINDS.includes(n.kind) ? { kind: n.kind, a: hexOr(n.a, me.color), b: hexOr(n.b, '#63d8ff') } : null;
    }
    if (p.banner !== undefined) {
      const b = p.banner || {};
      me.banner = b.kind === 'image' && mediaOr(b.image)
        ? { kind: 'image', image: mediaOr(b.image), a: hexOr(b.a, '#2b5cff'), b: hexOr(b.b, '#16c6d6') }
        : b.kind === 'gradient' ? { kind: 'gradient', a: hexOr(b.a, '#2b5cff'), b: hexOr(b.b, '#16c6d6') } : null;
    }
    if (p.customStatus !== undefined) {
      const c = p.customStatus || {};
      const text = clip(c.text, 60), emoji = clip(c.emoji, 8);
      me.customStatus = text || emoji ? { text, emoji } : null;
    }
    let presenceChanged = false;
    if (p.status !== undefined && STATUSES.includes(p.status) && p.status !== me.status) {
      me.status = p.status;
      presenceChanged = true;
    }
    db.save();
    for (const m of voice.values()) for (const st of m.values()) if (st.userId === me.id) Object.assign(st, { username: me.username, displayName: me.displayName || '', color: me.color, avatar: me.avatar || null, ring: me.ring || 'none' });
    const u = pubUser(me);
    emitTo(audienceRooms(me.id), 'user:updated', u);
    if (presenceChanged) broadcastPresence(me);
    for (const [chId, m] of voice) if ([...m.values()].some((st) => st.userId === me.id)) broadcastVoice(chId);
    reply(cb, { user: u, me: meInfo() });
  });

  on('user:get', ({ userId }, cb) => {
    const u = userById(userId);
    if (!u || !canSee(u.id)) return reply(cb, { error: 'Пользователь не найден' });
    reply(cb, { user: pubUser(u), status: presenceOf(u) });
  });

  // ----- личные сообщения -----
  on('dm:open', ({ userId }, cb) => {
    const other = userById(userId);
    if (!other || other.id === me.id || !canSee(other.id)) return reply(cb, { error: 'Нельзя написать этому человеку' });
    let c = dmOf(me.id, other.id);
    if (!c) {
      c = { id: uid(), type: 'dm', serverId: null, members: [me.id, other.id], createdAt: Date.now(), lastTs: Date.now() };
      db.data.channels.push(c);
      db.save();
    }
    reply(cb, { dm: dmView(c, me.id), status: presenceOf(other) });
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
      socket.to('s:' + s.id).emit('presence', { userId: me.id, status: presenceOf(me) });
    }
    const presence = {};
    for (const u of view.members) presence[u.id] = presenceOf(userById(u.id));
    reply(cb, { server: view, presence, voice: voiceSnapshot(view.channels.map((c) => c.id)) });
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

  on('server:rename', ({ serverId, name }, cb) => {
    const s = serverById(serverId);
    if (!s || s.ownerId !== me.id) return reply(cb, { error: 'Нет прав' });
    name = String(name || '').trim().slice(0, 40);
    if (!name) return reply(cb, { error: 'Введи название' });
    s.name = name;
    db.save();
    io.to('s:' + s.id).emit('server:added', serverView(s));
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
    indexMessages();
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
    indexMessages();
    db.data.channels = db.data.channels.filter((x) => x.id !== c.id);
    db.save();
    io.to('s:' + s.id).emit('channel:deleted', { serverId: s.id, channelId: c.id });
    reply(cb, { ok: true });
  });

  on('channel:history', ({ channelId, before }, cb) => {
    const c = accessChannel(channelId);
    if (!c || c.type === 'voice') return reply(cb, { error: 'Нет доступа' });
    const list = db.data.messages.filter((m) => m.channelId === c.id && (!before || m.ts < before)).slice(-50);
    reply(cb, { messages: list.map(msgView) });
  });

  // ----- сообщения -----
  const rate = { t: 0, n: 0 };
  const findMsg = (id) => {
    const m = msgIndex.get(id);
    const c = m && accessChannel(m.channelId);
    return m && c ? { m, c } : null;
  };
  const canModerate = (c) => c.type !== 'dm' && serverById(c.serverId)?.ownerId === me.id;

  on('message:send', ({ channelId, text, replyTo, attachments }, cb) => {
    const c = accessChannel(channelId);
    if (!c || c.type === 'voice') return reply(cb, { error: 'Нет доступа' });
    text = String(text || '').replace(/\r\n/g, '\n').trim();
    const att = (Array.isArray(attachments) ? attachments : [])
      .slice(0, 6)
      .map((a) => ({ id: mediaOr(a?.id), w: Math.min(8000, Math.max(1, a?.w | 0)), h: Math.min(8000, Math.max(1, a?.h | 0)) }))
      .filter((a) => a.id);
    if (!text && !att.length) return reply(cb, { error: 'Пустое сообщение' });
    if (text.length > 2000) return reply(cb, { error: 'Максимум 2000 символов' });
    const now = Date.now();
    if (now - rate.t > 3000) {
      rate.t = now;
      rate.n = 0;
    }
    if (++rate.n > 8) return reply(cb, { error: 'Слишком быстро, подожди секунду' });
    const r = replyTo && msgIndex.get(replyTo);
    const m = { id: uid(), channelId: c.id, userId: me.id, text, ts: now };
    if (r && r.channelId === c.id) m.replyTo = r.id;
    if (att.length) m.attachments = att;
    db.data.messages.push(m);
    msgIndex.set(m.id, m);
    if (c.type === 'dm') {
      const fresh = !c.lastTs || c.lastTs === c.createdAt;
      c.lastTs = now;
      // собеседник мог ещё не видеть эту переписку
      if (fresh) for (const x of c.members) if (x !== me.id) io.to('u:' + x).emit('dm:added', dmView(c, x));
    }
    db.save();
    emitTo(channelRooms(c), 'message', msgView(m));
    reply(cb, { ok: true, id: m.id });
  });

  on('message:edit', ({ id, text }, cb) => {
    const f = findMsg(id);
    if (!f || f.m.userId !== me.id) return reply(cb, { error: 'Нет прав' });
    text = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!text && !f.m.attachments?.length) return reply(cb, { error: 'Пустое сообщение' });
    if (text.length > 2000) return reply(cb, { error: 'Максимум 2000 символов' });
    if (text === f.m.text) return reply(cb, { ok: true });
    f.m.text = text;
    f.m.editedAt = Date.now();
    db.save();
    emitTo(channelRooms(f.c), 'message:updated', msgView(f.m));
    reply(cb, { ok: true });
  });

  on('message:react', ({ id, emoji }, cb) => {
    const f = findMsg(id);
    emoji = clip(emoji, 16);
    if (!f || !emoji) return reply(cb, { error: 'Нет доступа' });
    const r = (f.m.reactions = f.m.reactions || {});
    const list = r[emoji] || [];
    if (list.includes(me.id)) r[emoji] = list.filter((x) => x !== me.id);
    else {
      if (!list.length && Object.keys(r).length >= 20) return reply(cb, { error: 'Слишком много разных реакций' });
      r[emoji] = list.concat(me.id);
    }
    if (!r[emoji].length) delete r[emoji];
    db.save();
    emitTo(channelRooms(f.c), 'message:updated', msgView(f.m));
    reply(cb, { ok: true });
  });

  on('message:delete', ({ id }, cb) => {
    const f = findMsg(id);
    if (!f || (f.m.userId !== me.id && !canModerate(f.c))) return reply(cb, { error: 'Нет прав' });
    const i = db.data.messages.indexOf(f.m);
    if (i >= 0) db.data.messages.splice(i, 1);
    msgIndex.delete(id);
    db.save();
    emitTo(channelRooms(f.c), 'message:deleted', { id, channelId: f.c.id });
    reply(cb, { ok: true });
  });

  on('typing', ({ channelId }) => {
    const c = accessChannel(channelId);
    if (!c) return;
    let t = socket;
    for (const r of channelRooms(c)) t = t.to(r);
    t.emit('typing', { channelId: c.id, user: pubUser(me) });
  });

  // ----- голос (голосовые каналы и звонки в личке) -----
  on('voice:join', ({ channelId, muted, native }, cb) => {
    const c = accessChannel(channelId);
    if (!c || (c.type !== 'voice' && c.type !== 'dm')) return reply(cb, { error: 'Нет доступа' });
    leaveVoice(socket);
    const peers = voiceList(c.id);
    if (peers.length >= MAX_VOICE) return reply(cb, { error: `Канал заполнен (максимум ${MAX_VOICE})` });
    let leg = null;
    if (native) {
      leg = { secret: crypto.randomBytes(18).toString('hex'), pub: 'n:' + crypto.randomBytes(6).toString('hex'), userId: me.id, chId: c.id, webSid: socket.id, ws: null, dead: false };
      legs.set(leg.secret, leg);
      legByPub.set(leg.pub, leg);
      legOf.set(socket.id, leg);
      // приложение так и не подключило звук — убираем из канала
      leg.gone = setTimeout(() => dropLeg(leg), 25000);
    }
    const st = voiceState(socket, me, muted, leg?.pub);
    if (leg) st.native = true;
    if (!voice.has(c.id)) voice.set(c.id, new Map());
    voice.get(c.id).set(st.socketId, st);
    voiceOf.set(socket.id, c.id);
    io.to('v:' + c.id).emit('voice:peer-joined', st);
    // нативному участнику WebRTC-сигналы и звук через socket.io не нужны — звук идёт по своему соединению
    // нативному участнику (iPhone) звук через socket.io не нужен — только сигналы для видео и кадры экрана
    socket.join((leg ? 'vw:' : 'v:') + c.id);
    broadcastVoice(c.id);
    // звонок в личке: показать собеседнику входящий вызов
    if (c.type === 'dm' && !peers.length) for (const x of c.members) if (x !== me.id) io.to('u:' + x).emit('call:ring', { channelId: c.id, from: pubUser(me) });
    reply(cb, leg ? { peers, selfId: leg.pub, leg: leg.secret } : { peers });
  });

  // WebView переподключился (или перезагрузился), а звук в приложении всё это время шёл — возвращаемся к той же ноге
  on('voice:reattach', ({ leg: secret }, cb) => {
    const leg = legs.get(String(secret || ''));
    if (!leg || leg.dead || leg.userId !== me.id) return reply(cb, { error: 'gone' });
    if (leg.webSid && leg.webSid !== socket.id) {
      legOf.delete(leg.webSid);
      voiceOf.delete(leg.webSid);
    }
    leaveVoice(socket);
    leg.webSid = socket.id;
    legOf.set(socket.id, leg);
    voiceOf.set(socket.id, leg.chId);
    socket.join('vw:' + leg.chId);
    const st = voice.get(leg.chId)?.get(leg.pub);
    reply(cb, { channelId: leg.chId, selfId: leg.pub, muted: !!st?.muted, deafened: !!st?.deafened });
  });

  on('voice:leave', () => leaveVoice(socket));

  on('call:decline', ({ channelId }) => {
    const c = accessChannel(channelId);
    if (c?.type === 'dm') for (const x of c.members) if (x !== me.id) io.to('u:' + x).emit('call:declined', { channelId: c.id, by: pubUser(me) });
  });

  on('voice:update', (p) => {
    const chId = voiceOf.get(socket.id);
    const st = chId && voice.get(chId)?.get(voiceKey(socket));
    if (!st) return;
    for (const k of ['muted', 'deafened', 'video', 'screen']) if (k in p) st[k] = !!p[k];
    broadcastVoice(chId);
  });

  // запасной путь для голоса: кусочки звука пересылаются остальным в канале
  socket.on('voice:audio', (data) => {
    const chId = voiceOf.get(socket.id);
    if (!chId || !data || data.byteLength > 4096 || legOf.has(socket.id)) return;
    socket.volatile.to('v:' + chId).emit('voice:audio', { from: socket.id, data });
    toLegs(chId, socket.id, data);
  });

  // пересылка WebRTC-сигналов только между участниками одного канала
  on('voice:signal', ({ to, data }) => {
    const chId = voiceOf.get(socket.id);
    if (!chId || !voice.get(chId)?.has(to)) return;
    // участнику из приложения на iPhone — в его WebView
    const leg = legByPub.get(to);
    const target = leg ? leg.webSid : to;
    if (target) io.to(target).emit('voice:signal', { from: voiceKey(socket), data });
  });

  // показ экрана с телефона: кадры приходят по отдельному соединению из нативного кода
  on('screen:start', ({ kind } = {}, cb) => {
    const chId = voiceOf.get(socket.id);
    const key = voiceKey(socket);
    const st = chId && voice.get(chId)?.get(key);
    if (!st) return reply(cb, { error: 'Сначала зайди в голосовой канал' });
    endScreen(screenOf.get(key));
    const sl = { secret: crypto.randomBytes(18).toString('hex'), key, chId, userId: me.id, webSid: socket.id, ws: null, kind: kind === 'ios' ? 'ios' : 'android', ip: clientIp(socket.request), at: Date.now(), dead: false };
    screenLegs.set(sl.secret, sl);
    screenOf.set(key, sl);
    // ждём, пока нативная часть подключится (на iPhone пользователь ещё должен нажать «Начать трансляцию»)
    sl.gone = setTimeout(() => endScreen(sl), sl.kind === 'ios' ? 120000 : 30000);
    reply(cb, { ticket: sl.secret });
  });
  on('screen:stop', () => endScreen(screenOf.get(voiceKey(socket))));

  socket.on('disconnect', () => {
    // WebView уснул (iPhone, приложение свёрнуто), а звук в приложении работает — остаёмся в звонке
    const leg = legOf.get(socket.id);
    if (leg && leg.ws) {
      legOf.delete(socket.id);
      voiceOf.delete(socket.id);
      if (leg.webSid === socket.id) leg.webSid = null;
    } else leaveVoice(socket);
    const n = (online.get(me.id) || 1) - 1;
    if (n <= 0) {
      online.delete(me.id);
      broadcastPresence(me);
    } else online.set(me.id, n);
  });
});

// адрес сервера на хостинге (Render подставляет RENDER_EXTERNAL_URL сам)
const HOSTED_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');

db.init()
  .then(() => {
    SECRET = loadSecret();
    indexMessages();
    // старые аккаунты: статус по умолчанию
    for (const u of db.data.users) if (!u.status) u.status = 'online';
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE') console.log(`\n  ⚠ Порт ${PORT} занят — сервер уже запущен в другом окне. Закрой лишнее окно start.bat.`);
      else console.log('\n  Ошибка запуска:', e.message);
      process.exit(1);
    });
    server.listen(PORT, () => {
      console.log(`\n  Волна запущена: http://localhost:${PORT}`);
      watchSelf();
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

// ---------- самообновление на ПК: новые файлы сервера → тихий перезапуск (start.bat запускает заново) ----------
function watchSelf() {
  if (process.env.VOLNA_LOOP !== '1') return;
  const files = ['server.js', 'db.js'].map((f) => path.join(__dirname, f));
  const stamp = () => files.map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join('|');
  let last = stamp();
  let pending = null;
  setInterval(() => {
    const now = stamp();
    if (now === last) return;
    last = now;
    clearTimeout(pending);
    pending = setTimeout(restartSelf, 3000); // ждём, пока докопируются все файлы
  }, 2000).unref();
}
async function restartSelf() {
  const ok = spawnSync(process.execPath, ['--check', path.join(__dirname, 'server.js')]).status === 0;
  if (!ok) return console.log('  ⚠ Новая версия сервера с ошибкой — продолжаю работать на старой');
  console.log('\n  🔄 Пришло обновление — перезапускаю сервер…');
  const p = tunnelProc;
  tunnelProc = null;
  p?.kill();
  try { await Promise.race([db.flush(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
  process.exit(75);
}

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, async () => {
    const p = tunnelProc;
    tunnelProc = null;
    p?.kill();
    try { await Promise.race([db.flush(), new Promise((r) => setTimeout(r, 5000))]); } catch {}
    process.exit(0);
  });
