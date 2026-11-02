'use strict';
/* =================== навигация =================== */
function selectServer(id, chId) {
  S.serverId = id || 'home';
  store.set('serverId', S.serverId);
  S.focus = null;
  renderServers();
  if (isHome()) {
    const d = dmById(chId) || (S.channelId && dmById(S.channelId)) || null;
    openChannel(d?.id || null, true);
    return;
  }
  const s = curServer();
  if (!s) return selectServer('home');
  const ch = s.channels.find((c) => c.id === chId) || s.channels.find((c) => c.id === store.get('ch:' + s.id)) || s.channels.find((c) => c.type === 'text');
  openChannel(ch?.id || null, true);
}
function openChannel(id, silent) {
  if (S.channelId !== id) { S.reply = null; S.editing = null; }
  S.channelId = id;
  store.set('channelId', id);
  delete S.unread[id];
  delete S.mentions[id];
  S.focus = null;
  const ch = curChannel();
  if (ch?.type === 'dm') S.dmView = call?.channelId === id ? 'call' : 'chat';
  if (ch && !isHome() && ch.type === 'text') store.set('ch:' + S.serverId, id);
  renderAll();
  if (ch && ch.type !== 'voice' && !S.msgs[id]) loadHistory(id);
  if (!silent) closeDrawer();
}
function openAnyChannel(id) {
  if (dmById(id)) { if (!isHome()) S.serverId = 'home'; selectServer('home', id); }
  else { const s = serverOfChannel(id); if (s) selectServer(s.id, id); }
  closeDrawer();
}
function openDm(userId) {
  socket.emit('dm:open', { userId }, (res) => {
    if (res?.error) return toast(res.error);
    upsertDm(res.dm);
    S.presence[res.dm.user.id] = res.status;
    closePopover();
    closeModal();
    selectServer('home', res.dm.id);
    closeDrawer();
  });
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
    res.messages.forEach((m) => rememberUser(m.author));
    const box = $('#messages');
    const prevH = box.scrollHeight, prevTop = box.scrollTop;
    S.msgs[chId] = before ? res.messages.concat(S.msgs[chId] || []) : res.messages;
    S.hasMore[chId] = res.messages.length === 50;
    if (S.channelId !== chId) return;
    renderMessages();
    if (before) box.scrollTop = box.scrollHeight - prevH + prevTop; else scrollBottom();
  });
}

/* =================== боковые панели =================== */
const unreadIn = (ids) => ids.reduce((n, id) => n + (S.unread[id] || 0), 0);
const mentionsIn = (ids) => ids.reduce((n, id) => n + (S.mentions[id] || 0), 0);
function renderServers() {
  const dmIds = S.dms.map((d) => d.id);
  const dmBadge = mentionsIn(dmIds);
  let h = `<button class="srv home ${isHome() ? 'active' : ''}" data-srv="home" title="Личные сообщения"><img src="${HOME_ICON}" alt="">${dmBadge ? `<i class="badge">${dmBadge > 99 ? '99+' : dmBadge}</i>` : ''}</button><div class="srv-sep"></div>`;
  for (const s of S.servers) {
    const ids = s.channels.map((c) => c.id);
    const un = unreadIn(ids), mn = mentionsIn(ids);
    h += `<button class="srv ${s.id === S.serverId ? 'active' : ''}" data-srv="${s.id}" title="${esc(s.name)}">${un && s.id !== S.serverId ? '<i class="pip"></i>' : ''}${esc(initials(s.name))}${mn ? `<i class="badge">${mn}</i>` : ''}</button>`;
  }
  h += `<button class="srv add" data-act="add-server" title="Создать или вступить">${ICON.plus}</button>`;
  $('#servers').innerHTML = h;
}

function renderSidebar() {
  if (!S.user) return;
  if (isHome()) {
    $('#serverHeader').innerHTML = `<span class="srv-name">Личные сообщения</span><button class="icon-btn" data-act="new-dm" title="Написать кому-то">${ICON.plus}</button>`;
    let h = '<div class="ch-cat"><span>Переписки</span></div>';
    if (!S.dms.length) h += `<div class="hint">Здесь будут личные переписки. Нажми на участника сервера и выбери «Написать».<button class="btn sm" data-act="new-dm">Написать кому-то</button></div>`;
    for (const d of S.dms) {
      const u = userOf(d.user);
      const un = S.mentions[d.id] || 0;
      const inCall = (S.voice[d.id] || []).length;
      const sub = inCall ? '📞 Идёт звонок' : statusLine(u) || STATUS_TXT[statusOf(u.id)];
      h += `<button class="ch dm-row ${d.id === S.channelId ? 'active' : ''} ${un ? 'unread' : ''}" data-ch="${d.id}">${avatar(u, 'sm', { status: statusOf(u.id) })}<div class="who"><b>${esc(dname(u))}</b><small>${sub}</small></div>${un ? `<i class="badge">${un}</i>` : ''}</button>`;
    }
    $('#channels').innerHTML = h;
    renderVoicePanel();
    return;
  }
  const s = curServer();
  if (!s) {
    $('#serverHeader').innerHTML = '<span class="srv-name">Волна</span>';
    $('#channels').innerHTML = `<div class="hint">Создай свой сервер или вступи по коду приглашения.<button class="btn primary" data-act="add-server">Начать</button></div>`;
    renderVoicePanel();
    return;
  }
  const owner = s.ownerId === S.user.id;
  $('#serverHeader').innerHTML = `<span class="srv-name">${esc(s.name)}</span>
    <button class="icon-btn" data-act="invite" title="Пригласить">${ICON.userPlus}</button>
    <button class="icon-btn" data-act="server-menu" title="Настройки сервера">${ICON.dots}</button>`;
  const cat = (title, type) => `<div class="ch-cat"><span>${title}</span>${owner ? `<button class="icon-btn sm" data-act="new-channel" data-type="${type}" title="Создать канал">${ICON.plus}</button>` : ''}</div>`;
  let h = cat('Текстовые каналы', 'text');
  for (const c of s.channels.filter((c) => c.type === 'text')) {
    const mn = S.mentions[c.id] || 0;
    h += `<button class="ch ${c.id === S.channelId ? 'active' : ''} ${S.unread[c.id] ? 'unread' : ''}" data-ch="${c.id}">${ICON.hash}<span>${esc(c.name)}</span>${mn ? `<i class="badge">${mn}</i>` : ''}</button>`;
  }
  h += cat('Голосовые каналы', 'voice');
  for (const c of s.channels.filter((c) => c.type === 'voice')) {
    const st = S.voice[c.id] || [];
    h += `<button class="ch ${c.id === S.channelId ? 'active' : ''} ${call?.channelId === c.id ? 'connected' : ''}" data-ch="${c.id}">${ICON.speaker}<span>${esc(c.name)}</span>${st.length ? `<em class="cnt">${st.length}</em>` : ''}</button>`;
    if (st.length)
      h += `<div class="vc-users">${st.map((v) => { const u = userOf({ id: v.userId, ...v }); return `<div class="vc-user ${speakingNow(v.socketId) ? 'speaking' : ''}" data-speak="${v.socketId}" data-user="${v.userId}">${avatar(u, 'xs', { ring: false })}<span>${esc(dname(u))}</span>${v.video ? `<b class="tag">${v.screen ? 'ЭКРАН' : 'КАМ'}</b>` : ''}${v.deafened ? ICON.headOff : v.muted ? ICON.micOff : ''}</div>`; }).join('')}</div>`;
  }
  $('#channels').innerHTML = h;
  renderVoicePanel();
}

