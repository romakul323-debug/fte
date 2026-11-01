'use strict';
/* =================== вход: обработчики =================== */
$('#serverToggle').onclick = async () => {
  const manual = !$('#serverField').hidden;
  if (manual) {
    store.set('serverManual', null);
    $('#serverField').hidden = true;
    $('#serverToggle').textContent = 'Указать свой сервер';
    await resolveServer();
    loadAuthOptions();
  } else {
    $('#serverField').hidden = false;
    $('#authServer').value = API;
    $('#authServer').focus();
    $('#serverToggle').textContent = 'Искать сервер автоматически';
  }
};
$('#authServer').addEventListener('change', () => {
  API = normUrl($('#authServer').value);
  store.set('serverUrl', API);
  store.set('serverManual', '1');
  loadAuthOptions();
});
$('#authSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  for (const x of $('#authSeg').children) x.classList.toggle('on', x === b);
  $('#authForm').hidden = b.dataset.tab !== 'pass';
  $('#codeForm').hidden = b.dataset.tab !== 'code';
  authErr('');
});
$('#authToggle').onclick = () => {
  registerMode = !registerMode;
  $('#loginLabel').textContent = registerMode ? 'Ник' : 'Ник или почта';
  $('#authUser').maxLength = registerMode ? 24 : 60;
  $('#authSubmit').textContent = registerMode ? 'Создать аккаунт' : 'Войти';
  $('#authToggle').textContent = registerMode ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Создать';
  $('#authPass').autocomplete = registerMode ? 'new-password' : 'current-password';
  authErr('');
};
$('#authForm').onsubmit = (e) => {
  e.preventDefault();
  withBusy($('#authSubmit'), async () => {
    loggedIn(await apiPost('/api/' + (registerMode ? 'register' : 'login'), { username: $('#authUser').value, password: $('#authPass').value }));
  });
};
let codeStep = 1;
function setCodeStep(n) {
  codeStep = n;
  $('#codeStep1').hidden = n !== 1;
  $('#codeStep2').hidden = n !== 2;
  $('#codeStep3').hidden = n !== 3;
  $('#codeLinks').hidden = n !== 2;
  $('#codeSubmit').textContent = n === 1 ? 'Получить код' : n === 2 ? 'Войти' : 'Создать аккаунт';
  const focus = { 1: '#codeEmail', 2: '#codeValue', 3: '#codeNick' }[n];
  if (!isTouch || n > 1) setTimeout(() => $(focus).focus(), 50);
}
async function sendCode() {
  const email = $('#codeEmail').value.trim();
  if (!email) throw new Error('Введи почту');
  await apiPost('/api/email/send', { email });
  $('#codeSentTo').textContent = `Код отправлен на ${email}. Проверь и папку «Спам».`;
  $('#codeValue').value = '';
  setCodeStep(2);
}
$('#codeForm').onsubmit = (e) => {
  e.preventDefault();
  withBusy($('#codeSubmit'), async () => {
    if (codeStep === 1) return sendCode();
    const body = { email: $('#codeEmail').value.trim(), code: $('#codeValue').value };
    if (codeStep === 3) body.username = $('#codeNick').value.trim();
    const d = await apiPost('/api/email/verify', body);
    if (d.needUsername) {
      $('#codeNick').value = body.email.split('@')[0].replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 24);
      return setCodeStep(3);
    }
    loggedIn(d);
  });
};
$('#codeValue').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  if (e.target.value.length === 6) $('#codeForm').requestSubmit();
});
$('#codeBack').onclick = () => { authErr(''); setCodeStep(1); };
$('#codeResend').onclick = () => withBusy($('#codeResend'), sendCode);
$('#googleBtn').onclick = () => withBusy($('#googleBtn'), async () => {
  await ensureApi();
  const url = (API || location.origin) + '/auth/google' + (isNative ? '?app=1' : '');
  const Browser = window.Capacitor?.Plugins?.Browser;
  if (isNative && Browser) await Browser.open({ url, presentationStyle: 'popover' });
  else location.href = url;
});
async function finishOAuth(code) {
  if (!code) return;
  showAuth();
  authErr('Входим…');
  try { loggedIn(await apiPost('/api/oauth/exchange', { code })); } catch (err) { authErr(isNetErr(err) ? netMsg() : err.message); }
}
if (isNative && window.Capacitor?.Plugins?.App) {
  const handleUrl = (url) => {
    const m = /[?&]code=([a-f0-9]+)/.exec(url || '');
    if (!m) return;
    window.Capacitor.Plugins.Browser?.close().catch?.(() => {});
    finishOAuth(m[1]);
  };
  window.Capacitor.Plugins.App.addListener('appUrlOpen', (e) => handleUrl(e.url));
  window.Capacitor.Plugins.App.getLaunchUrl?.().then((r) => r && handleUrl(r.url)).catch(() => {});
}

