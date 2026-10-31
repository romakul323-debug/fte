'use strict';
/* =================== утилиты =================== */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const isTouch = matchMedia('(pointer: coarse)').matches;
// В приложении (Android/iOS) страница лежит внутри APK, поэтому адрес сервера вводится вручную
const isNative = !!(window.Capacitor && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : true));
const normUrl = (u) => {
  u = String(u || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
};
let API = isNative ? normUrl(store.get('serverUrl') || window.VOLNA_SERVER || '') : '';
const canScreen = !!navigator.mediaDevices?.getDisplayMedia && !isTouch;

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
  send: I('<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>'),
  trash: I('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>'),
  logout: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
};

const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dayKey = (ts) => new Date(ts).toDateString();
function fmtDay(ts) {
  const d = new Date(ts), now = new Date(), y = new Date();
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase() || '?';
function avatar(u, size = '', dot) {
  const letter = esc(([...(u.username || '?')][0] || '?').toUpperCase());
  const d = dot === undefined ? '' : `<i class="dot ${dot ? 'on' : ''}"></i>`;
  return `<span class="av ${size}" style="background:${esc(u.color)}">${letter}${d}</span>`;
}
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

/* =================== состояние =================== */
const S = {
  token: store.get('token'),
  user: null,
  servers: [],
  serverId: store.get('serverId'),
  channelId: null,
  online: new Set(),
  voice: {},      // channelId -> [{socketId, userId, username, muted, ...}]
  msgs: {},       // channelId -> [message]
  hasMore: {},
  unread: new Set(),
  typing: {},     // channelId -> Map(userId -> {name, timer})
  ice: [{ urls: 'stun:stun.l.google.com:19302' }],
  focus: null,
  loading: false,
};
let socket = null;
let call = null;              // текущий звонок
const peers = new Map();      // socketId -> peer
let audioCtx = null;
const meters = new Map();     // socketId -> анализатор громкости

const curServer = () => S.servers.find((s) => s.id === S.serverId) || null;
const curChannel = () => curServer()?.channels.find((c) => c.id === S.channelId) || null;
const serverOfChannel = (id) => S.servers.find((s) => s.channels.some((c) => c.id === id)) || null;
const findChannel = (id) => serverOfChannel(id)?.channels.find((c) => c.id === id) || null;
function upsertServer(s) {
  const i = S.servers.findIndex((x) => x.id === s.id);
  if (i >= 0) S.servers[i] = s; else S.servers.push(s);
}

/* =================== вход =================== */
let registerMode = false;
function showAuth(err) {
  $('#app').hidden = true;
  $('#auth').hidden = false;
  if (isNative) { $('#serverField').hidden = false; $('#authServer').value = API; }
  if (err) $('#authError').textContent = err;
}
$('#authToggle').onclick = () => {
  registerMode = !registerMode;
  $('#authSub').textContent = registerMode ? 'Создать аккаунт' : 'Вход в аккаунт';
  $('#authSubmit').textContent = registerMode ? 'Зарегистрироваться' : 'Войти';
  $('#authToggle').textContent = registerMode ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
  $('#authPass').autocomplete = registerMode ? 'new-password' : 'current-password';
  $('#authError').textContent = '';
};
$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#authSubmit');
  btn.disabled = true;
  $('#authError').textContent = '';
  try {
    if (isNative) {
      API = normUrl($('#authServer').value);
      if (!API) throw new Error('Укажи адрес сервера');
      store.set('serverUrl', API);
    }
    const r = await fetch(API + '/api/' + (registerMode ? 'register' : 'login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#authUser').value, password: $('#authPass').value }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Ошибка');
    S.token = d.token;
    store.set('token', d.token);
    start();
  } catch (err) {
    const net = err instanceof TypeError || /fetch|load failed|network/i.test(err.message);
    $('#authError').textContent = net ? 'Сервер недоступен — проверь адрес и что сервер запущен' : err.message;
  } finally {
    btn.disabled = false;
  }
};
function logout() {
  leaveVoice();
  store.set('token', null);
  socket?.disconnect();
  location.reload();
}

/* =================== подключение =================== */
async function start() {
  $('#auth').hidden = true;
  $('#app').hidden = false;
  try { S.ice = (await (await fetch(API + '/api/config')).json()).iceServers; } catch {}
  socket = io(API || undefined, { auth: { token: S.token } });
  // если сервер так и не ответил (например, сменилась ссылка туннеля) — даём поменять адрес
  setTimeout(() => {
    if (S.user || !socket || socket.connected) return;
    socket.disconnect();
    socket = null;
    showAuth('Не удалось подключиться к серверу. Проверь адрес и войди заново.');
  }, 10000);
  socket.on('connect_error', (err) => {
    if (err.message === 'auth') { store.set('token', null); location.reload(); }
  });
  socket.on('connect', () => socket.emit('init', onInit));
  socket.on('disconnect', () => {
    if (call) { cleanupCall(); toast('Связь с сервером потеряна — звонок завершён'); }
  });
  bindSocket();
}