function ctlButtons() {
  return `<button class="ctl ${call.muted ? 'off' : ''}" data-act="mute" title="Микрофон">${call.muted ? ICON.micOff : ICON.mic}</button>
    <button class="ctl ${call.deafened ? 'off' : ''}" data-act="deafen" title="Звук">${call.deafened ? ICON.headOff : ICON.head}</button>
    <button class="ctl ${call.video && !call.screen ? 'on' : ''}" data-act="camera" title="Камера">${ICON.cam}</button>
    ${canShareScreen() ? `<button class="ctl ${call.screen ? 'on' : ''}" data-act="screen" title="Демонстрация экрана">${ICON.screen}</button>` : ''}`;
}
function renderVoicePanel() {
  const p = $('#voicePanel');
  if (!call) { p.hidden = true; return; }
  const ch = findChannel(call.channelId);
  const s = serverOfChannel(call.channelId);
  p.hidden = false;
  p.innerHTML = `<div class="vp-top"><div class="vp-status" data-act="open-call"><b>${ch?.type === 'dm' ? 'Звонок' : 'Голос подключён'}</b><span>${esc(ch?.name || '')}${s ? ' / ' + esc(s.name) : ''}</span></div>
    <button class="icon-btn" data-act="leave" title="Отключиться" style="color:var(--red)">${ICON.hang}</button></div>
    <div class="vp-ctl">${ctlButtons()}</div>`;
}
function renderUser() {
  if (!S.user) return;
  const u = S.user;
  const st = statusOf(u.id);
  $('#userPanel').innerHTML = `<button class="me" data-user="${u.id}" title="Мой профиль">${avatar(u, 'sm', { status: st === 'offline' ? 'offline' : st })}<div class="who"><b>${esc(dname(u))}</b><small>${statusLine(u) || (S.me.status === 'invisible' ? 'Невидимка' : STATUS_TXT[st])}</small></div></button>
    <button class="icon-btn" data-act="settings" title="Настройки">${ICON.gear}</button>`;
}

/* =================== основная колонка =================== */
function renderHeader() {
  const ch = curChannel();
  const acts = $('#chanActs');
  acts.innerHTML = '';
  if (!ch) { $('#chanTitle').innerHTML = ''; return; }
  if (ch.type === 'dm') {
    const u = userOf(ch.dm.user);
    $('#chanTitle').innerHTML = `${avatar(u, 'sm', { status: statusOf(u.id), click: true })}<div style="min-width:0"><div class="tt">${nameHtml(u, { click: true })}</div><small>${statusLine(u) || STATUS_TXT[statusOf(u.id)]}</small></div>`;
    const active = (S.voice[ch.id] || []).length;
    const inThis = call?.channelId === ch.id;
    if (inThis || active) acts.innerHTML = `<button class="icon-btn ${S.dmView === 'call' ? 'on' : ''}" data-act="dm-view" title="${S.dmView === 'call' ? 'К переписке' : 'К звонку'}">${S.dmView === 'call' ? ICON.chat : ICON.phone}</button>`;
    if (!inThis) acts.innerHTML += `<button class="icon-btn" data-act="dm-call" title="Позвонить">${ICON.phone}</button>`;
  } else {
    $('#chanTitle').innerHTML = `${ch.type === 'text' ? ICON.hash : ICON.speaker}<span class="tt">${esc(ch.name)}</span>`;
  }
}
function renderMain() {
  const ch = curChannel();
  const isCall = ch && (ch.type === 'voice' || (ch.type === 'dm' && S.dmView === 'call'));
  $('#emptyView').hidden = !!ch;
  $('#textView').hidden = !ch || isCall;
  $('#callView').hidden = !isCall;
  renderHeader();
  if (!ch) {
    $('#emptyView').innerHTML = isHome()
      ? `<div class="big">🌊</div><h2>Привет, ${esc(dname(S.user))}!</h2><p>Выбери переписку слева или напиши кому-нибудь из своих серверов.</p><button class="btn primary" data-act="new-dm">Написать сообщение</button>`
      : curServer() ? '<h2>Выбери канал</h2><p>Слева список текстовых и голосовых каналов.</p>'
      : `<div class="big">🌊</div><h2>Добро пожаловать в Волну</h2><p>Создай сервер для друзей или вступи по коду.</p><button class="btn primary" data-act="add-server">Создать или вступить</button>`;
    return;
  }
  if (!isCall) {
    renderMessages();
    scrollBottom();
    renderTyping();
    renderComposeBar();
    $('#msgInput').placeholder = ch.type === 'dm' ? 'Написать ' + ch.name : 'Написать в #' + ch.name;
  } else renderTiles();
}