/* =================== поле ввода =================== */
const input = $('#msgInput');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; }
let lastTyping = 0;
input.addEventListener('input', () => {
  autosize();
  if (!S.editing && Date.now() - lastTyping > 2500 && input.value.trim()) { lastTyping = Date.now(); socket.emit('typing', { channelId: S.channelId }); }
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isTouch) { e.preventDefault(); sendMessage(); }
  else if (e.key === 'Escape' && (S.reply || S.editing)) { e.preventDefault(); cancelCompose(); }
  else if (e.key === 'ArrowUp' && !input.value && !S.editing) {
    const mine = (S.msgs[S.channelId] || []).filter((m) => m.author.id === S.user.id && m.text).pop();
    if (mine) { e.preventDefault(); startEdit(mine); }
  }
});
$('#composer').onsubmit = (e) => { e.preventDefault(); sendMessage(); if (!isTouch) input.focus(); };
function cancelCompose() {
  if (S.editing) input.value = '';
  S.reply = null;
  S.editing = null;
  autosize();
  renderComposeBar();
}
function startEdit(m) {
  S.editing = m;
  S.reply = null;
  input.value = m.text;
  autosize();
  renderComposeBar();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
function startReply(m) {
  S.reply = m;
  S.editing = null;
  renderComposeBar();
  input.focus();
}
async function sendMessage() {
  const text = input.value.trim();
  const chId = S.channelId;
  if (!chId) return;
  if (S.editing) {
    const m = S.editing;
    if (!text && !m.attachments?.length) return;
    cancelCompose();
    input.value = '';
    autosize();
    socket.emit('message:edit', { id: m.id, text }, (res) => res?.error && toast(res.error));
    return;
  }
  if (S.pending.some((p) => !p.id)) return toast('Картинки ещё загружаются…');
  const atts = S.pending.map((p) => ({ id: p.id, w: p.w, h: p.h }));
  if (!text && !atts.length) return;
  const replyTo = S.reply?.id || null;
  input.value = '';
  S.pending = [];
  S.reply = null;
  autosize();
  renderComposeBar();
  lastTyping = 0;
  socket.emit('message:send', { channelId: chId, text, replyTo, attachments: atts }, (res) => {
    if (res?.error) { toast(res.error); if (!input.value) { input.value = text; autosize(); } }
  });
}
async function addFiles(files) {
  const imgs = [...files].filter((f) => /^image\//.test(f.type)).slice(0, 6 - S.pending.length);
  if (!imgs.length) return;
  for (const f of imgs) {
    const item = { preview: URL.createObjectURL(f) };
    S.pending.push(item);
    renderComposeBar();
    uploadImage(f, 'attachment')
      .then((r) => { Object.assign(item, { id: r.id, w: r.w, h: r.h }); renderComposeBar(); })
      .catch((err) => { S.pending = S.pending.filter((x) => x !== item); renderComposeBar(); toast(err.message); });
  }
}
$('#attachBtn').innerHTML = ICON.image;
$('#emojiBtn').innerHTML = ICON.smile;
$('#sendBtn').innerHTML = ICON.send;
$('#attachBtn').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
$('#emojiBtn').onclick = (e) => showPicker(e.currentTarget, (emo) => {
  const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
  input.value = input.value.slice(0, a) + emo + input.value.slice(b);
  input.setSelectionRange(a + emo.length, a + emo.length);
  autosize();
  if (!isTouch) input.focus();
});
input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files); }
});
$('#textView').addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
$('#textView').addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
$('#messages').addEventListener('scroll', (e) => {
  if (e.target.scrollTop < 80 && S.hasMore[S.channelId] && !S.loading) loadHistory(S.channelId, true);
});