function onInit(d) {
  S.user = d.user;
  S.servers = d.servers;
  S.online = new Set(d.online);
  S.voice = d.voice || {};
  S.msgs = {};
  S.hasMore = {};
  if (!S.servers.some((s) => s.id === S.serverId)) S.serverId = S.servers[0]?.id || null;
  renderUser();
  selectServer(S.serverId, S.channelId || store.get('channelId'));
}

function bindSocket() {
  socket.on('message', (m) => {
    const list = S.msgs[m.channelId];
    if (list && !list.some((x) => x.id === m.id)) list.push(m);
    clearTyping(m.channelId, m.author.id);
    const mine = m.author.id === S.user.id;
    if (m.channelId === S.channelId && list) {
      const box = $('#messages');
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 150;
      renderMessages();
      if (atBottom || mine) scrollBottom();
    } else if (!mine) {
      S.unread.add(m.channelId);
      renderSidebar();
      renderServers();
    }
    if (document.hidden && !mine) bumpTitle();
  });
  socket.on('message:deleted', ({ id, channelId }) => {
    const l = S.msgs[channelId];
    const i = l ? l.findIndex((x) => x.id === id) : -1;
    if (i >= 0) { l.splice(i, 1); if (channelId === S.channelId) renderMessages(); }
  });
  socket.on('typing', ({ channelId, user }) => {
    if (user.id === S.user.id) return;
    const m = S.typing[channelId] || (S.typing[channelId] = new Map());
    clearTimeout(m.get(user.id)?.timer);
    m.set(user.id, { name: user.username, timer: setTimeout(() => { m.delete(user.id); renderTyping(); }, 3500) });
    renderTyping();
  });
  socket.on('presence', ({ userId, online }) => {
    online ? S.online.add(userId) : S.online.delete(userId);
    renderMembers();
  });
  socket.on('server:added', (s) => { upsertServer(s); renderServers(); });
  socket.on('server:removed', ({ serverId }) => {
    S.servers = S.servers.filter((s) => s.id !== serverId);
    if (S.serverId === serverId) selectServer(S.servers[0]?.id || null); else renderServers();
  });
  socket.on('member:joined', ({ serverId, user }) => {
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
    S.unread.delete(channelId);
    if (S.channelId === channelId) openChannel(s.channels.find((c) => c.type === 'text')?.id || null, true);
    else if (serverId === S.serverId) renderSidebar();
  });
  socket.on('voice:state', ({ channelId, states }) => {
    S.voice[channelId] = states;
    if (serverOfChannel(channelId)?.id === S.serverId) renderSidebar();
    if (S.channelId === channelId) renderTiles();
  });
  socket.on('voice:peer-joined', (st) => { if (call) ensurePeer(st.socketId); });
  socket.on('voice:peer-left', ({ socketId }) => closePeer(socketId));
  socket.on('voice:signal', ({ from, data }) => { if (call) onSignal(from, data); });
  socket.on('voice:kicked', () => { cleanupCall(); toast('Ты отключён от голосового канала'); });
}

/* =================== навигация =================== */
function selectServer(id, chId) {
  S.serverId = id;
  store.set('serverId', id);
  S.focus = null;
  const s = curServer();
  renderServers();
  if (!s) { S.channelId = null; renderAll(); return; }
  const ch = s.channels.find((c) => c.id === chId) || s.channels.find((c) => c.type === 'text');
  openChannel(ch?.id || null, true);
}

function openChannel(id, silent) {
  S.channelId = id;
  store.set('channelId', id);
  S.unread.delete(id);
  S.focus = null;
  renderAll();
  const ch = curChannel();
  if (ch?.type === 'text' && !S.msgs[id]) loadHistory(id);
  if (!silent) closeDrawer();
}

function renderAll() { renderServers(); renderSidebar(); renderMain(); renderMembers(); }

function loadHistory(chId, older) {
  const list = S.msgs[chId];
  const before = older && list?.length ? list[0].ts : undefined;
  if (S.loading) return;
  S.loading = true;
  socket.emit('channel:history', { channelId: chId, before }, (res) => {
    S.loading = false;
    if (res?.error) return toast(res.error);
    const box = $('#messages');
    const prevH = box.scrollHeight, prevTop = box.scrollTop;
    S.msgs[chId] = before ? res.messages.concat(S.msgs[chId] || []) : res.messages;
    S.hasMore[chId] = res.messages.length === 50;
    if (S.channelId !== chId) return;
    renderMessages();
    if (before) box.scrollTop = box.scrollHeight - prevH + prevTop; else scrollBottom();
  });
}