/* --- текст сообщений: **жирный**, *курсив*, ~~зачёркнутый~~, `код`, ||спойлер||, ссылки, @упоминания --- */
function fmtText(text) {
  let s = esc(text);
  const keep = [];
  const hold = (h) => `\u0001${keep.push(h) - 1}\u0001`;
  s = s.replace(/```(?:[a-z0-9+-]*\n)?([\s\S]*?)```/gi, (_, c) => hold(`<pre><code>${c.replace(/^\n|\n$/g, '')}</code></pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, c) => hold(`<code>${c}</code>`));
  s = s.replace(/https?:\/\/[^\s<]+/g, (u) => {
    const m = /^(.*?)((?:[.,!?:;)\]]|&quot;|&#39;)*)$/.exec(u);
    return hold(`<a href="${m[1]}" target="_blank" rel="noopener noreferrer">${m[1]}</a>`) + m[2];
  });
  s = s.replace(/\|\|([^|]+?)\|\|/g, '<span class="spoiler">$1</span>');
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[\s(])\*([^*\n]+?)\*(?=$|[\s.,!?:;)])/g, '$1<i>$2</i>');
  s = s.replace(/(^|[\s(])_([^_\n]+?)_(?=$|[\s.,!?:;)])/g, '$1<i>$2</i>');
  s = s.replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');
  s = s.replace(/(^|\s)@([\p{L}\p{N}_.\-]{2,24})/gu, (all, pre, name) => {
    const low = name.toLowerCase();
    if (low === 'все' || low === 'everyone') return `${pre}<span class="mention-tag me">@${name}</span>`;
    const u = Object.values(S.users).find((x) => x.username?.toLowerCase() === low);
    if (!u) return all;
    return `${pre}<span class="mention-tag ${u.id === S.user.id ? 'me' : ''}" data-user="${u.id}">@${esc(dname(u))}</span>`;
  });
  return s.replace(/\u0001(\d+)\u0001/g, (_, i) => keep[+i]);
}
const plainText = (t) => String(t || '').replace(/```[a-z0-9+-]*\n?|```/gi, '').replace(/\*\*|~~|\|\||`/g, '').replace(/(^|\s)[*_]([^*_\n]+)[*_](?=$|[\s.,!?:;])/g, '$1$2');
const onlyEmoji = (t) => t && t.length <= 24 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\s)+$/u.test(t) && !/^[\d#*\s]+$/.test(t);

function msgHtml(m, prev, canMod) {
  const au = userOf(m.author);
  const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts);
  const grouped = !newDay && !m.replyTo && prev.author.id === m.author.id && m.ts - prev.ts < 5 * 60e3;
  const mine = m.author.id === S.user.id;
  const ment = !mine && mentionsMe(m.text);
  let h = newDay ? `<div class="day-sep"><span>${fmtDay(m.ts)}</span></div>` : '';
  let reply = '';
  if (m.replyTo) {
    if (m.replyTo.deleted) reply = `<div class="reply-ref"><span class="t muted">Сообщение удалено</span></div>`;
    else {
      const ru = S.users[m.replyTo.authorId] || { id: m.replyTo.authorId, username: '…' };
      reply = `<div class="reply-ref" data-jump="${m.replyTo.id}">${avatar(ru, '', { ring: false })}${nameHtml(ru)}<span class="t">${esc(plainText(m.replyTo.text))}</span></div>`;
    }
  }
  const big = onlyEmoji(m.text) ? ' style="font-size:2.2em;line-height:1.2"' : '';
  const text = m.text ? `<div class="msg-text"${big}>${fmtText(m.text)}${m.editedAt ? '<span class="edited">(изменено)</span>' : ''}</div>` : '';
  const atts = m.attachments?.length
    ? `<div class="atts">${m.attachments.map((a) => { const k = Math.min(1, 360 / a.w, 320 / a.h); return `<a class="att" data-img="${esc(mediaUrl(a.id))}"><img src="${esc(mediaUrl(a.id))}" width="${Math.round(a.w * k)}" height="${Math.round(a.h * k)}" loading="lazy" alt=""></a>`; }).join('')}</div>`
    : '';
  const rx = Object.entries(m.reactions || {});
  const reacts = rx.length
    ? `<div class="reacts">${rx.map(([e, ids]) => `<button class="react ${ids.includes(S.user.id) ? 'mine' : ''}" data-react="${esc(e)}" title="${esc(ids.map((id) => dname(S.users[id] || { username: '…' })).join(', '))}">${esc(e)}<b>${ids.length}</b></button>`).join('')}</div>`
    : '';
  const tools = `<div class="msg-tools glass thin">
    <button data-mact="react" title="Реакция">${ICON.smile}</button>
    <button data-mact="reply" title="Ответить">${ICON.reply}</button>
    ${mine ? `<button data-mact="edit" title="Изменить">${ICON.edit}</button>` : ''}
    ${m.text ? `<button data-mact="copy" title="Скопировать текст">${ICON.copy}</button>` : ''}
    ${mine || canMod ? `<button class="danger" data-mact="del" title="Удалить">${ICON.trash}</button>` : ''}</div>`;
  const cls = `msg${grouped ? ' grouped' : ''}${ment ? ' mention' : ''}`;
  h += grouped
    ? `<div class="${cls}" data-mid="${m.id}"><span class="msg-time-hover">${fmtTime(m.ts)}</span><div class="msg-body">${text}${atts}${reacts}</div>${tools}</div>`
    : `<div class="${cls}" data-mid="${m.id}">${avatar(au, '', { click: true })}<div class="msg-body">${reply}<div class="msg-head">${nameHtml(au, { click: true })}<span class="msg-time">${fmtTime(m.ts)}</span></div>${text}${atts}${reacts}</div>${tools}</div>`;
  return h;
}
function renderMessages(keepScroll) {
  const box = $('#messages');
  const ch = curChannel();
  if (!ch || ch.type === 'voice') return;
  const list = S.msgs[S.channelId];
  if (!list) { box.innerHTML = '<div class="loading">Загрузка…</div>'; return; }
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const top = box.scrollTop;
  const canMod = ch.type !== 'dm' && curServer()?.ownerId === S.user.id;
  let html = '';
  if (!S.hasMore[S.channelId]) {
    if (ch.type === 'dm') {
      const u = userOf(ch.dm.user);
      html = `<div class="chan-start">${avatar(u, 'lg', { click: true })}<h2>${nameHtml(u)}</h2><p class="muted">Это начало вашей личной переписки. Скажи привет 👋</p></div>`;
    } else html = `<div class="chan-start"><div class="chan-start-icon glass thin">${ICON.hash}</div><h2>Добро пожаловать в #${esc(ch.name)}</h2><p class="muted">Это начало канала.</p></div>`;
  }
  let prev = null;
  for (const m of list) { html += msgHtml(m, prev, canMod); prev = m; }
  const sel = $('.msg.sel', box)?.dataset.mid;
  box.innerHTML = html;
  if (sel) $(`.msg[data-mid="${CSS.escape(sel)}"]`, box)?.classList.add('sel');
  if (keepScroll) box.scrollTop = atBottom ? box.scrollHeight : top;
}
function scrollBottom() { const b = $('#messages'); b.scrollTop = b.scrollHeight; }
function renderTyping() {
  const m = S.typing[S.channelId];
  const names = m ? [...m.values()].map((x) => x.name) : [];
  const el = $('#typing');
  if (!names.length) { el.innerHTML = ''; return; }
  const t = names.length === 1 ? `<b>${esc(names[0])}</b> печатает…` : names.length < 4 ? `<b>${esc(names.join(', '))}</b> печатают…` : 'Несколько человек печатают…';
  el.innerHTML = `<i></i><i></i><i></i>${t}`;
}
function clearTyping(chId, userId) {
  const m = S.typing[chId];
  if (m?.has(userId)) { clearTimeout(m.get(userId).timer); m.delete(userId); renderTyping(); }
}
function renderComposeBar() {
  const bar = $('#composeBar');
  if (S.editing) {
    bar.hidden = false;
    bar.innerHTML = `${ICON.edit}<span>Изменение сообщения</span><button class="icon-btn sm" data-act="cancel-compose" title="Отмена">${ICON.x}</button>`;
  } else if (S.reply) {
    const u = userOf(S.reply.author);
    bar.hidden = false;
    bar.innerHTML = `${ICON.reply}<span>Ответ <b>${esc(dname(u))}</b>: ${esc(plainText(S.reply.text || '🖼 Картинка').slice(0, 80))}</span><button class="icon-btn sm" data-act="cancel-compose" title="Отмена">${ICON.x}</button>`;
  } else bar.hidden = true;
  const pend = $('#pending');
  pend.hidden = !S.pending.length;
  pend.innerHTML = S.pending.map((p, i) => `<div class="pend ${p.id ? '' : 'up'}"><img src="${p.preview}" alt=""><button data-unpend="${i}" title="Убрать">${ICON.x}</button></div>`).join('');
}

function renderTiles() {
  const ch = curChannel();
  if (!ch) return;
  const st = S.voice[ch.id] || [];
  const inThis = call?.channelId === ch.id;
  const box = $('#tiles');
  if (S.focus && !st.some((u) => u.socketId === S.focus)) S.focus = null;
  box.className = 'tiles' + (S.focus ? ' has-focus' : '') + (st.length > 2 ? ' many' : '');
  box.replaceChildren();
  if (!st.length) box.innerHTML = `<div class="call-empty">${ch.type === 'dm' ? 'Сейчас никто не на линии.' : 'В канале пока никого.<br>Подключайся первым!'}</div>`;
  for (const v of st) {
    const u = userOf({ id: v.userId, ...v });
    const t = document.createElement('div');
    t.className = 'tile' + (speakingNow(v.socketId) ? ' speaking' : '') + (S.focus === v.socketId ? ' focus' : '');
    t.dataset.speak = v.socketId;
    t.dataset.tile = v.socketId;
    t.style.setProperty('--tilebg', `radial-gradient(80% 70% at 50% 40%, ${safeColor(u.accent || u.color)}33, transparent 70%)`);
    let vid = null;
    if (inThis && v.video) vid = v.socketId === call.selfId ? call.localVideo : v.frames ? frameImg(v.socketId) : peers.get(v.socketId)?.videoEl;
    if (vid) {
      t.classList.add('has-video');
      if (v.screen) t.classList.add('screen');
      t.appendChild(vid);
      vid.play?.().catch(() => {});
      if (v.socketId !== call.selfId) t.insertAdjacentHTML('beforeend', `<button class="tile-fs" data-act="fs" data-id="${esc(v.socketId)}" title="Во весь экран">${ICON.expand}</button>`);
    } else {
      t.insertAdjacentHTML('beforeend', avatar(u, 'lg'));
      if (inThis && v.socketId === call.selfId && call.screen) t.insertAdjacentHTML('beforeend', '<div class="tile-warn soft" style="top:auto;bottom:52px;left:50%;right:auto;transform:translateX(-50%)">Ты показываешь экран</div>');
    }
    if (v.screen && !vid && inThis && v.socketId !== call.selfId) t.insertAdjacentHTML('beforeend', '<div class="tile-warn soft">загружаю экран…</div>');
    if (inThis && v.socketId !== call.selfId) {
      const p = peers.get(v.socketId);
      const pst = p?.pc?.connectionState;
      if (p?.relay) t.insertAdjacentHTML('beforeend', '<div class="tile-warn soft">через сервер</div>');
      else if (pst === 'failed' || pst === 'disconnected') t.insertAdjacentHTML('beforeend', '<div class="tile-warn">восстанавливаю…</div>');
      else if (pst === 'new' || pst === 'connecting') t.insertAdjacentHTML('beforeend', '<div class="tile-warn soft">соединяю…</div>');
    }
    t.insertAdjacentHTML('beforeend', `<div class="tile-name">${v.deafened ? ICON.headOff : v.muted ? ICON.micOff : ''}<span>${esc(dname(u))}${inThis && v.socketId === call.selfId ? ' (ты)' : ''}</span></div>`);
    box.appendChild(t);
  }
  $('#callBar').innerHTML = inThis
    ? ctlButtons() + `<button class="ctl hang" data-act="leave" title="Отключиться">${ICON.hang}</button>`
    : `<button class="btn primary" data-act="join-voice" data-ch="${ch.id}">${ICON.phone} ${ch.type === 'dm' ? (st.length ? 'Присоединиться' : 'Позвонить') : 'Подключиться'}</button>`;
}

function renderMembers() {
  const el = $('#membersIn');
  const ch = curChannel();
  if (isHome()) {
    if (ch?.type === 'dm') { el.innerHTML = cardHtml(userOf(ch.dm.user), { panel: true }); return; }
    el.innerHTML = '';
    return;
  }
  const s = curServer();
  if (!s) { el.innerHTML = ''; return; }
  const list = s.members.map(userOf);
  const on = list.filter((u) => statusOf(u.id) !== 'offline');
  const off = list.filter((u) => statusOf(u.id) === 'offline');
  const row = (u) => {
    const st = statusOf(u.id);
    return `<button class="mem ${st === 'offline' ? 'off' : ''}" data-user="${u.id}">${avatar(u, 'sm', { status: st })}<div class="who">${nameHtml(u)}${statusLine(u) ? `<small>${statusLine(u)}</small>` : ''}</div>${u.id === s.ownerId ? '<b title="Владелец">👑</b>' : ''}</button>`;
  };
  el.innerHTML = `<div class="mem-cat">В сети — ${on.length}</div>${on.map(row).join('')}` + (off.length ? `<div class="mem-cat">Не в сети — ${off.length}</div>${off.map(row).join('')}` : '');
}

/* =================== карточка профиля =================== */
function bannerStyle(u) {
  const b = u.banner;
  const a = safeColor(b?.a, safeColor(u.accent || u.color)), c = safeColor(b?.b, '#16c6d6');
  if (b?.kind === 'image' && b.image) return `--ba:${a};--bb:${c};background-image:url('${esc(mediaUrl(b.image))}')`;
  return `--ba:${a};--bb:${c}`;
}
function cardHtml(u, opts = {}) {
  u = u || {};
  const me = u.id === S.user?.id;
  const st = opts.preview ? (opts.status || 'online') : statusOf(u.id);
  const inCallWith = call && (S.voice[call.channelId] || []).some((v) => v.userId === u.id) && !me;
  const vol = inCallWith ? Math.round((prefs.vol[u.id] ?? 1) * 100) : null;
  const statusPick = me && !opts.preview && !opts.panel
    ? `<div class="chips">${['online', 'idle', 'dnd', 'invisible'].map((k) => `<button class="chip ${S.me.status === k ? 'on' : ''}" data-setstatus="${k}"><i class="dot ${k === 'invisible' ? 'offline' : k}" style="position:relative;right:auto;bottom:auto;border:0;width:10px;height:10px;min-width:10px;min-height:10px"></i>${STATUS_TXT[k]}</button>`).join('')}</div>`
    : '';
  return `<div class="pcard glass" style="--acc:${safeColor(u.accent || u.color)}">
    <div class="banner" style="${bannerStyle(u)}"></div>
    <div class="pc-av">${avatar(u, 'xl', { status: st })}</div>
    <div class="pc-body">
      <div><div class="pc-name">${nameHtml(u)}</div><div class="pc-user">@${esc(u.username || '')}${u.pronouns ? ' · ' + esc(u.pronouns) : ''}</div></div>
      ${u.customStatus ? `<div class="pc-status">${esc(u.customStatus.emoji || '💬')} <span>${esc(u.customStatus.text || '')}</span></div>` : ''}
      ${statusPick}
      ${u.bio ? `<div class="pc-sec"><h4>Обо мне</h4><p>${fmtText(u.bio)}</p></div>` : ''}
      ${u.createdAt ? `<div class="pc-sec"><h4>В Волне с</h4><p>${fmtDate(u.createdAt)}</p></div>` : ''}
      ${vol != null ? `<div class="pc-sec"><h4>Громкость в звонке — <span data-volval>${vol}%</span></h4><input type="range" min="0" max="100" value="${vol}" data-vol="${u.id}"></div>` : ''}
      ${opts.preview ? '' : me
        ? `<div class="pc-acts"><button class="btn sm" data-act="settings" data-tab="profile">${ICON.edit} Редактировать профиль</button></div>`
        : `<div class="pc-acts"><button class="btn sm primary" data-dm="${u.id}">${ICON.chat} Написать</button>${opts.panel ? '' : `<button class="btn sm" data-dmcall="${u.id}">${ICON.phone}</button>`}</div>`}
    </div>
    <div class="pc-acc"></div>
  </div>`;
}
let popover = null;
function closePopover() { popover?.el.remove(); popover = null; }
function showPopover(html, anchor, kind) {
  closePopover();
  const el = document.createElement('div');
  el.className = 'popover';
  el.innerHTML = html;
  $('#layer').appendChild(el);
  popover = { el, kind };
  const small = innerWidth <= 860;
  if (small && (kind === 'card' || kind === 'picker')) { el.classList.add('sheet'); return el; }
  const r = anchor?.getBoundingClientRect?.() || { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2, bottom: innerHeight / 2 };
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = r.right + 10, y = r.top;
  if (x + w > innerWidth - 10) x = r.left - w - 10;
  if (x < 10) x = Math.max(10, Math.min(innerWidth - w - 10, r.left));
  if (y + h > innerHeight - 10) y = innerHeight - h - 10;
  if (kind !== 'card' && r.bottom + h + 8 < innerHeight) { y = r.bottom + 6; x = Math.min(innerWidth - w - 10, Math.max(10, r.right - w)); }
  else if (kind !== 'card') y = Math.max(10, r.top - h - 6);
  el.style.left = Math.max(10, x) + 'px';
  el.style.top = Math.max(10, y) + 'px';
  return el;
}
function showCard(userId, anchor) {
  const u = S.users[userId];
  if (!u) return;
  showPopover(cardHtml(u), anchor, 'card').dataset.card = userId;
  socket.emit('user:get', { userId }, (res) => {
    if (res?.user) { rememberUser(res.user); S.presence[userId] = res.status; refreshOpenCard(userId); }
  });
}
function refreshOpenCard(userId) {
  if (popover?.kind === 'card' && popover.el.dataset.card === userId) popover.el.innerHTML = cardHtml(S.users[userId]);
  if (curChannel()?.type === 'dm' && curChannel().dm.user.id === userId) { renderMembers(); renderHeader(); }
  if (userId === S.user?.id) renderUser();
}

/* =================== эмодзи =================== */
const QUICK = ['👍', '❤️', '😂', '🔥', '😮', '😢', '🎉', '👀'];
const EMOJI = {
  'Лица': '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😎 🤓 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 💀 ☠️ 👻 👽 🤖 💩 🤡',
  'Жесты': '👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 🤝 🙏 👏 🙌 👐 💪 🫶 ✍️ 🫡',
  'Сердца': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 ✨ ⭐ 🌟 💫 🔥 💯 💥 💢 💤 🎉 🎊 🎁 🏆 🥇',
  'Разное': '🎮 🕹 🎧 🎤 🎵 🎶 📞 📱 💻 🖥 ⌨️ 🖱 📷 🎬 📺 🍕 🍔 🍟 🌭 🍿 🍩 🍪 🍰 ☕ 🍺 🥤 🧃 🚗 🏎 ✈️ 🚀 🌊 🌙 ☀️ 🌈 ❄️ ⚡ 🐱 🐶 🦊 🐻 🐼 🐸 🦄 🐍 🦈',
};
function showPicker(anchor, onPick) {
  const el = showPopover(`<div class="picker glass"><div class="quick">${QUICK.map((e) => `<button data-emo="${e}">${e}</button>`).join('')}</div>
    <div class="grid">${Object.entries(EMOJI).map(([k, v]) => `<h5>${k}</h5>${v.split(' ').map((e) => `<button data-emo="${e}">${e}</button>`).join('')}`).join('')}</div></div>`, anchor, 'picker');
  el.onclick = (e) => {
    const b = e.target.closest('[data-emo]');
    if (!b) return;
    onPick(b.dataset.emo);
    if (!e.shiftKey) closePopover();
  };
}

/* =================== модальные окна =================== */
function modal(html, onMount) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card glass">${html}</div>`;
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
        if (innerWidth > 860) closeDrawer(); // на телефоне остаёмся в списке — видно каналы нового сервера
        setTimeout(inviteModal, 200);
      });
    };
    m.querySelector('#fJoin').onsubmit = (e) => {
      e.preventDefault();
      socket.emit('server:join', { code: m.querySelector('#fCode').value }, (res) => {
        if (res.error) return toast(res.error);
        upsertServer(res.server);
        Object.assign(S.presence, res.presence || {});
        Object.assign(S.voice, res.voice || {});
        closeModal();
        selectServer(res.server.id);
        if (innerWidth > 860) closeDrawer(); // на телефоне остаёмся в списке — видно каналы нового сервера
      });
    };
  });
}
function inviteModal() {
  const s = curServer();
  if (!s) return;
  modal(`<h2>Пригласить в «${esc(s.name)}»</h2>
    <p class="muted">Отправь другу ссылку и код. Он жмёт «+» слева → «Вступить по коду».</p>
    <div class="code">${esc(s.invite)}</div>
    <button class="btn primary" id="copyInv">Скопировать приглашение</button>
    <button class="btn ghost" data-close>Готово</button>`, (m) => {
    m.querySelector('#copyInv').onclick = async () => {
      const text = `Заходи ко мне в «${s.name}» в Волне: ${S.publicUrl || API || location.origin}${window.VOLNA_ANDROID ? `\nПриложение для Android: ${window.VOLNA_ANDROID}` : ''}\nКод приглашения: ${s.invite}`;
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
    ${owner ? `<form id="fRen" style="flex-direction:row;gap:8px"><input id="fRenName" value="${esc(s.name)}" maxlength="40" style="flex:1"><button class="btn sm">Переименовать</button></form>
      <button class="btn" data-act="new-channel" data-type="text">${ICON.hash} Новый текстовый канал</button>
      <button class="btn" data-act="new-channel" data-type="voice">${ICON.speaker} Новый голосовой канал</button>
      <div class="mem-cat">Каналы</div>
      ${s.channels.map((c) => `<div class="row">${c.type === 'text' ? ICON.hash : ICON.speaker}<span>${esc(c.name)}</span><button class="icon-btn" data-act="del-channel" data-id="${c.id}" title="Удалить канал">${ICON.trash}</button></div>`).join('')}
      <button class="btn danger" data-act="del-server">Удалить сервер</button>`
    : `<button class="btn danger" data-act="leave-server">Покинуть сервер</button>`}
    <button class="btn ghost" data-close>Закрыть</button>`, (m) => {
    const f = m.querySelector('#fRen');
    if (f) f.onsubmit = (e) => { e.preventDefault(); socket.emit('server:rename', { serverId: s.id, name: m.querySelector('#fRenName').value }, (r) => { if (r.error) toast(r.error); else { toast('Переименовано'); closeModal(); } }); };
  });
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
function newDmModal() {
  const known = new Map();
  for (const s of S.servers) for (const u of s.members) if (u.id !== S.user.id) known.set(u.id, userOf(u));
  for (const d of S.dms) known.set(d.user.id, userOf(d.user));
  const list = [...known.values()].sort((a, b) => dname(a).localeCompare(dname(b), 'ru'));
  modal(`<h2>Написать</h2><input id="dmSearch" placeholder="Найти по нику" autocomplete="off">
    <div id="dmList" style="display:flex;flex-direction:column;gap:2px;max-height:50dvh;overflow-y:auto"></div>
    <button class="btn ghost" data-close>Закрыть</button>`, (m) => {
    const draw = (q) => {
      q = q.trim().toLowerCase();
      const rows = list.filter((u) => !q || dname(u).toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
      m.querySelector('#dmList').innerHTML = rows.length
        ? rows.map((u) => `<button class="mem" data-dm="${u.id}">${avatar(u, 'sm', { status: statusOf(u.id) })}<div class="who">${nameHtml(u)}<small>@${esc(u.username)}</small></div></button>`).join('')
        : '<p class="muted">Никого не нашлось. Писать можно тем, с кем ты на одном сервере.</p>';
    };
    draw('');
    m.querySelector('#dmSearch').oninput = (e) => draw(e.target.value);
  });
}
function openViewer(url) {
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<img src="${esc(url)}" alt=""><button class="icon-btn x glass thin">${ICON.x}</button>`;
  v.onclick = () => v.remove();
  document.body.appendChild(v);
}

/* =================== настройки =================== */
let settingsTab = 'profile';
let draft = null;
const TABS = [['profile', ICON.user, 'Профиль'], ['account', ICON.shield, 'Аккаунт'], ['voice', ICON.mic, 'Голос и звук'], ['notify', ICON.bell, 'Уведомления'], ['look', ICON.palette, 'Внешний вид']];
function openSettings(tab) {
  // на телефоне без явного раздела сначала показываем список разделов (как в настройках iPhone)
  const direct = !!tab || innerWidth > 860;
  settingsTab = tab || settingsTab;
  closePopover();
  const u = S.user;
  draft = {
    displayName: u.displayName || '', username: u.username, pronouns: u.pronouns || '', bio: u.bio || '',
    color: u.color, accent: u.accent || u.color, ring: u.ring || 'none', avatar: u.avatar || null,
    nameStyle: u.nameStyle ? { ...u.nameStyle } : { kind: 'solid', a: u.color, b: '#6fe0ff' },
    banner: u.banner ? { ...u.banner } : { kind: 'gradient', a: safeColor(u.color), b: '#16c6d6' },
    customStatus: { emoji: u.customStatus?.emoji || '', text: u.customStatus?.text || '' },
    status: S.me.status || 'online',
  };
  let el = $('#settings');
  if (!el) {
    el = document.createElement('div');
    el.id = 'settings';
    el.className = 'settings';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="settings-card glass"><nav class="st-nav"><div class="st-nav-head"><h3>Настройки</h3><button class="icon-btn st-x" data-act="close-settings" title="Закрыть">${ICON.x}</button></div>
    <button class="st-me" data-stab="profile">${avatar(u, 'lg', { ring: false })}<div><b>${esc(dname(u))}</b><small>Аватар, баннер, имя, статус</small></div>${ICON.chev}</button>
    ${TABS.map(([k, ic, t]) => `<button data-stab="${k}">${ic}<span>${t}</span><i class="chev">${ICON.chev}</i></button>`).join('')}<div class="sp"></div><button data-act="logout" class="st-logout">${ICON.logout}<span>Выйти</span></button></nav>
    <div class="st-body"><div class="st-head"><button class="icon-btn st-back" data-stback title="Назад">${ICON.back}</button><h2 id="stTitle"></h2><button class="icon-btn" data-act="close-settings" title="Закрыть">${ICON.x}</button></div><div class="st-scroll" id="stBody"></div></div></div>`;
  el.onclick = (e) => {
    if (e.target === el) closeSettings();
    if (e.target.closest('[data-stback]')) { stopMicTest(); el.querySelector('.settings-card').classList.remove('st-open'); return; }
    const t = e.target.closest('[data-stab]');
    if (t) showTab(t.dataset.stab);
  };
  showTab(settingsTab, direct);
}
function closeSettings() { stopMicTest(); $('#settings')?.remove(); draft = null; }
function showTab(tab, open = true) {
  settingsTab = tab;
  stopMicTest();
  $$('.st-nav [data-stab]').forEach((b) => b.classList.toggle('on', b.dataset.stab === tab && !b.classList.contains('st-me')));
  if (!open) return;
  $('#settings .settings-card')?.classList.add('st-open');
  $('#stTitle').textContent = TABS.find((t) => t[0] === tab)[2];
  const body = $('#stBody');
  body.onclick = body.oninput = body.onchange = null;
  body.scrollTop = 0;
  ({ profile: tabProfile, account: tabAccount, voice: tabVoice, notify: tabNotify, look: tabLook })[tab](body);
}
const sw = (name, val, title, desc) => `<label class="opt"><div><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</div><span class="switch"><input type="checkbox" data-pref="${name}" ${val ? 'checked' : ''}><i></i></span></label>`;
const PALETTE = ['#5865f2', '#3ba55d', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22', '#00a8fc', '#ff6b9d', '#00d4aa', '#f1c40f'];
const RINGS = [['none', 'Без рамки'], ['glow', 'Сияние'], ['neon', 'Неон'], ['rainbow', 'Радуга'], ['aurora', 'Аврора'], ['pulse', 'Пульс']];

function previewUser() {
  const d = draft;
  return { ...S.user, displayName: d.displayName, username: d.username, pronouns: d.pronouns, bio: d.bio, color: d.color, accent: d.accent, ring: d.ring, avatar: d.avatar, nameStyle: d.nameStyle, banner: d.banner, customStatus: d.customStatus.text || d.customStatus.emoji ? d.customStatus : null };
}
function tabProfile(body) {
  const d = draft;
  body.innerHTML = `<div class="prof-grid"><div>
    <div class="st-sec"><h4>Аватар</h4><div class="uploader"><span id="avPick">${avatar(previewUser(), 'lg', { ring: false })}</span>
      <div style="display:flex;flex-direction:column;gap:8px"><button class="btn sm" data-up="avatar">${ICON.image} Загрузить картинку</button>${d.avatar ? '<button class="btn sm ghost" data-unset="avatar">Убрать картинку</button>' : ''}</div></div>
      <div class="swatches">${PALETTE.map((c) => `<button class="sw ${d.color === c ? 'on' : ''}" style="background:${c}" data-color="${c}" title="Цвет аватара"></button>`).join('')}<input type="color" value="${safeColor(d.color)}" data-field="color" title="Свой цвет"></div></div>
    <div class="st-sec"><h4>Рамка аватара</h4><div class="chips">${RINGS.map(([k, t]) => `<button class="chip ${d.ring === k ? 'on' : ''}" data-ring="${k}">${t}</button>`).join('')}</div></div>
    <div class="st-sec"><h4>Баннер</h4><div class="uploader"><div class="upl-banner" data-up="banner" style="${bannerStyle(previewUser())}">Нажми, чтобы загрузить картинку</div></div>
      <div class="swatches"><span class="muted" style="font-size:13px">Градиент:</span><input type="color" value="${safeColor(d.banner.a)}" data-field="banner.a"><input type="color" value="${safeColor(d.banner.b)}" data-field="banner.b">${d.banner.kind === 'image' ? '<button class="btn sm ghost" data-unset="banner">Убрать картинку</button>' : ''}</div></div>
    <div class="st-sec"><h4>Имя</h4>
      <label>Отображаемое имя<input data-field="displayName" maxlength="32" value="${esc(d.displayName)}" placeholder="${esc(d.username)}"></label>
      <div class="two"><label>Ник (для входа и @упоминаний)<input data-field="username" maxlength="24" value="${esc(d.username)}" autocapitalize="off" spellcheck="false"></label>
      <label>Местоимения<input data-field="pronouns" maxlength="24" value="${esc(d.pronouns)}" placeholder="например: он/его"></label></div>
      <h4 style="margin-top:6px">Стиль имени</h4>
      <div class="chips">${[['solid', 'Цвет'], ['gradient', 'Градиент'], ['shine', 'Переливы']].map(([k, t]) => `<button class="chip ${d.nameStyle.kind === k ? 'on' : ''}" data-namekind="${k}">${t}</button>`).join('')}
        <input type="color" value="${safeColor(d.nameStyle.a)}" data-field="nameStyle.a">${d.nameStyle.kind !== 'solid' ? `<input type="color" value="${safeColor(d.nameStyle.b, '#6fe0ff')}" data-field="nameStyle.b">` : ''}</div></div>
    <div class="st-sec"><h4>Статус</h4>
      <div class="chips">${['online', 'idle', 'dnd', 'invisible'].map((k) => `<button class="chip ${d.status === k ? 'on' : ''}" data-dstatus="${k}">${STATUS_TXT[k]}</button>`).join('')}</div>
      <div style="display:flex;gap:8px"><input class="emoji-in" data-field="customStatus.emoji" maxlength="8" value="${esc(d.customStatus.emoji)}" placeholder="🎮"><input style="flex:1" data-field="customStatus.text" maxlength="60" value="${esc(d.customStatus.text)}" placeholder="Свой статус: например, «играю в PUBG»"></div></div>
    <div class="st-sec"><h4>Обо мне</h4><textarea data-field="bio" maxlength="190" rows="4" placeholder="Пара слов о себе. Можно **жирный**, *курсив* и ссылки">${esc(d.bio)}</textarea><div class="counter" id="bioCnt">${d.bio.length}/190</div></div>
    <div class="st-sec"><h4>Цвет акцента карточки</h4><div class="swatches">${PALETTE.map((c) => `<button class="sw ${d.accent === c ? 'on' : ''}" style="background:${c}" data-accent="${c}"></button>`).join('')}<input type="color" value="${safeColor(d.accent)}" data-field="accent"></div></div>
    <div class="save-bar"><button class="btn primary" data-act="save-profile" style="flex:1">Сохранить</button><button class="btn" data-act="reset-profile">Сбросить</button></div>
  </div><div class="preview"><h4>Так тебя видят другие</h4><div id="pvCard">${cardHtml(previewUser(), { preview: true, status: d.status === 'invisible' ? 'offline' : d.status })}</div></div></div>`;
  const redraw = () => {
    $('#pvCard').innerHTML = cardHtml(previewUser(), { preview: true, status: d.status === 'invisible' ? 'offline' : d.status });
    $('#avPick').innerHTML = avatar(previewUser(), 'lg', { ring: false });
    const b = $('.upl-banner', body); if (b) b.setAttribute('style', bannerStyle(previewUser()));
  };
  body.oninput = (e) => {
    const f = e.target.dataset.field;
    if (!f) return;
    const [a, k] = f.split('.');
    if (k) d[a][k] = e.target.value; else d[a] = e.target.value;
    if (a === 'bio') $('#bioCnt').textContent = `${d.bio.length}/190`;
    redraw();
  };
  body.onclick = async (e) => {
    const t = e.target.closest('[data-color],[data-accent],[data-ring],[data-namekind],[data-dstatus],[data-up],[data-unset]');
    if (!t) return;
    if (t.dataset.color) d.color = t.dataset.color;
    else if (t.dataset.accent) d.accent = t.dataset.accent;
    else if (t.dataset.ring) d.ring = t.dataset.ring;
    else if (t.dataset.namekind) d.nameStyle.kind = t.dataset.namekind;
    else if (t.dataset.dstatus) d.status = t.dataset.dstatus;
    else if (t.dataset.unset === 'avatar') d.avatar = null;
    else if (t.dataset.unset === 'banner') d.banner = { kind: 'gradient', a: d.banner.a, b: d.banner.b };
    else if (t.dataset.up) {
      const kind = t.dataset.up;
      const file = await pickFile();
      if (!file) return;
      toast('Загружаю…');
      try {
        const r = await uploadImage(file, kind);
        if (kind === 'avatar') d.avatar = r.id;
        else d.banner = { kind: 'image', image: r.id, a: d.banner.a, b: d.banner.b };
        toast('Загружено — не забудь сохранить');
      } catch (err) { return toast(err.message); }
    }
    tabProfile(body);
  };
}
function pickFile(accept = 'image/*') {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.onchange = () => res(i.files[0] || null);
    i.click();
  });
}
function saveProfile() {
  const d = draft;
  const body = {
    displayName: d.displayName, pronouns: d.pronouns, bio: d.bio, color: d.color, accent: d.accent, ring: d.ring, avatar: d.avatar,
    nameStyle: d.nameStyle, banner: d.banner, customStatus: d.customStatus, status: d.status,
  };
  if (d.username !== S.user.username) body.username = d.username;
  socket.emit('profile:update', body, (res) => {
    if (res?.error) return toast(res.error);
    S.user = rememberUser(res.user);
    S.me = res.me;
    renderUser();
    renderMembers();
    toast('Профиль сохранён ✨');
  });
}
function setStatus(st) {
  socket.emit('profile:update', { status: st }, (res) => {
    if (res?.error) return toast(res.error);
    S.me = res.me;
    renderUser();
    if (popover?.kind === 'card') refreshOpenCard(S.user.id);
  });
}
function tabAccount(body) {
  const me = S.me || {};
  const ways = [me.google && 'Google', me.email && 'код на почту', me.hasPassword && 'ник и пароль'].filter(Boolean).join(', ') || 'ник и пароль';
  body.innerHTML = `<div class="st-sec"><h4>Вход</h4><div class="opt"><div><b>@${esc(S.user.username)}</b><small>${esc(me.email || 'почта не привязана')} · вход: ${esc(ways)}</small></div></div></div>
    <div class="st-sec"><h4>${me.hasPassword ? 'Сменить пароль' : 'Задать пароль'}</h4>
      <form id="fPass" style="display:flex;gap:8px;flex-wrap:wrap"><input id="pPass" type="password" minlength="6" autocomplete="new-password" placeholder="Новый пароль" required style="flex:1;min-width:200px"><button class="btn">Сохранить</button></form></div>
    <div class="st-sec"><h4>Устройство</h4><button class="btn danger" data-act="logout">${ICON.logout} Выйти из аккаунта</button></div>`;
  $('#fPass').onsubmit = (e) => {
    e.preventDefault();
    socket.emit('profile:update', { password: $('#pPass').value }, (res) => {
      if (res?.error) return toast(res.error);
      S.me = res.me;
      toast('Пароль сохранён');
      tabAccount(body);
    });
  };
}
function tabVoice(body) {
  const pos = (db) => Math.max(0, Math.min(100, ((db + 70) / 60) * 100));
  body.innerHTML = `<div class="st-sec"><h4>Проверка микрофона</h4>
      <div class="meter"><i id="mtLvl"></i><b id="mtThr" style="left:${pos(prefs.sens)}%"></b></div>
      <p class="hint2" id="mtHint">Скажи что-нибудь: зелёная полоса — твой голос, белая черта — порог. Ниже порога звук не передаётся.</p></div>
    <div class="st-sec"><h4>Шумы</h4>
      ${sw('gate', prefs.gate, 'Отсекать тапы, щелчки и фоновый шум', 'Передаётся только голос. Убирает звуки касаний по экрану и клавиатуры.')}
      ${sw('autoSens', prefs.autoSens, 'Чувствительность автоматически', 'Порог подстраивается под шум вокруг.')}
      <label ${prefs.autoSens ? 'hidden' : ''} id="sensRow">Порог: <span id="sensVal">${prefs.sens} дБ</span><input type="range" min="-70" max="-10" value="${prefs.sens}" data-range="sens"></label>
      ${sw('ns', prefs.ns, 'Шумоподавление', 'Встроенное в браузер. Применится при следующем входе в звонок.')}
      ${sw('ec', prefs.ec, 'Эхоподавление', 'Чтобы тебя не слышали собственным эхом.')}
      ${sw('agc', prefs.agc, 'Автоусиление микрофона')}</div>
    <div class="st-sec"><h4>Громкость</h4><label>Общая громкость собеседников: <span id="outVal">${Math.round(prefs.outVol * 100)}%</span><input type="range" min="0" max="100" value="${Math.round(prefs.outVol * 100)}" data-range="outVol"></label>
      <p class="hint2">Громкость каждого человека — в его карточке во время звонка.${isIOS ? ' На iPhone браузер меняет только включено/выключено.' : ''}</p></div>
    <div class="st-sec"><h4>Демонстрация экрана</h4>
      <div class="chips">${[['720p30', '720p · 30 к/с'], ['1080p30', '1080p · 30 к/с'], ['1080p60', '1080p · 60 к/с (игры)']].map(([k, t]) => `<button class="chip ${prefs.screenQ === k ? 'on' : ''}" data-screenq="${k}">${t}</button>`).join('')}</div>
      <p class="hint2">Чем выше качество, тем быстрее нужен интернет у тебя и у зрителей. Новое качество — со следующего показа. С телефона экран показывается до 20 к/с.</p>
      ${sw('screenAudio', prefs.screenAudio, 'Показывать со звуком', 'Звук игры или видео. На ПК в окне выбора включи «Поделиться звуком» (для всего экрана — звук системы).')}</div>
    <div class="st-sec"><h4>Если звук пропадает</h4><p class="hint2">Волна сама возвращает звук после прерываний: игр, других звонков, сворачивания. Если в игре включён свой голосовой чат, он может забирать микрофон — выключи его в настройках игры.</p></div>`;
  body.onclick = (e) => {
    const q = e.target.closest('[data-screenq]');
    if (!q) return;
    prefs.screenQ = q.dataset.screenq;
    savePrefs();
    $$('[data-screenq]', body).forEach((b) => b.classList.toggle('on', b === q));
  };
  bindPrefInputs(body, () => {
    $('#sensRow').hidden = prefs.autoSens;
    $('#mtThr').style.left = pos(prefs.sens) + '%';
    applyVoicePrefs();
  });
  startMicTest((d) => {
    if (!$('#mtLvl')) return;
    if (!d) { $('#mtHint').textContent = call?.native ? 'Во время звонка проверка недоступна — шумодав уже работает в звонке.' : 'Нет доступа к микрофону.'; return; }
    $('#mtLvl').style.width = pos(d.level) + '%';
    $('#mtLvl').classList.toggle('closed', !d.open);
    if (prefs.autoSens) $('#mtThr').style.left = pos(d.thr) + '%';
  });
}
function tabNotify(body) {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  body.innerHTML = `<div class="st-sec"><h4>Звуки</h4>
      ${sw('sounds', prefs.sounds, 'Звук новых сообщений', 'В статусе «Не беспокоить» звуков нет.')}
      ${sw('ringSound', prefs.ringSound, 'Мелодия входящего звонка')}
      <button class="btn sm" data-act="test-sound" style="align-self:flex-start">Проверить звук</button></div>
    <div class="st-sec"><h4>Уведомления</h4>
      ${perm === 'unsupported' ? '<p class="hint2">Этот браузер не умеет показывать уведомления.</p>' : sw('desktop', prefs.desktop && perm === 'granted', 'Показывать уведомления', perm === 'denied' ? 'Запрещено в настройках браузера — разреши там.' : 'Когда Волна свёрнута: личные сообщения, упоминания и звонки.')}</div>`;
  bindPrefInputs(body, async (name) => {
    if (name === 'desktop' && prefs.desktop && 'Notification' in window && Notification.permission !== 'granted') {
      const r = await Notification.requestPermission().catch(() => 'denied');
      if (r !== 'granted') { prefs.desktop = false; savePrefs(); toast('Уведомления не разрешены'); tabNotify(body); }
    }
  });
}
function tabLook(body) {
  const tiles = Object.entries(WALLS).map(([k, w]) => `<button class="wall-tile ${prefs.wall === k ? 'on' : ''}" data-wall="${k}" style="background:radial-gradient(60% 80% at 20% 20%, ${w.c[0]}, transparent 70%), radial-gradient(60% 80% at 90% 10%, ${w.c[1]}, transparent 70%), radial-gradient(70% 80% at 60% 100%, ${w.c[2]}, transparent 70%), ${w.base}">${w.name}</button>`).join('');
  body.innerHTML = `<div class="st-sec"><h4>Обои</h4><div class="walls">${tiles}<button class="wall-tile ${prefs.wall === 'custom' ? 'on' : ''}" data-wall="custom" style="${prefs.wallImg ? `background-image:url('${prefs.wallImg}')` : 'background:rgba(255,255,255,.08)'}">${prefs.wallImg ? 'Своя картинка' : '＋ Своя картинка'}</button></div></div>
    <div class="st-sec"><h4>Стекло</h4>
      <label>Прозрачность: <span id="glassVal">${Math.round((1 - prefs.glass / 0.25) * 100)}%</span><input type="range" min="0" max="25" value="${Math.round((0.25 - prefs.glass) * 100)}" data-range="glass"></label>
      <label>Размытие: <span id="blurVal">${prefs.blur}px</span><input type="range" min="0" max="50" value="${prefs.blur}" data-range="blur"></label>
      ${sw('still', prefs.still, 'Неподвижный фон', 'Экономит батарею.')}</div>
    <div class="st-sec"><h4>Текст</h4><label>Размер: <span id="fsVal">${prefs.fontSize}px</span><input type="range" min="13" max="19" value="${prefs.fontSize}" data-range="fontSize"></label></div>`;
  bindPrefInputs(body, applyLook);
  body.onclick = async (e) => {
    const t = e.target.closest('[data-wall]');
    if (!t) return;
    if (t.dataset.wall === 'custom' && (!prefs.wallImg || e.shiftKey || prefs.wall === 'custom')) {
      const f = await pickFile();
      if (!f) return;
      try { prefs.wallImg = (await prepImage(f, 'wall')).data; } catch (err) { return toast(err.message); }
    }
    prefs.wall = t.dataset.wall;
    savePrefs();
    applyLook();
    tabLook(body);
  };
}
function bindPrefInputs(body, after) {
  body.onchange = (e) => {
    const n = e.target.dataset.pref;
    if (!n) return;
    prefs[n] = e.target.checked;
    savePrefs();
    after?.(n);
  };
  body.oninput = (e) => {
    const n = e.target.dataset.range;
    if (!n) return;
    const v = +e.target.value;
    if (n === 'sens') { prefs.sens = v; $('#sensVal').textContent = v + ' дБ'; }
    if (n === 'outVol') { prefs.outVol = v / 100; $('#outVal').textContent = v + '%'; }
    if (n === 'glass') { prefs.glass = +(0.25 - v / 100).toFixed(3); $('#glassVal').textContent = Math.round((1 - prefs.glass / 0.25) * 100) + '%'; }
    if (n === 'blur') { prefs.blur = v; $('#blurVal').textContent = v + 'px'; }
    if (n === 'fontSize') { prefs.fontSize = v; $('#fsVal').textContent = v + 'px'; }
    savePrefs();
    after?.(n);
  };
}