/* --- действия с сообщениями --- */
const msgById = (id) => (S.msgs[S.channelId] || []).find((m) => m.id === id);
$('#messages').addEventListener('click', (e) => {
  const row = e.target.closest('.msg');
  const sp = e.target.closest('.spoiler');
  if (sp) { sp.classList.toggle('open'); return; }
  const jump = e.target.closest('[data-jump]');
  if (jump) {
    const t = $(`.msg[data-mid="${CSS.escape(jump.dataset.jump)}"]`);
    if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash'); }
    else toast('Сообщение выше — пролистай историю');
    return;
  }
  const img = e.target.closest('[data-img]');
  if (img) { openViewer(img.dataset.img); return; }
  if (!row) return;
  const m = msgById(row.dataset.mid);
  const act = e.target.closest('[data-mact]')?.dataset.mact;
  const react = e.target.closest('[data-react]')?.dataset.react;
  if (react && m) { reactTo(m, react); return; }
  if (act && m) {
    msgAction(act, m, e.target.closest('[data-mact]'));
    row.classList.remove('sel');
    return;
  }
  if (e.target.closest('a,button,[data-user]')) return;
  if (isTouch && m) {
    // телефон: один тап — меню снизу, два быстрых тапа — ❤️
    if (tapT && tapRow === row) { clearTimeout(tapT); tapT = null; reactTo(m, '❤️'); return; }
    clearTimeout(tapT);
    tapRow = row;
    tapT = setTimeout(() => { tapT = null; if (!swiped) openMsgSheet(row, m); }, 260);
    return;
  }
  $$('.msg.sel').forEach((x) => x !== row && x.classList.remove('sel'));
  row.classList.toggle('sel');
});
let tapT = null, tapRow = null;
const reactTo = (m, emo) => socket.emit('message:react', { id: m.id, emoji: emo }, (r) => r?.error && toast(r.error));
function msgAction(act, m, anchor) {
  if (act === 'reply') startReply(m);
  else if (act === 'edit') startEdit(m);
  else if (act === 'copy') navigator.clipboard?.writeText(m.text).then(() => toast('Скопировано'), () => toast('Не получилось скопировать'));
  else if (act === 'react') showPicker(anchor, (emo) => reactTo(m, emo));
  else if (act === 'del' && confirm('Удалить сообщение?')) socket.emit('message:delete', { id: m.id }, (r) => r?.error && toast(r.error));
}
// двойной клик по сообщению на ПК — ❤️
$('#messages').addEventListener('dblclick', (e) => {
  const row = e.target.closest('.msg');
  if (isTouch || !row || e.target.closest('a,button,[data-img]')) return;
  socket.emit('message:react', { id: row.dataset.mid, emoji: '❤️' });
});