/* =================== отрисовка =================== */
function renderServers() {
  const unreadSrv = new Set([...S.unread].map((id) => serverOfChannel(id)?.id));
  $('#servers').innerHTML =
    S.servers.map((s) => `<button class="srv ${s.id === S.serverId ? 'active' : ''}" data-srv="${s.id}" title="${esc(s.name)}">${unreadSrv.has(s.id) && s.id !== S.serverId ? '<i class="pip"></i>' : ''}${esc(initials(s.name))}</button>`).join('') +
    `${S.servers.length ? '<div class="srv-sep"></div>' : ''}<button class="srv add" data-act="add-server" title="Создать или вступить">${ICON.plus}</button>`;
}

function renderSidebar() {
  const s = curServer();
  if (!s) {
    $('#serverHeader').innerHTML = '<span class="srv-name">Волна</span>';
    $('#channels').innerHTML = `<div class="hint">Создай свой сервер или вступи по коду приглашения от друга.<button class="btn primary" data-act="add-server">Начать</button></div>`;
    renderVoicePanel();
    return;
  }
  const owner = s.ownerId === S.user.id;
  $('#serverHeader').innerHTML = `<span class="srv-name">${esc(s.name)}</span>
    <button class="icon-btn" data-act="invite" title="Пригласить">${ICON.userPlus}</button>
    <button class="icon-btn" data-act="server-menu" title="Настройки сервера">${ICON.dots}</button>`;
  const cat = (title, type) => `<div class="ch-cat"><span>${title}</span>${owner ? `<button class="icon-btn sm" data-act="new-channel" data-type="${type}" title="Создать канал">${ICON.plus}</button>` : ''}</div>`;
  let h = cat('Текстовые каналы', 'text');
  for (const c of s.channels.filter((c) => c.type === 'text'))
    h += `<button class="ch ${c.id === S.channelId ? 'active' : ''} ${S.unread.has(c.id) ? 'unread' : ''}" data-ch="${c.id}">${ICON.hash}<span>${esc(c.name)}</span></button>`;
  h += cat('Голосовые каналы', 'voice');
  for (const c of s.channels.filter((c) => c.type === 'voice')) {
    const st = S.voice[c.id] || [];
    h += `<button class="ch ${c.id === S.channelId ? 'active' : ''} ${call?.channelId === c.id ? 'connected' : ''}" data-ch="${c.id}">${ICON.speaker}<span>${esc(c.name)}</span>${st.length ? `<em class="cnt">${st.length}</em>` : ''}</button>`;
    if (st.length)
      h += `<div class="vc-users">${st.map((u) => `<div class="vc-user ${meters.get(u.socketId)?.speaking ? 'speaking' : ''}" data-speak="${u.socketId}">${avatar(u, 'xs')}<span>${esc(u.username)}</span>${u.video ? `<b class="tag">${u.screen ? 'ЭКРАН' : 'КАМ'}</b>` : ''}${u.deafened ? ICON.headOff : u.muted ? ICON.micOff : ''}</div>`).join('')}</div>`;
  }
  $('#channels').innerHTML = h;
  renderVoicePanel();
}

function ctlButtons() {
  return `<button class="ctl ${call.muted ? 'off' : ''}" data-act="mute" title="Микрофон">${call.muted ? ICON.micOff : ICON.mic}</button>
    <button class="ctl ${call.deafened ? 'off' : ''}" data-act="deafen" title="Звук">${call.deafened ? ICON.headOff : ICON.head}</button>
    <button class="ctl ${call.video && !call.screen ? 'on' : ''}" data-act="camera" title="Камера">${ICON.cam}</button>
    ${canScreen ? `<button class="ctl ${call.screen ? 'on' : ''}" data-act="screen" title="Демонстрация экрана">${ICON.screen}</button>` : ''}`;
}

function renderVoicePanel() {
  const p = $('#voicePanel');
  if (!call) { p.hidden = true; return; }
  const ch = findChannel(call.channelId);
  const s = serverOfChannel(call.channelId);
  p.hidden = false;
  p.innerHTML = `<div class="vp-top"><div class="vp-status" data-act="open-call"><b>Голос подключён</b><span>${esc(ch?.name || '')} / ${esc(s?.name || '')}</span></div>
    <button class="icon-btn" data-act="leave" title="Отключиться" style="color:var(--red)">${ICON.hang}</button></div>
    <div class="vp-ctl">${ctlButtons()}</div>`;
}

function renderUser() {
  $('#userPanel').innerHTML = `${avatar(S.user, 'sm', true)}<span class="name">${esc(S.user.username)}</span>
    <button class="icon-btn" data-act="logout" title="Выйти">${ICON.logout}</button>`;
}

