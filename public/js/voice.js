'use strict';
/* =================== голос: WebRTC + запасной путь через сервер =================== */
let call = null;              // текущий звонок
const peers = new Map();      // socketId -> peer
let audioCtx = null;
const meters = new Map();     // socketId -> анализатор громкости
let rejoin = null;            // куда вернуться после обрыва связи

function ensureCtx() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  } catch {}
  return audioCtx;
}
async function loadWorklet() {
  if (!audioCtx?.audioWorklet) return false;
  if (audioCtx.__wl) return audioCtx.__wl;
  audioCtx.__wl = audioCtx.audioWorklet.addModule('relay-worklet.js?v=3').then(() => true).catch((e) => { console.warn('worklet', e); return false; });
  return audioCtx.__wl;
}
const micConstraints = () => ({ audio: { echoCancellation: prefs.ec, noiseSuppression: prefs.ns, autoGainControl: prefs.agc, channelCount: 1 }, video: false });
const gateParams = () => ({ enabled: prefs.gate, auto: prefs.autoSens, threshold: prefs.sens });

/* --- веб-версия: удерживаем звонок, когда страницу свернули --- */
const keepAlive = (() => {
  let el = null;
  function silentWav() {
    const n = 8000, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
    const str = (o, t) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
    let bin = ''; for (const x of b) bin += String.fromCharCode(x);
    return 'data:audio/wav;base64,' + btoa(bin);
  }
  return {
    start(title) {
      if (isNative) return;
      try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch {}
      try {
        if (!el) { el = new Audio(silentWav()); el.loop = true; el.setAttribute('playsinline', ''); document.body.appendChild(el); }
        el.play().catch(() => {});
      } catch {}
      const ms = navigator.mediaSession;
      if (ms) {
        try {
          ms.metadata = new MediaMetadata({ title: title || 'Голосовой канал', artist: 'Волна — вы в звонке', artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
          ms.playbackState = 'playing';
        } catch {}
        for (const [a, fn] of [['pause', () => el?.play().catch(() => {})], ['play', () => el?.play().catch(() => {})], ['hangup', () => leaveVoice()], ['togglemicrophone', () => toggleMute()]])
          try { ms.setActionHandler(a, fn); } catch {}
      }
    },
    stop() {
      if (isNative) return;
      try { el?.pause(); } catch {}
      const ms = navigator.mediaSession;
      if (ms) { try { ms.metadata = null; ms.playbackState = 'none'; } catch {} }
      try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch {}
    },
    resume() { if (!isNative && el && el.paused && call) el.play().catch(() => {}); },
  };
})();

/* --- «служба звонка» в приложениях Android/iOS --- */
let nativeCallPlugin;
const nativeCall = () => {
  if (nativeCallPlugin === undefined) {
    const C = window.Capacitor;
    nativeCallPlugin = !isNative || !C ? null : C.Plugins?.VolnaCall || (C.registerPlugin ? C.registerPlugin('VolnaCall') : null);
  }
  return nativeCallPlugin;
};

/* --- приложение на iPhone: звук звонка ведёт нативный код (iOS не глушит его в фоне) --- */
const isIOSApp = isNative && window.Capacitor?.getPlatform?.() === 'ios';
let nativeAudioOk = null, nativeBound = false, nativeChecked = false;
const nativeSpeaking = new Set();
const speakingNow = (id) => !!(meters.get(id)?.speaking || nativeSpeaking.has(id));
async function hasNativeAudio() {
  if (!isIOSApp || !nativeCall()) return false;
  if (nativeAudioOk !== null) return nativeAudioOk;
  try {
    const r = await Promise.race([nativeCall().caps(), new Promise((_, no) => setTimeout(no, 2000))]);
    nativeAudioOk = !!r?.audio;
  } catch { nativeAudioOk = false; }
  if (nativeAudioOk) bindNativeEvents();
  return nativeAudioOk;
}
function bindNativeEvents() {
  if (nativeBound || !nativeCall()) return;
  nativeBound = true;
  const pl = nativeCall();
  pl.addListener('levels', (d) => {
    const now = new Set(d?.ids || []);
    if (d?.me && call?.selfId) now.add(call.selfId);
    for (const id of new Set([...now, ...nativeSpeaking])) {
      const on = now.has(id);
      if (on === nativeSpeaking.has(id)) continue;
      if (on) nativeSpeaking.add(id); else nativeSpeaking.delete(id);
      $$(`[data-speak="${CSS.escape(id)}"]`).forEach((el) => el.classList.toggle('speaking', on));
    }
  });
  pl.addListener('ended', () => {
    if (!call?.native) return;
    socket?.emit('voice:leave');
    cleanupCall(true);
    toast('Звонок прервался');
  });
}
const nativeUrl = (leg) => ((typeof API !== 'undefined' && API) || location.origin).replace(/^http/i, 'ws') + '/nv?t=' + encodeURIComponent(leg);
function nativeVols() {
  const vols = {};
  for (const s of S.voice[call?.channelId] || [])
    if (s.socketId !== call.selfId) vols[s.socketId] = Math.max(0, Math.min(1, (prefs.vol[s.userId] != null ? prefs.vol[s.userId] : 1) * prefs.outVol));
  return vols;
}
function syncNative() {
  if (!call?.native || !call.started) return;
  nativeCall().setState({ muted: call.muted, deafened: call.deafened, gate: gateParams(), vols: nativeVols() }).catch(() => {});
}
function joinNativeVoice(chId, opts) {
  hideRing();
  const ch = findChannel(chId);
  if (ch?.type === 'dm' && S.channelId === chId) { S.dmView = 'call'; renderMain(); }
  const me = (call = { native: true, started: false, channelId: chId, selfId: null, leg: null, mic: true, muted: !!opts.muted, deafened: !!opts.deafened, prevMuted: false, video: false, screen: false, since: Date.now() });
  socket.emit('voice:join', { channelId: chId, muted: me.muted, native: true }, async (res) => {
    if (call !== me) { if (res?.leg) socket.emit('voice:leave'); return; }
    if (res?.error || !res?.leg) { toast(res?.error || 'Не получилось подключиться'); cleanupCall(); return; }
    me.selfId = res.selfId;
    me.leg = res.leg;
    renderSidebar();
    renderMain();
    let r;
    try {
      r = await nativeCall().startAudio({ url: nativeUrl(res.leg), leg: res.leg, channelId: chId, selfId: res.selfId, title: ch?.name || 'Голосовой канал', muted: me.muted, deafened: me.deafened, gate: gateParams(), vols: nativeVols() });
    } catch (e) {
      if (call === me) { toast('Не удалось включить звук звонка'); leaveVoice(); }
      return;
    }
    if (call !== me) { nativeCall().stopAudio().catch(() => {}); return; }
    me.started = true;
    if (r?.nomic) {
      me.muted = true;
      me.mic = null;
      toast('Нет доступа к микрофону — разреши его: Настройки iPhone → Волна → Микрофон');
    }
    if (me.muted || me.deafened) socket.emit('voice:update', { muted: me.muted, deafened: me.deafened });
    syncNative();
    renderSidebar();
    renderMain();
  });
  renderSidebar();
}
// WebView проснулся/переподключился — звук всё это время шёл в приложении, просто возвращаем интерфейс к звонку
function reattachNative(me) {
  socket.emit('voice:reattach', { leg: me.leg }, (res) => {
    if (call !== me) return;
    if (res?.error) {
      nativeCall().stopAudio().catch(() => {});
      cleanupCall(true);
      toast('Звонок завершился');
      return;
    }
    me.detached = false;
    me.selfId = res.selfId;
    renderSidebar();
    renderMain();
  });
}
async function restoreNativeCall() {
  if (!(await hasNativeAudio()) || call) return;
  let st = null;
  try { st = await nativeCall().status(); } catch {}
  if (!st?.active || !st.leg || call) return;
  const me = (call = { native: true, started: true, channelId: st.channelId, selfId: st.selfId, leg: st.leg, mic: true, muted: !!st.muted, deafened: !!st.deafened, prevMuted: false, video: false, screen: false, since: Date.now() });
  reattachNative(me);
}

/* --- микрофон → шумодав → отправка --- */
async function buildPipeline(me) {
  if (!me.mic) return;
  const ok = await loadWorklet();
  if (call !== me || !ok || !audioCtx) return;
  try {
    me.src = audioCtx.createMediaStreamSource(me.mic);
    me.gate = new AudioWorkletNode(audioCtx, 'volna-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    me.gate.port.postMessage({ ...gateParams(), muted: me.muted });
    me.dest = audioCtx.createMediaStreamDestination();
    me.src.connect(me.gate).connect(me.dest);
    me.procTrack = me.dest.stream.getAudioTracks()[0];
    me.procTrack.enabled = !me.muted;
  } catch (e) { console.warn('pipeline', e); me.gate = null; me.procTrack = null; }
}
// какой звук отправлять: обработанный (с шумодавом), если движок звука работает, иначе прямой с микрофона
function wantedTrack() {
  if (!call?.mic) return null;
  const raw = call.mic.getAudioTracks()[0];
  if (call.procTrack && audioCtx?.state === 'running') return call.procTrack;
  return raw;
}
function applySendTrack(force) {
  if (!call) return;
  const t = wantedTrack();
  if (!force && t === call.sendTrack) return;
  call.sendTrack = t;
  for (const p of peers.values()) if (p.audioSender) p.audioSender.replaceTrack(t).catch(() => {});
}
function tuneSender(sender) {
  try {
    const p = sender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].priority = 'high';
    p.encodings[0].networkPriority = 'high';
    p.encodings[0].maxBitrate = 64000;
    sender.setParameters(p).catch(() => {});
  } catch {}
}

async function joinVoice(chId, opts = {}) {
  if (call?.channelId === chId) return;
  if (call) leaveVoice();
  if (await hasNativeAudio()) { if (!call) joinNativeVoice(chId, opts); return; }
  if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) return toast('Звонки работают только по HTTPS');
  hideRing();
  const ch = findChannel(chId);
  if (ch?.type === 'dm' && S.channelId === chId) { S.dmView = 'call'; renderMain(); }
  const me = (call = { channelId: chId, selfId: socket.id, mic: null, muted: !!opts.muted, deafened: !!opts.deafened, prevMuted: false, video: false, screen: false, videoTrack: null, localVideo: null, since: Date.now() });
  keepAlive.start(ch?.type === 'dm' ? 'Звонок: ' + ch.name : ch?.name);
  ensureCtx();
  try { me.mic = await navigator.mediaDevices.getUserMedia(micConstraints()); }
  catch { toast('Нет доступа к микрофону — подключаюсь только слушать'); me.muted = true; }
  if (call !== me) { me.mic?.getTracks().forEach((t) => t.stop()); return; }
  await buildPipeline(me);
  if (call !== me) return;
  applySendTrack(true);
  setMic(!me.muted);
  socket.emit('voice:join', { channelId: chId, muted: me.muted }, (res) => {
    if (call !== me) return;
    if (res?.error) { toast(res.error); cleanupCall(); return; }
    me.selfId = socket.id;
    if (me.gate) addMeter(me.selfId, me.gate); else if (me.mic) addMeter(me.selfId, me.mic);
    if (me.deafened) applyDeafen();
    if (me.muted || me.deafened) socket.emit('voice:update', { muted: me.muted, deafened: me.deafened });
    startRelay(me);
    nativeCall()?.start({ title: ch?.name || 'Голосовой канал' }).catch(() => {});
    // соединение начинает тот, кто вошёл; остальные ждут его предложения — так не бывает «встречных» предложений
    for (const p of res.peers) ensurePeer(p.socketId, true, p.native);
    me.watch = setInterval(() => watchdog(me), 1500);
    sfx('join');
    renderSidebar();
    renderMain();
  });
  renderSidebar();
}

function signal(to, data) { socket.emit('voice:signal', { to, data }); }

function ensurePeer(id, initiator, native) {
  if (peers.has(id)) return peers.get(id);
  if (native) {
    // участник из приложения на iPhone: звук только через сервер, без прямого соединения
    const p = { id, native: true, pc: null, created: Date.now(), relay: true, badSince: 0, chain: Promise.resolve(), audioEl: document.createElement('audio'), videoEl: document.createElement('video') };
    peers.set(id, p);
    applyPeerVolume(p);
    return p;
  }
  const pc = new RTCPeerConnection({ iceServers: S.ice });
  const p = { id, pc, created: Date.now(), relay: false, polite: !initiator, waitOffer: !initiator, chain: Promise.resolve(), makingOffer: false, ignoreOffer: false, badSince: 0, lastRestart: 0, videoSender: null, audioEl: document.createElement('audio'), videoEl: document.createElement('video') };
  p.audioEl.autoplay = true;
  p.audioEl.setAttribute('playsinline', '');
  p.audioEl.muted = !!call?.deafened;
  $('#audios').appendChild(p.audioEl);
  p.videoEl.autoplay = true;
  p.videoEl.muted = true;
  p.videoEl.playsInline = true;
  p.videoEl.setAttribute('playsinline', '');
  peers.set(id, p);
  applyPeerVolume(p);

  if (call?.sendTrack) { p.audioSender = pc.addTrack(call.sendTrack); tuneSender(p.audioSender); }
  else p.audioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
  if (call?.videoTrack) p.videoSender = pc.addTrack(call.videoTrack);

  const negotiate = async () => {
    if (p.waitOffer || pc.signalingState === 'closed') return;
    try {
      p.makingOffer = true;
      await pc.setLocalDescription();
      signal(id, { description: pc.localDescription });
    } catch (e) { console.warn(e); } finally { p.makingOffer = false; }
  };
  pc.onnegotiationneeded = negotiate;
  p.negotiate = negotiate;
  // если предложение так и не пришло — начинаем сами
  if (p.waitOffer) p.waitTimer = setTimeout(() => { if (p.waitOffer && !pc.remoteDescription) { p.waitOffer = false; negotiate(); } }, 3500);
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
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') p.badSince = 0;
    else if ((st === 'disconnected' || st === 'failed') && !p.badSince) p.badSince = Date.now();
    if (st === 'failed') restartPeer(p);
    if (S.channelId === call?.channelId) renderTiles();
  };
  return p;
}
function restartPeer(p) {
  if (!p.pc) return;
  if (Date.now() - p.lastRestart < 8000) return;
  p.lastRestart = Date.now();
  try { p.pc.restartIce(); } catch {}
}