/* меню сообщения снизу экрана (телефон) */
const SHEET_ACTS = { reply: [ICON.reply, 'Ответить'], copy: [ICON.copy, 'Скопировать текст'], edit: [ICON.edit, 'Изменить'], del: [ICON.trash, 'Удалить'] };
function openMsgSheet(row, m) {
  closeSheet();
  const acts = [...row.querySelectorAll('.msg-tools [data-mact]')].map((b) => b.dataset.mact).filter((a) => SHEET_ACTS[a]);
  const prev = (m.text || (m.attachments?.length ? '🖼 Картинка' : '')).slice(0, 140);
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet glass"><i class="grab"></i>
    <div class="sheet-react">${QUICK.slice(0, 6).map((e) => `<button data-sr="${e}">${e}</button>`).join('')}<button data-sa="react" class="more">${ICON.smile}</button></div>
    <div class="sheet-prev"><b>${esc(dname(userOf(m.author)))}</b> ${esc(prev)}</div>
    ${acts.map((a) => `<button class="sheet-row ${a === 'del' ? 'danger' : ''}" data-sa="${a}">${SHEET_ACTS[a][0]}<span>${SHEET_ACTS[a][1]}</span></button>`).join('')}</div>`;
  document.body.appendChild(bg);
  requestAnimationFrame(() => bg.classList.add('on'));
  bg.onclick = (e) => {
    const r = e.target.closest('[data-sr]');
    const a = e.target.closest('[data-sa]');
    if (r) { reactTo(m, r.dataset.sr); closeSheet(); return; }
    if (a) { closeSheet(); setTimeout(() => msgAction(a.dataset.sa, m, a.dataset.sa === 'react' ? $('#composer') : null), 10); return; }
    if (!e.target.closest('.sheet')) closeSheet();
  };
}
function closeSheet() { $$('.sheet-bg').forEach((x) => x.remove()); }

/* свайп сообщения вправо — ответить (как в Telegram) */
let sw0 = null, swiped = false;
$('#messages').addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  const row = e.target.closest('.msg');
  swiped = false;
  sw0 = row && t.clientX > 30 ? { x: t.clientX, y: t.clientY, row, dx: 0, lock: null } : null;
}, { passive: true });
$('#messages').addEventListener('touchmove', (e) => {
  if (!sw0) return;
  const t = e.touches[0];
  const dx = t.clientX - sw0.x, dy = t.clientY - sw0.y;
  if (sw0.lock === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) sw0.lock = Math.abs(dx) > Math.abs(dy) * 1.4 && dx > 0;
  if (!sw0.lock) return;
  sw0.dx = Math.max(0, Math.min(90, dx));
  sw0.row.style.transform = `translateX(${sw0.dx}px)`;
  sw0.row.classList.toggle('swipe-go', sw0.dx > 60);
}, { passive: true });
$('#messages').addEventListener('touchend', () => {
  if (!sw0) return;
  const { row, dx, lock } = sw0;
  sw0 = null;
  if (!lock) return;
  swiped = true;
  row.style.transition = 'transform .18s';
  row.style.transform = '';
  setTimeout(() => { row.style.transition = ''; row.classList.remove('swipe-go'); }, 200);
  const m = msgById(row.dataset.mid);
  if (dx > 60 && m) { navigator.vibrate?.(8); startReply(m); }
});

/* =================== клики =================== */
const ACT = {
  'add-server': addServerModal,
  invite: inviteModal,
  'server-menu': serverMenu,
  'new-channel': (el) => newChannelModal(el.dataset.type),
  'new-dm': newDmModal,
  'join-voice': (el) => { if (findChannel(el.dataset.ch)?.type === 'dm') S.dmView = 'call'; joinVoice(el.dataset.ch); },
  'open-call': () => { if (call) { openAnyChannel(call.channelId); if (dmById(call.channelId)) { S.dmView = 'call'; renderMain(); } } },
  'dm-call': () => { const ch = curChannel(); if (ch?.type === 'dm') { S.dmView = 'call'; renderMain(); joinVoice(ch.id); } },
  'dm-view': () => { S.dmView = S.dmView === 'call' ? 'chat' : 'call'; renderMain(); },
  mute: toggleMute,
  deafen: toggleDeafen,
  camera: toggleCamera,
  screen: toggleScreen,
  leave: leaveVoice,
  logout: () => { if (confirm('Выйти из аккаунта?')) logout(); },
  settings: (el) => openSettings(el.dataset.tab),
  'close-settings': closeSettings,
  'save-profile': saveProfile,
  'reset-profile': () => openSettings('profile'),
  'cancel-compose': cancelCompose,
  'test-sound': () => { const was = prefs.sounds; prefs.sounds = true; sfx('mention'); prefs.sounds = was; },
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
const KEEP_MODAL = ['del-channel', 'del-server', 'leave-server'];
document.addEventListener('click', (e) => {
  if (popover && !e.target.closest('.popover') && !e.target.closest('#emojiBtn,[data-mact="react"]')) closePopover();
  const t = e.target.closest('[data-act],[data-srv],[data-ch],[data-tile],[data-user],[data-dm],[data-dmcall],[data-setstatus]');
  if (!t) return;
  if (t.dataset.act) {
    if (t.closest('#modal') && !KEEP_MODAL.includes(t.dataset.act)) closeModal();
    if (t.closest('.popover')) closePopover();
    return ACT[t.dataset.act]?.(t);
  }
  if (t.dataset.setstatus) return setStatus(t.dataset.setstatus);
  if (t.dataset.dm) return openDm(t.dataset.dm);
  if (t.dataset.dmcall) {
    const uid = t.dataset.dmcall;
    socket.emit('dm:open', { userId: uid }, (res) => {
      if (res?.error) return toast(res.error);
      upsertDm(res.dm);
      closePopover();
      selectServer('home', res.dm.id);
      S.dmView = 'call';
      renderMain();
      joinVoice(res.dm.id);
    });
    return;
  }
  if (t.dataset.srv) return selectServer(t.dataset.srv);
  if (t.dataset.ch) {
    const ch = findChannel(t.dataset.ch);
    if (!ch) return;
    if (ch.type === 'voice' && call?.channelId !== ch.id) joinVoice(ch.id);
    return openChannel(ch.id);
  }
  if (t.dataset.tile) {
    S.focus = S.focus === t.dataset.tile ? null : t.dataset.tile;
    return renderTiles();
  }
  if (t.dataset.user) return showCard(t.dataset.user, t);
});
document.addEventListener('input', (e) => {
  const v = e.target.dataset?.vol;
  if (!v) return;
  setUserVolume(v, +e.target.value / 100);
  const lbl = e.target.closest('.pc-sec')?.querySelector('[data-volval]');
  if (lbl) lbl.textContent = e.target.value + '%';
});

/* =================== телефон и прочее =================== */
// телефон: главный экран — список чатов и каналов, чат открывается поверх, «‹» возвращает к списку
$('#menuBtn').innerHTML = ICON.back;
$('#membersBtn').innerHTML = ICON.users;
function closeDrawer() { document.body.classList.remove('drawer'); }
$('#menuBtn').onclick = () => { closeSheet(); document.body.classList.add('drawer'); };
$('#membersBtn').onclick = () => document.body.classList.toggle('show-members');
$('#netChange').onclick = () => { store.set('token', null); store.set('serverManual', '1'); location.reload(); };
$('#netChange').hidden = !isShell || !!FIXED;
$('#scrim').onclick = () => document.body.classList.remove('drawer', 'show-members');
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('.viewer')) return $('.viewer').remove();
  if ($('.sheet-bg')) return closeSheet();
  if (popover) return closePopover();
  if ($('#settings')) return closeSettings();
  closeModal();
  document.body.classList.remove('drawer');
});
// свайп вправо от края — назад к списку (телефон)
let touchX = null;
document.addEventListener('touchstart', (e) => { const t = e.touches[0]; touchX = t.clientX < 30 && !$('#settings') && !$('.sheet-bg') ? t.clientX : null; }, { passive: true });
document.addEventListener('touchend', (e) => { if (touchX != null && e.changedTouches[0].clientX - touchX > 60) document.body.classList.add('drawer'); touchX = null; }, { passive: true });
if (window.visualViewport) {
  const fit = () => { document.documentElement.style.setProperty('--app-h', visualViewport.height + 'px'); window.scrollTo(0, 0); };
  visualViewport.addEventListener('resize', fit);
  fit();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  unseen = 0;
  document.title = 'Волна';
  if (S.channelId && (S.unread[S.channelId] || S.mentions[S.channelId])) { delete S.unread[S.channelId]; delete S.mentions[S.channelId]; renderServers(); renderSidebar(); }
  onAppVisible();
  if (socket && !socket.connected) socket.connect();
});
window.addEventListener('pageshow', () => onAppVisible());
if (!isNative && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (isNative) document.body.classList.add('native');

/* =================== старт =================== */
if (innerWidth > 1180) document.body.classList.add('show-members');
if (innerWidth <= 860) document.body.classList.add('drawer');
(async () => {
  const hashLogin = /^#login=([a-f0-9]+)$/.exec(location.hash);
  if (hashLogin) { history.replaceState(null, '', location.pathname); return finishOAuth(hashLogin[1]); }
  if (isShell && !API) await resolveServer();
  else if (isShell) resolveServer();
  if (S.token) start(); else showAuth();
})();