function renderMain() {
  const ch = curChannel();
  $('#emptyView').hidden = !!ch;
  $('#textView').hidden = ch?.type !== 'text';
  $('#callView').hidden = ch?.type !== 'voice';
  $('#chanTitle').innerHTML = ch ? `${ch.type === 'text' ? ICON.hash : ICON.speaker}<span>${esc(ch.name)}</span>` : '';
  if (!ch) {
    $('#emptyView').innerHTML = curServer()
      ? '<h2>Выбери канал</h2><p>Слева список текстовых и голосовых каналов.</p>'
      : `<h2>Добро пожаловать в Волну 👋</h2><p>Создай сервер для друзей или вступи по коду.</p><button class="btn primary" data-act="add-server">Создать или вступить</button>`;
  }
  if (ch?.type === 'text') {
    renderMessages();
    scrollBottom();
    renderTyping();
    $('#msgInput').placeholder = 'Написать в #' + ch.name;
  }
  if (ch?.type === 'voice') renderTiles();
}

function renderMessages() {
  const box = $('#messages');
  const ch = curChannel();
  const list = S.msgs[S.channelId];
  if (!ch || ch.type !== 'text') return;
  if (!list) { box.innerHTML = '<div class="loading">Загрузка…</div>'; return; }
  const srv = curServer();
  const isOwner = srv?.ownerId === S.user.id;
  let html = S.hasMore[S.channelId] ? '' : `<div class="chan-start"><div class="chan-start-icon">${ICON.hash}</div><h2>Добро пожаловать в #${esc(ch.name)}</h2><p class="muted">Это начало канала.</p></div>`;
  let prev = null;
  for (const m of list) {
    const day = dayKey(m.ts);
    const newDay = !prev || dayKey(prev.ts) !== day;
    if (newDay) html += `<div class="day-sep"><span>${fmtDay(m.ts)}</span></div>`;
    const grouped = !newDay && prev.author.id === m.author.id && m.ts - prev.ts < 5 * 60e3;
    const del = m.author.id === S.user.id || isOwner ? `<button class="msg-del" data-del="${m.id}" title="Удалить">${ICON.trash}</button>` : '';
    html += grouped
      ? `<div class="msg grouped"><span class="msg-time-hover">${fmtTime(m.ts)}</span><div class="msg-text">${linkify(m.text)}</div>${del}</div>`
      : `<div class="msg">${avatar(m.author)}<div class="msg-body"><div class="msg-head"><span class="msg-author" style="color:${esc(m.author.color)}">${esc(m.author.username)}</span><span class="msg-time">${fmtTime(m.ts)}</span></div><div class="msg-text">${linkify(m.text)}</div></div>${del}</div>`;
    prev = m;
  }
  box.innerHTML = html;
}
function scrollBottom() { const b = $('#messages'); b.scrollTop = b.scrollHeight; }

function renderTyping() {
  const m = S.typing[S.channelId];
  const names = m ? [...m.values()].map((x) => x.name) : [];
  $('#typing').textContent = !names.length ? '' : names.length === 1 ? `${names[0]} печатает…` : names.length < 4 ? `${names.join(', ')} печатают…` : 'Несколько человек печатают…';
}
function clearTyping(chId, userId) {
  const m = S.typing[chId];
  if (m?.has(userId)) { clearTimeout(m.get(userId).timer); m.delete(userId); renderTyping(); }
}

function renderTiles() {
  const ch = curChannel();
  if (ch?.type !== 'voice') return;
  const st = S.voice[ch.id] || [];
  const inThis = call?.channelId === ch.id;
  const box = $('#tiles');
  if (S.focus && !st.some((u) => u.socketId === S.focus)) S.focus = null;
  box.className = 'tiles' + (S.focus ? ' has-focus' : '') + (st.length > 2 ? ' many' : '');
  box.replaceChildren();
  if (!st.length) box.innerHTML = '<div class="call-empty">В канале пока никого.<br>Подключайся первым!</div>';
  for (const u of st) {
    const t = document.createElement('div');
    t.className = 'tile' + (meters.get(u.socketId)?.speaking ? ' speaking' : '') + (S.focus === u.socketId ? ' focus' : '');
    t.dataset.speak = u.socketId;
    t.dataset.tile = u.socketId;
    let vid = null;
    if (inThis && u.video) vid = u.socketId === call.selfId ? call.localVideo : peers.get(u.socketId)?.videoEl;
    if (vid) {
      t.classList.add('has-video');
      if (u.screen) t.classList.add('screen');
      t.appendChild(vid);
      vid.play().catch(() => {});
    } else t.insertAdjacentHTML('beforeend', avatar(u, 'lg'));
    t.insertAdjacentHTML('beforeend', `<div class="tile-name">${u.deafened ? ICON.headOff : u.muted ? ICON.micOff : ''}<span>${esc(u.username)}${inThis && u.socketId === call.selfId ? ' (ты)' : ''}</span></div>`);
    box.appendChild(t);
  }
  $('#callBar').innerHTML = inThis
    ? ctlButtons() + `<button class="ctl hang" data-act="leave" title="Отключиться">${ICON.hang}</button>`
    : `<button class="btn primary" data-act="join-voice" data-ch="${ch.id}">${ICON.phone} Подключиться</button>`;
}