// сигналы обрабатываем строго по очереди: иначе кандидаты маршрута могут обогнать описание соединения
function onSignal(from, data) {
  const p = ensurePeer(from, false);
  if (!p.pc) return;
  p.chain = p.chain.then(() => handleSignal(p, data)).catch(() => {});
}
async function handleSignal(p, { description, candidate }) {
  const pc = p.pc;
  const from = p.id;
  try {
    if (description) {
      const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
      p.ignoreOffer = !p.polite && collision;
      if (p.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (p.waitOffer) { p.waitOffer = false; clearTimeout(p.waitTimer); }
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
  clearTimeout(p.waitTimer);
  try { p.pc?.close(); } catch {}
  p.audioEl.srcObject = null;
  p.audioEl.remove();
  p.videoEl.srcObject = null;
  p.videoEl.remove();
  removeMeter(id);
  try { p.player?.disconnect(); p.relayGain?.disconnect(); } catch {}
  peers.delete(id);
}

function leaveVoice() {
  rejoin = null;
  if (!call) return;
  socket?.emit('voice:leave');
  sfx('leave');
  cleanupCall();
}

function cleanupCall(keepService) {
  if (!call) return;
  if (call.native) {
    if (!keepService) nativeCall()?.stopAudio().catch(() => {});
    for (const id of nativeSpeaking) $$(`[data-speak="${CSS.escape(id)}"]`).forEach((el) => el.classList.remove('speaking'));
    nativeSpeaking.clear();
    call = null;
    renderSidebar();
    renderMain();
    return;
  }
  if (!keepService) { nativeCall()?.stop().catch(() => {}); keepAlive.stop(); }
  for (const id of [...peers.keys()]) closePeer(id);
  clearInterval(call.watch);
  clearInterval(call.relayTimer);
  call.mic?.getTracks().forEach((t) => t.stop());
  call.videoTrack?.stop();
  try { call.capture?.disconnect(); call.src?.disconnect(); call.gate?.disconnect(); } catch {}
  removeMeter(call.selfId);
  call = null;
  $('#unlock')?.remove();
  renderSidebar();
  renderMain();
}

// связь с сервером пропала — запоминаем звонок и вернёмся в него, когда она появится
function onSocketLost() {
  if (call?.native) { call.detached = true; return; } // звук в приложении продолжает идти сам
  if (!call) return;
  rejoin = { channelId: call.channelId, muted: call.muted, deafened: call.deafened };
  cleanupCall(true);
  toast('Связь пропала — верну в звонок, как только она появится');
}
function onSocketBack() {
  if (call?.native) return reattachNative(call);
  if (!call && !rejoin && isIOSApp && !nativeChecked) { nativeChecked = true; restoreNativeCall(); }
  if (!rejoin || call) return;
  const r = rejoin;
  rejoin = null;
  if (findChannel(r.channelId)) joinVoice(r.channelId, r).then(() => toast('Снова в звонке'));
  else { nativeCall()?.stop().catch(() => {}); keepAlive.stop(); }
}

function pushVoiceState() {
  if (!call) return;
  call.capture?.port.postMessage({ on: !call.muted });
  call.gate?.port.postMessage({ muted: call.muted });
  socket.emit('voice:update', { muted: call.muted, deafened: call.deafened, video: call.video, screen: call.screen });
  syncNative();
  renderVoicePanel();
  if (S.channelId === call.channelId) renderTiles();
}
function setMic(on) {
  if (!call || call.native) return;
  call.mic?.getAudioTracks().forEach((t) => (t.enabled = on));
  if (call.procTrack) call.procTrack.enabled = on;
}
function toggleMute() {
  if (!call) return;
  if (!call.mic) return toast('Микрофон недоступен');
  if (call.deafened) { call.deafened = false; applyDeafen(); }
  call.muted = !call.muted;
  setMic(!call.muted);
  pushVoiceState();
}
function applyDeafen() { if (call?.native) return syncNative(); for (const p of peers.values()) applyPeerVolume(p); }
function toggleDeafen() {
  if (!call) return;
  call.deafened = !call.deafened;
  applyDeafen();
  if (call.deafened) { call.prevMuted = call.muted; call.muted = true; }
  else call.muted = call.prevMuted || !call.mic;
  setMic(!call.muted);
  pushVoiceState();
}

/* громкость каждого участника (на iPhone браузер громкость не меняет — только вкл/выкл) */
function peerUserId(p) { return (S.voice[call?.channelId] || []).find((s) => s.socketId === p.id)?.userId; }
function applyPeerVolume(p) {
  const uid = peerUserId(p);
  const v = call?.deafened ? 0 : Math.max(0, Math.min(1, (uid && prefs.vol[uid] != null ? prefs.vol[uid] : 1) * prefs.outVol));
  p.audioEl.volume = v;
  p.audioEl.muted = v === 0;
  if (p.relayGain) p.relayGain.gain.value = v;
}
function setUserVolume(userId, v) {
  prefs.vol[userId] = v;
  savePrefs();
  for (const p of peers.values()) applyPeerVolume(p);
  syncNative();
}

const nativeNoVideo = () => toast('В приложении на iPhone пока только голос. Видео — в браузере или на ПК');
async function toggleCamera() {
  if (!call) return;
  if (call.native) return nativeNoVideo();
  if (call.video && !call.screen) return setVideo(null, false);
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } });
    setVideo(s.getVideoTracks()[0], false);
  } catch { toast('Нет доступа к камере'); }
}
async function toggleScreen() {
  if (!call) return;
  if (call.native) return nativeNoVideo();
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
    if (!p.pc) continue;
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

/* --- запасной путь для голоса — через сервер, когда напрямую не соединилось --- */
async function startRelay(me) {
  if (!(await loadWorklet()) || call !== me) return;
  if (me.mic) {
    try {
      const from = me.gate || (me.src = me.src || audioCtx.createMediaStreamSource(me.mic));
      me.capture = new AudioWorkletNode(audioCtx, 'volna-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const sink = audioCtx.createGain();
      sink.gain.value = 0;
      from.connect(me.capture).connect(sink).connect(audioCtx.destination);
      me.capture.port.postMessage({ on: !me.muted });
      me.capture.port.onmessage = (e) => { if (call === me && me.relaySend && !me.muted) socket.volatile.emit('voice:audio', e.data); };
    } catch (e) { console.warn('relay', e); }
  }
  me.relayTimer = setInterval(() => {
    if (call !== me) return;
    let changed = false;
    for (const p of peers.values()) {
      const ok = p.pc?.connectionState === 'connected';
      const want = p.native || (!ok && Date.now() - p.created > 5000);
      if (want !== p.relay) { p.relay = want; changed = true; }
    }
    me.relaySend = [...peers.values()].some((p) => p.relay);
    if (changed && S.channelId === me.channelId) renderTiles();
  }, 1000);
}
function playRelay(from, data) {
  const p = peers.get(from);
  if (!p || !p.relay || !audioCtx) return;
  if (!p.player) {
    try {
      p.player = new AudioWorkletNode(audioCtx, 'volna-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      p.relayGain = audioCtx.createGain();
      p.player.connect(p.relayGain).connect(audioCtx.destination);
      applyPeerVolume(p);
      addMeter(from, p.player);
    } catch { return; }
  }
  p.player.port.postMessage(data, [data]);
}

/* --- сторож звонка: чинит звук после прерываний (игры, другие приложения, сворачивание) --- */
function watchdog(me) {
  if (call !== me) return;
  if (audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  applySendTrack();
  keepAlive.resume();
  for (const p of peers.values()) {
    if (p.audioEl.srcObject && p.audioEl.paused) p.audioEl.play().catch(() => {});
    // подвисло соединение — перезапускаем маршрут, не дожидаясь полного обрыва
    if (p.badSince && Date.now() - p.badSince > 4000) restartPeer(p);
  }
  const raw = me.mic?.getAudioTracks()[0];
  if (raw && raw.readyState === 'ended') reviveMic();
}
// Если система отобрала микрофон (другое приложение, сворачивание) — берём его заново
let reviving = false;
async function reviveMic() {
  if (!call?.mic || reviving) return;
  const old = call.mic.getAudioTracks()[0];
  if (old && old.readyState === 'live') return;
  const me = call;
  reviving = true;
  let fresh;
  try { fresh = await navigator.mediaDevices.getUserMedia(micConstraints()); } catch { reviving = false; return; }
  reviving = false;
  if (call !== me) { fresh.getTracks().forEach((t) => t.stop()); return; }
  me.mic.getTracks().forEach((t) => t.stop());
  me.mic = fresh;
  if (me.gate && audioCtx) {
    try { me.src?.disconnect(); } catch {}
    me.src = audioCtx.createMediaStreamSource(fresh);
    me.src.connect(me.gate);
  }
  setMic(!me.muted);
  applySendTrack(true);
}
function onAppVisible() {
  if (!call) return;
  ensureCtx();
  keepAlive.resume();
  for (const p of peers.values()) if (p.audioEl.srcObject) p.audioEl.play().catch(() => {});
  reviveMic();
}

/* --- индикатор «говорит» --- */
function addMeter(id, src) {
  if (!audioCtx || !id) return;
  removeMeter(id);
  try {
    const node = src instanceof AudioNode ? src : audioCtx.createMediaStreamSource(src);
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    node.connect(an);
    meters.set(id, { node, an, own: !(src instanceof AudioNode), buf: new Uint8Array(an.fftSize), speaking: false });
    if (!meterLoop) meterLoop = requestAnimationFrame(tickMeters);
  } catch {}
}
function removeMeter(id) {
  const m = meters.get(id);
  if (m) { try { m.node.disconnect(m.an); } catch {} meters.delete(id); }
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
    let speaking = Math.sqrt(sum / m.buf.length) > 0.02;
    if (call && id === call.selfId && call.muted) speaking = false;
    if (speaking !== m.speaking) {
      m.speaking = speaking;
      $$(`[data-speak="${CSS.escape(id)}"]`).forEach((el) => el.classList.toggle('speaking', speaking));
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
    ensureCtx();
    $$('#audios audio').forEach((a) => a.play().catch(() => {}));
    b.remove();
  };
  document.body.appendChild(b);
}

/* --- проверка микрофона в настройках --- */
let micTest = null;
async function startMicTest(onLevel) {
  stopMicTest();
  if (call?.native) { onLevel(null); return; }
  const t = (micTest = { onLevel });
  ensureCtx();
  if (call?.gate) {
    t.node = call.gate;
    t.shared = true;
  } else {
    try { t.stream = await navigator.mediaDevices.getUserMedia(micConstraints()); } catch { onLevel(null); return; }
    if (micTest !== t) { t.stream.getTracks().forEach((x) => x.stop()); return; }
    if (!(await loadWorklet())) { onLevel(null); return; }
    t.src = audioCtx.createMediaStreamSource(t.stream);
    t.node = new AudioWorkletNode(audioCtx, 'volna-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    t.node.port.postMessage(gateParams());
    const sink = audioCtx.createGain();
    sink.gain.value = 0;
    t.src.connect(t.node).connect(sink).connect(audioCtx.destination);
  }
  t.prev = t.node.port.onmessage;
  t.node.port.onmessage = (e) => { if (micTest === t) onLevel(e.data); };
  t.node.port.postMessage({ report: true });
}
function stopMicTest() {
  const t = micTest;
  micTest = null;
  if (!t) return;
  try { t.node?.port.postMessage({ report: false }); t.node.port.onmessage = t.prev || null; } catch {}
  if (!t.shared) { try { t.src?.disconnect(); t.node?.disconnect(); } catch {} t.stream?.getTracks().forEach((x) => x.stop()); }
}
function applyVoicePrefs() {
  syncNative();
  call?.gate?.port.postMessage(gateParams());
  if (micTest?.node && !micTest.shared) micTest.node.port.postMessage(gateParams());
  for (const p of peers.values()) applyPeerVolume(p);
}

/* --- входящий звонок в личке --- */
let ringing = null;
function showRing(channelId, from) {
  if (call?.channelId === channelId) return;
  hideRing();
  rememberUser(from);
  const el = document.createElement('div');
  el.className = 'ring glass';
  el.innerHTML = `${avatar(userOf(from), 'lg')}<div><b style="font-size:18px">${nameHtml(userOf(from))}</b><div class="muted">звонит тебе</div></div>
    <div class="acts"><button class="btn danger" data-ring="no">${ICON.hang} Отклонить</button><button class="btn green" data-ring="yes">${ICON.phone} Ответить</button></div>`;
  document.body.appendChild(el);
  ringing = { channelId, el, timer: setInterval(() => sfx('ring'), 2200), stop: setTimeout(hideRing, 45000) };
  sfx('ring');
  notifyDesktop(dname(userOf(from)), 'Входящий звонок', 'ring-' + channelId);
  el.onclick = (e) => {
    const b = e.target.closest('[data-ring]');
    if (!b) return;
    const ch = ringing?.channelId;
    hideRing();
    if (b.dataset.ring === 'yes') { openAnyChannel(ch); joinVoice(ch); }
    else socket.emit('call:decline', { channelId: ch });
  };
}
function hideRing() {
  if (!ringing) return;
  clearInterval(ringing.timer);
  clearTimeout(ringing.stop);
  ringing.el.remove();
  ringing = null;
}

function bindVoiceSocket() {
  socket.on('voice:state', ({ channelId, states }) => {
    const before = (S.voice[channelId] || []).length;
    S.voice[channelId] = states;
    states.forEach((s) => rememberUser({ id: s.userId, username: s.username, displayName: s.displayName, color: s.color, avatar: s.avatar, ring: s.ring }));
    if (call?.channelId === channelId) {
      if (states.length > before && before) sfx('join');
      for (const p of peers.values()) applyPeerVolume(p);
      syncNative();
    }
    if (ringing?.channelId === channelId && !states.length) hideRing();
    renderSidebar();
    if (S.channelId === channelId) { renderTiles(); renderHeader(); }
  });
  socket.on('voice:peer-joined', (st) => { if (call && !call.native && st.socketId !== call.selfId) ensurePeer(st.socketId, false, st.native); });
  socket.on('voice:peer-left', ({ socketId }) => { if (peers.has(socketId)) sfx('leave'); closePeer(socketId); });
  socket.on('voice:signal', ({ from, data }) => { if (call && !call.native) onSignal(from, data); });
  socket.on('voice:audio', ({ from, data }) => { if (call && !call.native) playRelay(from, data); });
  socket.on('voice:kicked', () => { cleanupCall(); toast('Ты отключён от голосового канала'); });
  socket.on('call:ring', ({ channelId, from }) => showRing(channelId, from));
  socket.on('call:declined', ({ channelId, by }) => { if (call?.channelId === channelId) toast(`${dname(by)} отклонил(а) звонок`); });
}
