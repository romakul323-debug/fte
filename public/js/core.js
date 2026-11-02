'use strict';
/* =================== утилиты =================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  json(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
};
const isTouch = matchMedia('(pointer: coarse)').matches;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// В приложении (Android/iOS) страница может лежать внутри APK — тогда адрес сервера нужен отдельно
const isNative = !!(window.Capacitor && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : true));
const isShell = isNative && location.hostname === 'localhost';
const normUrl = (u) => {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
};
const FIXED = normUrl(window.VOLNA_SERVER || '');
const DISCOVERY = window.VOLNA_DISCOVERY || '';
let API = isShell ? FIXED || normUrl(store.get('serverUrl') || '') : '';
const isManual = () => isShell && store.get('serverManual') === '1';

async function fetchT(url, opts = {}, ms = 6000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}
async function discover() {
  if (!DISCOVERY) return null;
  try {
    const r = await fetchT(DISCOVERY + '/json?poll=1&since=12h');
    let url = null;
    for (const line of (await r.text()).split('\n')) {
      try {
        const m = JSON.parse(line);
        const u = String(m.message || '').trim();
        if (m.event === 'message' && /^https:\/\/[\w.-]+(:\d+)?$/.test(u)) url = u;
      } catch {}
    }
    return url;
  } catch { return null; }
}
async function resolveServer() {
  if (!isShell || FIXED || isManual()) return API;
  const found = await discover();
  if (found) { API = found; store.set('serverUrl', found); }
  return API;
}
const canScreen = !!navigator.mediaDevices?.getDisplayMedia && !isTouch;

/* =================== значки =================== */
const I = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const ICON = {
  hash: I('<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>'),
  speaker: I('<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'),
  mic: I('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/>'),
  micOff: I('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8M3 3l18 18"/>'),
  head: I('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>'),
  headOff: I('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3zM3 3l18 18"/>'),
  cam: I('<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m16 10 6-4v12l-6-4z"/>'),
  screen: I('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  hang: I('<path d="M3 15.5c5-5 13-5 18 0l-2.2 2.8-3.8-1.8v-2.6c-2-.7-4-.7-6 0v2.6l-3.8 1.8z"/>'),
  phone: I('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  userPlus: I('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/>'),
  users: I('<circle cx="9" cy="8" r="4"/><path d="M1 21a8 8 0 0 1 16 0M17 4a4 4 0 0 1 0 8M23 21a8 8 0 0 0-5-7.4"/>'),
  dots: I('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  menu: I('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  back: I('<path d="m15 18-6-6 6-6"/>'),
  expand: I('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  chev: I('<path d="m9 18 6-6-6-6"/>'),
  send: I('<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>'),
  trash: I('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>'),
  logout: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  reply: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  edit: I('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  smile: I('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>'),
  image: I('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  x: I('<path d="M18 6 6 18M6 6l12 12"/>'),
  copy: I('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  chat: I('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  user: I('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  shield: I('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  bell: I('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>'),
  palette: I('<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2c0-.5-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3a2 2 0 0 1 2-2h2.3A5.7 5.7 0 0 0 22 10c0-4.4-4.5-8-10-8z"/>'),
  wave: I('<path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/><path d="M2 17c2-4 4-4 6 0s4 4 6 0 4-4 6 0" opacity=".5"/>'),
};
const HOME_ICON = 'icons/icon-192.png';

/* =================== форматирование =================== */
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dayKey = (ts) => new Date(ts).toDateString();
function fmtDay(ts) {
  const d = new Date(ts), now = new Date(), y = new Date();
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
const fmtDate = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase() || '?';
const mediaUrl = (id) => (id ? `${API}/media/${encodeURIComponent(id)}` : '');
const dname = (u) => (u && (u.displayName || u.username)) || 'кто-то';
const STATUS_TXT = { online: 'В сети', idle: 'Не активен', dnd: 'Не беспокоить', invisible: 'Невидимка', offline: 'Не в сети' };
const safeColor = (c, d = '#5865f2') => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : d);

function avatar(u, size = '', opts = {}) {
  u = u || {};
  const ring = opts.ring !== false && u.ring && u.ring !== 'none' ? ` ring-${esc(u.ring)}` : '';
  const style = `background-color:${safeColor(u.color)};--ringc:${safeColor(u.accent || u.color)}`;
  const inner = u.avatar
    ? `<img src="${esc(mediaUrl(u.avatar))}" alt="" loading="lazy" decoding="async">`
    : esc(([...(dname(u))][0] || '?').toUpperCase());
  const st = opts.status ? `<i class="dot ${esc(opts.status)}" title="${esc(STATUS_TXT[opts.status] || '')}"></i>` : '';
  const uid = opts.click && u.id ? ` data-user="${esc(u.id)}"` : '';
  return `<span class="av ${size}${ring}" style="${style}"${uid}>${inner}${st}</span>`;
}
function nameHtml(u, opts = {}) {
  u = u || {};
  const n = u.nameStyle;
  const soft = (c) => `color:color-mix(in srgb, ${c} 58%, #ffffff)`;
  let cls = 'nm', style = soft(safeColor(u.color, '#dfe9f5'));
  if (n && n.kind === 'solid') style = soft(safeColor(n.a));
  else if (n && n.kind === 'gradient') { cls += ' grad'; style = `background-image:linear-gradient(90deg,${safeColor(n.a)},${safeColor(n.b)})`; }
  else if (n && n.kind === 'shine') { cls += ' shine'; style = `background-image:linear-gradient(90deg,${safeColor(n.a)},${safeColor(n.b)},#ffffff,${safeColor(n.a)})`; }
  if (opts.plain) style = '';
  const uid = opts.click && u.id ? ` data-user="${esc(u.id)}"` : '';
  return `<span class="${cls}" style="${style}"${uid}>${esc(dname(u))}</span>`;
}
const statusLine = (u) => (u?.customStatus ? `${esc(u.customStatus.emoji || '')} ${esc(u.customStatus.text || '')}`.trim() : '');

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

/* =================== настройки устройства =================== */
const PREF_DEF = {
  wall: 'ocean', wallImg: null, glass: 0.085, blur: 26, still: false, fontSize: 15,
  sounds: true, ringSound: true, desktop: false,
  gate: true, autoSens: true, sens: -45, ns: true, ec: true, agc: true, outVol: 1, screenQ: '1080p30', screenAudio: true,
  vol: {}, // громкость каждого участника: userId -> 0..1
};
const prefs = Object.assign({}, PREF_DEF, store.json('prefs', {}));
const savePrefs = () => store.set('prefs', JSON.stringify(prefs));

const WALLS = {
  ocean: { name: 'Океан', base: '#061026', c: ['#215ce6', '#7c42f0', '#10c4d6', '#1c78ff'] },
  aurora: { name: 'Аврора', base: '#04121a', c: ['#12b886', '#2bd9c4', '#7a5cff', '#0f6dff'] },
  sunset: { name: 'Закат', base: '#1a0718', c: ['#ff4f81', '#ff9a3c', '#8a3cff', '#ff2e63'] },
  lava: { name: 'Лава', base: '#170606', c: ['#ff3d2e', '#ff8a00', '#c2185b', '#ff5252'] },
  mint: { name: 'Мята', base: '#03140f', c: ['#2ee6a6', '#00b3ff', '#a0ff6b', '#11998e'] },
  dusk: { name: 'Сумерки', base: '#0b0820', c: ['#5b5bff', '#c86bfa', '#ff6ec7', '#3a1c71'] },
  graphite: { name: 'Графит', base: '#0b0d12', c: ['#3a4256', '#5d6b85', '#1f2633', '#8090a8'] },
};
function applyLook() {
  const r = document.documentElement.style;
  r.setProperty('--glass-a', String(prefs.glass));
  r.setProperty('--glass-blur', prefs.blur + 'px');
  r.setProperty('--fs', prefs.fontSize + 'px');
  const w = $('#wall');
  const W = WALLS[prefs.wall] || WALLS.ocean;
  w.style.setProperty('--wall-base', W.base);
  W.c.forEach((c, i) => w.style.setProperty('--w' + (i + 1), c));
  const img = prefs.wall === 'custom' && prefs.wallImg;
  w.classList.toggle('image', !!img);
  if (img) w.style.setProperty('--wall-img', `url("${img}")`);
  document.body.classList.toggle('still', !!prefs.still);
}
applyLook();

/* =================== состояние =================== */
const S = {
  token: store.get('token'),
  user: null,
  me: {},
  servers: [],
  dms: [],
  serverId: store.get('serverId') || 'home',
  channelId: null,
  presence: {},   // userId -> online/idle/dnd/offline
  users: {},      // userId -> профиль (кэш)
  voice: {},      // channelId -> [{socketId, userId, ...}]
  msgs: {},       // channelId -> [message]
  hasMore: {},
  unread: {},     // channelId -> кол-во
  mentions: {},   // channelId -> кол-во
  typing: {},     // channelId -> Map(userId -> {name, timer})
  ice: [{ urls: 'stun:stun.l.google.com:19302' }],
  focus: null,
  loading: false,
  reply: null,    // сообщение, на которое отвечаем
  editing: null,  // сообщение, которое правим
  pending: [],    // картинки, ждущие отправки
  dmView: 'chat',
};
let socket = null;

const isHome = () => S.serverId === 'home';
const curServer = () => (isHome() ? null : S.servers.find((s) => s.id === S.serverId) || null);
const dmById = (id) => S.dms.find((d) => d.id === id) || null;
const serverOfChannel = (id) => S.servers.find((s) => s.channels.some((c) => c.id === id)) || null;
const findChannel = (id) => {
  const d = dmById(id);
  if (d) return { id: d.id, type: 'dm', name: dname(S.users[d.user.id] || d.user), dm: d };
  return serverOfChannel(id)?.channels.find((c) => c.id === id) || null;
};
const curChannel = () => (S.channelId ? findChannel(S.channelId) : null);
const statusOf = (id) => (id === S.user?.id ? (S.me.status === 'invisible' ? 'offline' : S.me.status || 'online') : S.presence[id] || 'offline');
const userOf = (u) => (u && S.users[u.id]) || u;
function rememberUser(u) {
  if (!u || !u.id) return u;
  S.users[u.id] = Object.assign(S.users[u.id] || {}, u);
  return S.users[u.id];
}
function upsertServer(s) {
  s.members.forEach(rememberUser);
  const i = S.servers.findIndex((x) => x.id === s.id);
  if (i >= 0) S.servers[i] = s; else S.servers.push(s);
}
function upsertDm(d) {
  rememberUser(d.user);
  const i = S.dms.findIndex((x) => x.id === d.id);
  if (i >= 0) S.dms[i] = Object.assign(S.dms[i], d); else S.dms.push(d);
  S.dms.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
}

/* =================== звуки =================== */
let sfxCtx = null;
function sfx(kind) {
  if (typeof call !== 'undefined' && call?.native) return; // в звонке на iPhone звук ведёт приложение — не мешаем ему
  if (!prefs.sounds && kind !== 'ring') return;
  if (kind === 'ring' && !prefs.ringSound) return;
  if (S.me.status === 'dnd' && kind !== 'ring') return;
  try {
    sfxCtx = sfxCtx || new (window.AudioContext || window.webkitAudioContext)();
    sfxCtx.resume?.();
    const t = sfxCtx.currentTime;
    const notes = kind === 'ring' ? [[660, 0], [880, .18], [660, .5], [880, .68]] : kind === 'mention' ? [[880, 0], [1320, .09]] : kind === 'join' ? [[520, 0], [780, .08]] : kind === 'leave' ? [[700, 0], [440, .09]] : [[740, 0], [1100, .07]];
    for (const [f, d] of notes) {
      const o = sfxCtx.createOscillator(), g = sfxCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(kind === 'ring' ? .18 : .1, t + d + .015);
      g.gain.exponentialRampToValueAtTime(.0001, t + d + .22);
      o.connect(g).connect(sfxCtx.destination);
      o.start(t + d);
      o.stop(t + d + .25);
    }
  } catch {}
}
function notifyDesktop(title, body, tag, onClick) {
  if (!prefs.desktop || !document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, icon: HOME_ICON, silent: true });
    n.onclick = () => { window.focus(); onClick?.(); n.close(); };
  } catch {}
}

/* =================== HTTP с токеном =================== */
async function apiAuthPost(path, body, ms = 30000) {
  const r = await fetchT(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token }, body: JSON.stringify(body) }, ms);
  let d = {};
  try { d = await r.json(); } catch {}
  if (r.status === 404 && !d.error) { showOldServer(); throw new Error('Сервер не обновлён — картинки не загрузить. Перезапусти start.bat на ПК'); }
  if (!r.ok) throw new Error(d.error || 'Не получилось');
  return d;
}

// сервер на ПК не перезапустили после обновления — подсказываем, что сделать
const SERVER_NEED = 3;
function showOldServer() {
  if ($('#oldsrv') || sessionStorage.getItem('oldsrv-ok')) return;
  const el = document.createElement('div');
  el.id = 'oldsrv';
  el.className = 'oldsrv glass thin';
  el.innerHTML = `<b>Сервер не обновлён</b><span>Пока его не перезапустить, не работают картинки, личка и звонки с iPhone в фоне. На ПК с сервером: закрой чёрное окно <b>start.bat</b> и запусти его снова.</span><button class="btn sm">Понятно</button>`;
  el.querySelector('button').onclick = () => { sessionStorage.setItem('oldsrv-ok', '1'); el.remove(); };
  document.body.appendChild(el);
}

/* сжать картинку перед отправкой: GIF оставляем как есть (анимация), остальное — в JPEG/WebP */
async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
}
const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function prepImage(file, kind) {
  if (!/^image\//.test(file.type)) throw new Error('Это не картинка');
  const limits = { avatar: [512, 512, 380e3], banner: [1200, 450, 850e3], attachment: [1920, 1920, 2.4e6], wall: [1920, 1920, 1.2e6] }[kind];
  if (file.type === 'image/gif' && file.size <= limits[2] && kind !== 'wall') {
    const img = await loadImage(file);
    return { data: await blobToDataUrl(file), w: img.naturalWidth, h: img.naturalHeight };
  }
  const img = await loadImage(file);
  let w = img.naturalWidth, h = img.naturalHeight, sx = 0, sy = 0, sw = w, sh = h;
  if (kind === 'avatar') { const s = Math.min(w, h); sx = (w - s) / 2; sy = (h - s) / 2; sw = sh = s; w = h = Math.min(512, s); }
  else if (kind === 'banner') {
    const ratio = 1200 / 450;
    if (w / h > ratio) { sw = h * ratio; sx = (w - sw) / 2; } else { sh = w / ratio; sy = (h - sh) / 2; }
    w = Math.min(1200, sw); h = Math.round(w / ratio);
  } else { const k = Math.min(1, limits[0] / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k); }
  const c = document.createElement('canvas');
  c.width = Math.round(w); c.height = Math.round(h);
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const alpha = /png|webp/.test(file.type) && kind !== 'banner' && kind !== 'wall';
  let q = 0.88, data;
  if (alpha) {
    data = c.toDataURL('image/webp', q);
    if (!data.startsWith('data:image/webp') || data.length * 0.75 > limits[2]) data = c.toDataURL('image/png');
    if (data.length * 0.75 <= limits[2]) return { data, w: c.width, h: c.height };
    // слишком тяжёлая с прозрачностью — подкладываем тёмный фон и сжимаем в JPEG
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#0b1424';
    ctx.fillRect(0, 0, c.width, c.height);
  }
  do {
    data = c.toDataURL('image/jpeg', q);
    q -= 0.12;
  } while (data.length * 0.75 > limits[2] && q > 0.3);
  return { data, w: c.width, h: c.height };
}
async function uploadImage(file, kind) {
  const p = await prepImage(file, kind);
  const r = await apiAuthPost('/api/media', { kind, data: p.data }, 60000);
  return { id: r.id, w: p.w, h: p.h, preview: p.data };
}

/* =================== вход =================== */
let registerMode = false;
let authOpts = { google: false, email: false };
const authErr = (t) => { $('#authError').textContent = t || ''; };

function showAuth(err) {
  $('#app').hidden = true;
  $('#auth').hidden = false;
  if (isShell) {
    const showField = !FIXED && (isManual() || !DISCOVERY || !API);
    $('#serverField').hidden = !showField;
    $('#authServer').value = API;
    $('#serverToggle').hidden = !!FIXED;
    $('#serverToggle').textContent = showField ? 'Искать сервер автоматически' : 'Указать свой сервер';
  }
  authErr(err);
  loadAuthOptions();
}
async function loadAuthOptions() {
  if (isShell && !API) return;
  try { authOpts = await (await fetchT(API + '/api/auth/options', {}, 15000)).json(); } catch { authOpts = { google: false, email: false }; }
  $('#googleBtn').hidden = !authOpts.google;
  $('#authSeg').hidden = !authOpts.email;
  $('#authOr').hidden = !authOpts.google;
}
const isNetErr = (err) => err instanceof TypeError || err?.name === 'AbortError' || /fetch|load failed|network|abort/i.test(err?.message || '');
async function ensureApi() {
  if (isShell && !$('#serverField').hidden) {
    API = normUrl($('#authServer').value);
    if (!API) throw new Error('Укажи адрес сервера');
    store.set('serverUrl', API);
    store.set('serverManual', '1');
  } else if (isShell && !API) await resolveServer();
  if (isShell && !API) throw new Error('Сервер сейчас выключен. Попроси владельца запустить его.');
}
async function apiPost(path, body) {
  await ensureApi();
  const once = async () => {
    const r = await fetchT(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 20000);
    let d = {};
    try { d = await r.json(); } catch {}
    if (!r.ok) throw new Error(d.error || 'Сервер просыпается — попробуй ещё раз через полминуты');
    return d;
  };
  try { return await once(); }
  catch (err) {
    if (!isNetErr(err) || !isShell || FIXED || isManual()) throw err;
    const old = API;
    await resolveServer();
    if (API === old) throw err;
    return once();
  }
}
const netMsg = () => (isShell && !isManual() ? 'Сервер сейчас не в сети — попробуй через минуту.' : 'Сервер недоступен — проверь адрес и что сервер запущен');
function loggedIn(d) {
  S.token = d.token;
  store.set('token', d.token);
  start();
}
async function withBusy(btn, fn) {
  btn.disabled = true;
  authErr('');
  try { await fn(); } catch (err) { authErr(isNetErr(err) ? netMsg() : err.message); } finally { btn.disabled = false; }
}
function logout() {
  if (typeof leaveVoice === 'function') leaveVoice();
  store.set('token', null);
  socket?.disconnect();
  location.reload();
}

/* =================== подключение =================== */
let everConnected = false;
function setNet(ok, text) {
  const bar = $('#netbar');
  bar.hidden = ok;
  if (!ok) bar.querySelector('span').textContent = text || 'Нет связи с сервером, переподключаюсь…';
}
function start() {
  $('#auth').hidden = true;
  $('#app').hidden = false;
  connectSocket();
}
function connectSocket() {
  if (socket) { socket.removeAllListeners(); socket.disconnect(); }
  fetchT(API + '/api/config').then((r) => r.json()).then((c) => { S.ice = c.iceServers; S.publicUrl = c.publicUrl || null; }).catch(() => {});
  socket = io(API || undefined, { auth: { token: S.token }, reconnectionDelay: 600, reconnectionDelayMax: 4000 });
  let fails = 0, rediscovering = false;
  socket.on('connect_error', async (err) => {
    if (err.message === 'auth') { store.set('token', null); location.reload(); return; }
    fails++;
    setNet(false, everConnected ? null : 'Подключаюсь к серверу…');
    if (fails % 3 === 1 && isShell && !FIXED && !isManual() && !rediscovering) {
      rediscovering = true;
      const old = API;
      await resolveServer();
      rediscovering = false;
      if (API !== old) { connectSocket(); return; }
    }
    if (fails >= 4) setNet(false, 'Сервер не в сети. Как только его запустят, всё подключится само.');
  });
  socket.on('connect', () => { fails = 0; everConnected = true; setNet(true); socket.emit('init', onInit); });
  socket.on('disconnect', () => {
    setNet(false);
    onSocketLost();
  });
  bindSocket();
}

function onInit(d) {
  if ((d.version || 0) < SERVER_NEED) showOldServer(); else $('#oldsrv')?.remove();
  S.user = rememberUser(d.user);
  S.me = d.me || {};
  S.servers = [];
  d.servers.forEach(upsertServer);
  S.dms = [];
  (d.dms || []).forEach(upsertDm);
  S.presence = d.presence || {};
  S.voice = d.voice || {};
  S.msgs = {};
  S.hasMore = {};
  if (!isHome() && !S.servers.some((s) => s.id === S.serverId)) S.serverId = S.servers[0]?.id || 'home';
  renderUser();
  selectServer(S.serverId, S.channelId || store.get('channelId'));
  onSocketBack();
}

function bumpUnread(m) {
  const mine = m.author.id === S.user.id;
  if (mine) return;
  const here = m.channelId === S.channelId && !document.hidden;
  const mention = mentionsMe(m.text);
  const ch = findChannel(m.channelId);
  if (!here) {
    S.unread[m.channelId] = (S.unread[m.channelId] || 0) + 1;
    if (mention || ch?.type === 'dm') S.mentions[m.channelId] = (S.mentions[m.channelId] || 0) + 1;
  }
  if (!here || document.hidden) {
    if (mention || ch?.type === 'dm') sfx(mention ? 'mention' : 'msg');
    else if (!document.hidden && ch) sfx('msg');
    const where = ch?.type === 'dm' ? '' : ch ? ` · #${ch.name}` : '';
    if (ch?.type === 'dm' || mention || document.hidden)
      notifyDesktop(dname(userOf(m.author)) + where, m.text || '🖼 Картинка', m.channelId, () => openAnyChannel(m.channelId));
  }
  if (document.hidden) bumpTitle();
}
function mentionsMe(text) {
  if (!text || !S.user) return false;
  const re = new RegExp(`(^|\\s)@(${S.user.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|все|everyone)(?=$|[\\s.,!?:;])`, 'iu');
  return re.test(text);
}
let unseen = 0;
function bumpTitle() { unseen++; document.title = `(${unseen}) Волна`; }

function bindSocket() {
  socket.on('message', (m) => {
    rememberUser(m.author);
    const list = S.msgs[m.channelId];
    if (list && !list.some((x) => x.id === m.id)) list.push(m);
    clearTyping(m.channelId, m.author.id);
    const d = dmById(m.channelId);
    if (d) { d.lastTs = m.ts; S.dms.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0)); }
    if (m.channelId === S.channelId && list) {
      const box = $('#messages');
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
      renderMessages();
      if (atBottom || m.author.id === S.user.id) scrollBottom();
    }
    bumpUnread(m);
    renderServers();
    renderSidebar();
  });
  socket.on('message:updated', (m) => {
    rememberUser(m.author);
    const l = S.msgs[m.channelId];
    const i = l ? l.findIndex((x) => x.id === m.id) : -1;
    if (i >= 0) { l[i] = m; if (m.channelId === S.channelId) renderMessages(true); }
  });
  socket.on('message:deleted', ({ id, channelId }) => {
    const l = S.msgs[channelId];
    const i = l ? l.findIndex((x) => x.id === id) : -1;
    if (i >= 0) { l.splice(i, 1); if (channelId === S.channelId) renderMessages(true); }
  });
  socket.on('typing', ({ channelId, user }) => {
    if (user.id === S.user.id) return;
    rememberUser(user);
    const m = S.typing[channelId] || (S.typing[channelId] = new Map());
    clearTimeout(m.get(user.id)?.timer);
    m.set(user.id, { name: dname(user), timer: setTimeout(() => { m.delete(user.id); renderTyping(); }, 3500) });
    renderTyping();
  });
  socket.on('user:updated', (u) => {
    rememberUser(u);
    if (u.id === S.user?.id) { S.user = S.users[u.id]; renderUser(); }
    for (const s of S.servers) s.members = s.members.map((m) => (m.id === u.id ? S.users[u.id] : m));
    for (const d of S.dms) if (d.user.id === u.id) d.user = S.users[u.id];
    for (const list of Object.values(S.msgs)) for (const m of list) if (m.author.id === u.id) m.author = S.users[u.id];
    renderSidebar();
    renderMembers();
    if (curChannel() && curChannel().type !== 'voice') renderMessages(true);
    refreshOpenCard(u.id);
  });
  socket.on('presence', ({ userId, status, online }) => {
    S.presence[userId] = status || (online ? 'online' : 'offline');
    renderMembers();
    renderSidebar();
    refreshOpenCard(userId);
  });
  socket.on('dm:added', (d) => { upsertDm(d); renderSidebar(); renderServers(); });
  socket.on('server:added', (s) => { upsertServer(s); renderServers(); if (s.id === S.serverId) { renderSidebar(); renderMembers(); } });
  socket.on('server:removed', ({ serverId }) => {
    S.servers = S.servers.filter((s) => s.id !== serverId);
    if (S.serverId === serverId) selectServer('home'); else renderServers();
  });
  socket.on('member:joined', ({ serverId, user }) => {
    rememberUser(user);
    const s = S.servers.find((x) => x.id === serverId);
    if (s && !s.members.some((u) => u.id === user.id)) { s.members.push(user); if (serverId === S.serverId) renderMembers(); }
  });
  socket.on('member:left', ({ serverId, userId }) => {
    const s = S.servers.find((x) => x.id === serverId);
    if (s) { s.members = s.members.filter((u) => u.id !== userId); if (serverId === S.serverId) renderMembers(); }
  });
  socket.on('channel:created', ({ serverId, channel }) => {
    const s = S.servers.find((x) => x.id === serverId);
    if (s && !s.channels.some((c) => c.id === channel.id)) { s.channels.push(channel); if (serverId === S.serverId) renderSidebar(); }
  });
  socket.on('channel:deleted', ({ serverId, channelId }) => {
    const s = S.servers.find((x) => x.id === serverId);
    if (!s) return;
    s.channels = s.channels.filter((c) => c.id !== channelId);
    delete S.msgs[channelId];
    delete S.unread[channelId];
    if (S.channelId === channelId) openChannel(s.channels.find((c) => c.type === 'text')?.id || null, true);
    else if (serverId === S.serverId) renderSidebar();
  });
  bindVoiceSocket();
}