function renderMembers() {
  const s = curServer();
  const el = $('#members');
  if (!s) { el.innerHTML = ''; return; }
  const on = s.members.filter((u) => S.online.has(u.id));
  const off = s.members.filter((u) => !S.online.has(u.id));
  const row = (u) => `<div class="mem ${S.online.has(u.id) ? '' : 'off'}">${avatar(u, 'sm', S.online.has(u.id))}<span style="color:${esc(u.color)}">${esc(u.username)}</span>${u.id === s.ownerId ? '<b title="Владелец">👑</b>' : ''}</div>`;
  el.innerHTML = `<div class="mem-cat">В сети — ${on.length}</div>${on.map(row).join('')}` + (off.length ? `<div class="mem-cat">Не в сети — ${off.length}</div>${off.map(row).join('')}` : '');
}

let unseen = 0;
function bumpTitle() { unseen++; document.title = `(${unseen}) Волна`; }
document.addEventListener('visibilitychange', () => { if (!document.hidden) { unseen = 0; document.title = 'Волна'; } });

/* =================== отправка сообщений =================== */
const input = $('#msgInput');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; }
let lastTyping = 0;
input.addEventListener('input', () => {
  autosize();
  if (Date.now() - lastTyping > 2500 && input.value.trim()) { lastTyping = Date.now(); socket.emit('typing', { channelId: S.channelId }); }
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isTouch) { e.preventDefault(); sendMessage(); }
});
$('#composer').onsubmit = (e) => { e.preventDefault(); sendMessage(); input.focus(); };
function sendMessage() {
  const text = input.value.trim();
  if (!text || !S.channelId) return;
  input.value = '';
  autosize();
  lastTyping = 0;
  socket.emit('message:send', { channelId: S.channelId, text }, (res) => {
    if (res?.error) { toast(res.error); if (!input.value) { input.value = text; autosize(); } }
  });
}
$('#messages').addEventListener('scroll', (e) => {
  if (e.target.scrollTop < 80 && S.hasMore[S.channelId] && !S.loading) loadHistory(S.channelId, true);
});
$('#messages').addEventListener('click', (e) => {
  const m = e.target.closest('.msg');
  if (!m || e.target.closest('a,button')) return;
  document.querySelectorAll('.msg.sel').forEach((x) => x !== m && x.classList.remove('sel'));
  m.classList.toggle('sel');
});

/* =================== звонки (WebRTC, perfect negotiation) =================== */
async function joinVoice(chId) {
  if (call?.channelId === chId) return;
  if (call) leaveVoice();
  if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia)
    return toast('Звонки работают только по HTTPS (или на localhost)');
  const me = (call = { channelId: chId, selfId: socket.id, stream: null, muted: false, deafened: false, prevMuted: false, video: false, screen: false, videoTrack: null, localVideo: null });
  // AudioContext создаём сразу в обработчике клика — иначе iOS его не запустит
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch {}
  try {
    me.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  } catch {
    toast('Нет доступа к микрофону — подключаюсь только слушать');
    me.muted = true;
  }
  if (call !== me) { me.stream?.getTracks().forEach((t) => t.stop()); return; }
  socket.emit('voice:join', { channelId: chId, muted: me.muted }, (res) => {
    if (call !== me) return;
    if (res?.error) { toast(res.error); cleanupCall(); return; }
    me.selfId = socket.id;
    if (me.stream) addMeter(me.selfId, me.stream);
    for (const p of res.peers) ensurePeer(p.socketId);
    renderSidebar();
    renderMain();
  });
  renderSidebar();
}

function signal(to, data) { socket.emit('voice:signal', { to, data }); }

function ensurePeer(id) {
  if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection({ iceServers: S.ice });
  const p = { id, pc, polite: socket.id < id, makingOffer: false, ignoreOffer: false, videoSender: null, audioEl: document.createElement('audio'), videoEl: document.createElement('video') };
  p.audioEl.autoplay = true;
  p.audioEl.setAttribute('playsinline', '');
  p.audioEl.muted = !!call?.deafened;
  $('#audios').appendChild(p.audioEl);
  p.videoEl.autoplay = true;
  p.videoEl.muted = true;
  p.videoEl.playsInline = true;
  p.videoEl.setAttribute('playsinline', '');
  peers.set(id, p);

  if (call?.stream) for (const t of call.stream.getAudioTracks()) pc.addTrack(t, call.stream);
  if (call?.videoTrack) p.videoSender = pc.addTrack(call.videoTrack);

  pc.onnegotiationneeded = async () => {
    try {
      p.makingOffer = true;
      await pc.setLocalDescription();
      signal(id, { description: pc.localDescription });
    } catch (e) { console.warn(e); } finally { p.makingOffer = false; }
  };
  pc.onicecandidate = ({ candidate }) => { if (candidate) signal(id, { candidate }); };
  pc.ontrack = ({ track }) => {
    if (track.kind === 'audio') {
      const ms = new MediaStream([track]);
      p.audioEl.srcObject = ms;
      p.audioEl.play().catch(showAudioUnlock);
      addMeter(id, ms);
    } else {
      p.videoEl.srcObject = new MediaStream([track]);
      if (S.channelId === call?.channelId) renderTiles();
    }
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') pc.restartIce?.(); };
  return p;
}

async function onSignal(from, { description, candidate }) {
  const p = ensurePeer(from);
  const pc = p.pc;
  try {
    if (description) {
      const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
      p.ignoreOffer = !p.polite && collision;
      if (p.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        signal(from, { description: pc.localDescription });
      }
    } else if (candidate) {
      try { await pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) console.warn(e); }
    }
  } catch (e) { console.warn(e); }
}

function closePeer(id) {
  const p = peers.get(id);
  if (!p) return;
  try { p.pc.close(); } catch {}
  p.audioEl.srcObject = null;
  p.audioEl.remove();
  p.videoEl.srcObject = null;
  p.videoEl.remove();
  removeMeter(id);
  peers.delete(id);
}

function leaveVoice() {
  if (!call) return;
  socket?.emit('voice:leave');
  cleanupCall();
}

function cleanupCall() {
  if (!call) return;
  for (const id of [...peers.keys()]) closePeer(id);
  call.stream?.getTracks().forEach((t) => t.stop());
  call.videoTrack?.stop();
  removeMeter(call.selfId);
  call = null;
  $('#unlock')?.remove();
  renderSidebar();
  renderMain();
}

function pushVoiceState() {
  if (!call) return;
  socket.emit('voice:update', { muted: call.muted, deafened: call.deafened, video: call.video, screen: call.screen });
  renderVoicePanel();
  if (S.channelId === call.channelId) renderTiles();
}

function setMic(on) { call.stream?.getAudioTracks().forEach((t) => (t.enabled = on)); }

function toggleMute() {
  if (!call) return;
  if (!call.stream) return toast('Микрофон недоступен');
  if (call.deafened) { call.deafened = false; applyDeafen(); }
  call.muted = !call.muted;
  setMic(!call.muted);
  pushVoiceState();
}

function applyDeafen() { for (const p of peers.values()) p.audioEl.muted = call.deafened; }

function toggleDeafen() {
  if (!call) return;
  call.deafened = !call.deafened;
  applyDeafen();
  if (call.deafened) { call.prevMuted = call.muted; call.muted = true; }
  else call.muted = call.prevMuted || !call.stream;
  setMic(!call.muted);
  pushVoiceState();
}

async function toggleCamera() {
  if (!call) return;
  if (call.video && !call.screen) return setVideo(null, false);
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } });
    setVideo(s.getVideoTracks()[0], false);
  } catch { toast('Нет доступа к камере'); }
}

async function toggleScreen() {
  if (!call) return;
  if (call.screen) return setVideo(null, false);
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
    const t = s.getVideoTracks()[0];
    t.onended = () => { if (call?.videoTrack === t) setVideo(null, false); };
    setVideo(t, true);
  } catch {}
}

function setVideo(track, isScreen) {
  if (!call) { track?.stop(); return; }
  const old = call.videoTrack;
  call.videoTrack = track;
  call.video = !!track;
  call.screen = !!track && isScreen;
  for (const p of peers.values()) {
    if (p.videoSender) p.videoSender.replaceTrack(track).catch(() => {});
    else if (track) p.videoSender = p.pc.addTrack(track);
  }
  if (old && old !== track) old.stop();
  if (track) {
    if (!call.localVideo) {
      const v = document.createElement('video');
      v.autoplay = true; v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
      call.localVideo = v;
    }
    call.localVideo.srcObject = new MediaStream([track]);
    call.localVideo.classList.toggle('mirror', !isScreen);
  }
  pushVoiceState();
}

/* индикатор «говорит» */
function addMeter(id, stream) {
  if (!audioCtx || !id) return;
  removeMeter(id);
  try {
    const src = audioCtx.createMediaStreamSource(stream);
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    meters.set(id, { src, an, buf: new Uint8Array(an.fftSize), speaking: false });
    if (!meterLoop) meterLoop = requestAnimationFrame(tickMeters);
  } catch {}
}
function removeMeter(id) {
  const m = meters.get(id);
  if (m) { try { m.src.disconnect(); } catch {} meters.delete(id); }
}
let meterLoop = null, lastTick = 0;
function tickMeters(t) {
  meterLoop = meters.size ? requestAnimationFrame(tickMeters) : null;
  if (t - lastTick < 100) return;
  lastTick = t;
  for (const [id, m] of meters) {
    m.an.getByteTimeDomainData(m.buf);
    let sum = 0;
    for (const v of m.buf) { const x = (v - 128) / 128; sum += x * x; }
    let speaking = Math.sqrt(sum / m.buf.length) > 0.03;
    if (call && id === call.selfId && call.muted) speaking = false;
    if (speaking !== m.speaking) {
      m.speaking = speaking;
      document.querySelectorAll(`[data-speak="${CSS.escape(id)}"]`).forEach((el) => el.classList.toggle('speaking', speaking));
    }
  }
}

function showAudioUnlock() {
  if ($('#unlock')) return;
  const b = document.createElement('button');
  b.id = 'unlock';
  b.className = 'btn primary unlock';
  b.textContent = '🔊 Нажми, чтобы включить звук';
  b.onclick = () => {
    audioCtx?.resume();
    document.querySelectorAll('#audios audio').forEach((a) => a.play().catch(() => {}));
    b.remove();
  };
  document.body.appendChild(b);
}

/* =================== модальные окна =================== */
function modal(html, onMount) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card">${html}</div>`;
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); };
  onMount?.(m);
  if (!isTouch) m.querySelector('input')?.focus();
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

function addServerModal() {
  modal(`<h2>Сервер</h2>
    <form id="fCreate"><label>Создать свой<input id="fName" placeholder="Например: Пацаны" maxlength="40" required></label><button class="btn primary">Создать</button></form>
    <div class="or">или</div>
    <form id="fJoin"><label>Вступить по коду приглашения<input id="fCode" placeholder="Например: K7Q2ZP" maxlength="12" autocapitalize="characters" autocomplete="off" required></label><button class="btn">Вступить</button></form>
    <button class="btn ghost" data-close>Отмена</button>`, (m) => {
    m.querySelector('#fCreate').onsubmit = (e) => {
      e.preventDefault();
      socket.emit('server:create', { name: m.querySelector('#fName').value }, (res) => {
        if (res.error) return toast(res.error);
        upsertServer(res.server);
        closeModal();
        selectServer(res.server.id);
        closeDrawer();
        setTimeout(inviteModal, 200);
      });
    };
    m.querySelector('#fJoin').onsubmit = (e) => {
      e.preventDefault();
      socket.emit('server:join', { code: m.querySelector('#fCode').value }, (res) => {
        if (res.error) return toast(res.error);
        upsertServer(res.server);
        res.online.forEach((id) => S.online.add(id));
        Object.assign(S.voice, res.voice);
        closeModal();
        selectServer(res.server.id);
        closeDrawer();
      });
    };
  });
}

function inviteModal() {
  const s = curServer();
  if (!s) return;
  modal(`<h2>Пригласить в «${esc(s.name)}»</h2>
    <p class="muted">Отправь другу ссылку на сайт и этот код. Он жмёт «+» слева → «Вступить по коду».</p>
    <div class="code">${esc(s.invite)}</div>
    <button class="btn primary" id="copyInv">Скопировать приглашение</button>
    <button class="btn ghost" data-close>Готово</button>`, (m) => {
    m.querySelector('#copyInv').onclick = async () => {
      const text = `Заходи ко мне в «${s.name}» в Волне: ${API || location.origin}\nКод приглашения: ${s.invite}`;
      try {
        if (navigator.share && isTouch) await navigator.share({ text });
        else { await navigator.clipboard.writeText(text); toast('Скопировано'); }
      } catch {}
    };
  });
}

function serverMenu() {
  const s = curServer();
  if (!s) return;
  const owner = s.ownerId === S.user.id;
  modal(`<h2>${esc(s.name)}</h2>
    <button class="btn" data-act="invite">${ICON.userPlus} Пригласить друзей</button>
    ${owner ? `<button class="btn" data-act="new-channel" data-type="text">${ICON.hash} Новый текстовый канал</button>
      <button class="btn" data-act="new-channel" data-type="voice">${ICON.speaker} Новый голосовой канал</button>
      <div class="mem-cat">Каналы</div>
      ${s.channels.map((c) => `<div class="row">${c.type === 'text' ? ICON.hash : ICON.speaker}<span>${esc(c.name)}</span><button class="icon-btn" data-act="del-channel" data-id="${c.id}" title="Удалить канал">${ICON.trash}</button></div>`).join('')}
      <button class="btn danger" data-act="del-server">Удалить сервер</button>`
    : `<button class="btn danger" data-act="leave-server">Покинуть сервер</button>`}
    <button class="btn ghost" data-close>Закрыть</button>`);
}

function newChannelModal(type) {
  const s = curServer();
  if (!s) return;
  modal(`<h2>${type === 'voice' ? 'Голосовой' : 'Текстовый'} канал</h2>
    <form id="fCh"><label>Название<input id="fChName" maxlength="32" placeholder="${type === 'voice' ? 'Катка' : 'мемы'}" required></label><button class="btn primary">Создать</button></form>
    <button class="btn ghost" data-close>Отмена</button>`, (m) => {
    m.querySelector('#fCh').onsubmit = (e) => {
      e.preventDefault();
      socket.emit('channel:create', { serverId: s.id, name: m.querySelector('#fChName').value, type }, (res) => {
        if (res.error) return toast(res.error);
        closeModal();
        if (type === 'text') openChannel(res.channel.id);
      });
    };
  });
}

/* =================== клики =================== */
const ACT = {
  'add-server': addServerModal,
  invite: inviteModal,
  'server-menu': serverMenu,
  'new-channel': (el) => newChannelModal(el.dataset.type),
  'join-voice': (el) => joinVoice(el.dataset.ch),
  'open-call': () => { if (call) { if (serverOfChannel(call.channelId)?.id !== S.serverId) selectServer(serverOfChannel(call.channelId).id, call.channelId); openChannel(call.channelId); } },
  mute: toggleMute,
  deafen: toggleDeafen,
  camera: toggleCamera,
  screen: toggleScreen,
  leave: leaveVoice,
  logout: () => { if (confirm('Выйти из аккаунта?')) logout(); },
  'del-channel': (el) => {
    if (!confirm('Удалить канал вместе с сообщениями?')) return;
    socket.emit('channel:delete', { channelId: el.dataset.id }, (res) => { if (res.error) toast(res.error); else serverMenu(); });
  },
  'del-server': () => {
    const s = curServer();
    if (!s || prompt(`Чтобы удалить сервер навсегда, введи его название: ${s.name}`) !== s.name) return;
    socket.emit('server:delete', { serverId: s.id }, (res) => { if (res.error) toast(res.error); else closeModal(); });
  },
  'leave-server': () => {
    const s = curServer();
    if (!s || !confirm(`Покинуть «${s.name}»?`)) return;
    socket.emit('server:leave', { serverId: s.id }, (res) => { if (res.error) toast(res.error); else closeModal(); });
  },
};

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act],[data-srv],[data-ch],[data-del],[data-tile]');
  if (!t) return;
  if (t.dataset.act) {
    if (t.closest('#modal') && !['del-channel', 'del-server', 'leave-server'].includes(t.dataset.act)) closeModal();
    return ACT[t.dataset.act]?.(t);
  }
  if (t.dataset.srv) return selectServer(t.dataset.srv, store.get('ch:' + t.dataset.srv));
  if (t.dataset.ch) {
    const ch = findChannel(t.dataset.ch);
    if (!ch) return;
    if (ch.type === 'voice' && call?.channelId !== ch.id) joinVoice(ch.id);
    store.set('ch:' + S.serverId, ch.type === 'text' ? ch.id : null);
    return openChannel(ch.id);
  }
  if (t.dataset.del) {
    if (confirm('Удалить сообщение?')) socket.emit('message:delete', { id: t.dataset.del }, (res) => res?.error && toast(res.error));
    return;
  }
  if (t.dataset.tile) {
    S.focus = S.focus === t.dataset.tile ? null : t.dataset.tile;
    renderTiles();
  }
});

/* =================== мобильная вёрстка =================== */
$('#menuBtn').innerHTML = ICON.menu;
$('#membersBtn').innerHTML = ICON.users;
$('#sendBtn').innerHTML = ICON.send;
function closeDrawer() { document.body.classList.remove('drawer'); }
$('#menuBtn').onclick = () => document.body.classList.toggle('drawer');
$('#membersBtn').onclick = () => document.body.classList.toggle('show-members');
$('#scrim').onclick = () => document.body.classList.remove('drawer', 'show-members');
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); document.body.classList.remove('drawer'); }
});
// высота под экранную клавиатуру (iOS)
if (window.visualViewport) {
  const fit = () => {
    document.documentElement.style.setProperty('--app-h', visualViewport.height + 'px');
    window.scrollTo(0, 0);
  };
  visualViewport.addEventListener('resize', fit);
  fit();
}
if (!isNative && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (isNative) document.body.classList.add('native');

/* =================== старт =================== */
if (innerWidth > 1100) document.body.classList.add('show-members');
if (S.token) start(); else showAuth();
