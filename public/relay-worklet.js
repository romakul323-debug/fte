// Запасной путь для голоса: если прямое соединение между участниками не получилось,
// звук идёт через сервер Волны (по тому же соединению, что и чат).
// Формат: 16 кГц, моно, 8-битный μ-law — ~16 КБ/с на говорящего.

const OUT_RATE = 16000;

function linToMulaw(x) {
  let s = Math.max(-1, Math.min(1, x)) * 32767;
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  s = Math.min(32635, s + 132);
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; exp--, mask >>= 1);
  const mant = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}
const MULAW_TABLE = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const sign = u & 0x80, exp = (u >> 4) & 7, mant = u & 0x0f;
  let s = ((mant << 3) + 132) << exp;
  s -= 132;
  MULAW_TABLE[i] = (sign ? -s : s) / 32768;
}

// Микрофон → кусочки по 40 мс (640 байт) в главный поток
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / OUT_RATE;
    this.pos = 0;
    this.buf = new Uint8Array(640);
    this.n = 0;
    this.on = true;
    this.port.onmessage = (e) => { this.on = !!e.data.on; };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !this.on) return true;
    // простое прореживание с усреднением (48к → 16к)
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos);
      const a = ch[i], b = ch[Math.min(i + 1, ch.length - 1)];
      this.buf[this.n++] = linToMulaw((a + b) * 0.5);
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.slice(0).buffer, []);
        this.n = 0;
      }
      this.pos += this.step;
    }
    this.pos -= ch.length;
    return true;
  }
}

// Полученные кусочки → кольцевой буфер с небольшой подушкой против рывков → динамик
class Player extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(OUT_RATE * 2);
    this.w = 0;
    this.r = 0;
    this.filled = 0;
    this.started = false;
    this.step = OUT_RATE / sampleRate;
    this.frac = 0;
    this.port.onmessage = (e) => {
      const bytes = new Uint8Array(e.data);
      for (let i = 0; i < bytes.length; i++) {
        this.ring[this.w] = MULAW_TABLE[bytes[i]];
        this.w = (this.w + 1) % this.ring.length;
        if (this.filled < this.ring.length) this.filled++;
        else this.r = (this.r + 1) % this.ring.length;
      }
      // если отстали больше чем на 0,4 с — догоняем, чтобы не копилась задержка
      if (this.filled > OUT_RATE * 0.4) {
        const drop = this.filled - Math.floor(OUT_RATE * 0.12);
        this.r = (this.r + drop) % this.ring.length;
        this.filled -= drop;
      }
    };
  }
  process(_, outputs) {
    const out = outputs[0][0];
    if (!this.started && this.filled < OUT_RATE * 0.08) { out.fill(0); return true; }
    this.started = true;
    for (let i = 0; i < out.length; i++) {
      if (this.filled < 2) { out[i] = 0; this.started = this.filled > 0; continue; }
      const a = this.ring[this.r], b = this.ring[(this.r + 1) % this.ring.length];
      out[i] = a + (b - a) * this.frac;
      this.frac += this.step;
      while (this.frac >= 1) {
        this.frac -= 1;
        this.r = (this.r + 1) % this.ring.length;
        this.filled--;
      }
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

// Шумодав-гейт с упреждением: пропускает голос и отсекает короткие щелчки (тапы по экрану, клавиатура).
// Звук задерживается на ~30 мс, чтобы решение «это голос» успевало до начала слова.
class Gate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = true;
    this.auto = true;
    this.manual = -45; // дБ
    this.muted = false;
    this.floor = -60;
    this.delay = new Float32Array(Math.ceil(sampleRate * 0.03));
    this.di = 0;
    this.above = 0;
    this.need = Math.max(3, Math.round((0.02 * sampleRate) / 128)); // ~20 мс выше порога
    this.hold = 0;
    this.holdBlocks = Math.round((0.32 * sampleRate) / 128);
    this.gain = 0;
    this.att = 1 - Math.exp(-1 / (0.004 * sampleRate));
    this.rel = 1 - Math.exp(-1 / (0.09 * sampleRate));
    this.report = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if ('enabled' in d) this.enabled = !!d.enabled;
      if ('auto' in d) this.auto = !!d.auto;
      if ('threshold' in d) this.manual = +d.threshold;
      if ('muted' in d) this.muted = !!d.muted;
      if ('report' in d) this.report = d.report ? 1 : 0;
    };
  }
  process(inputs, outputs) {
    const inp = inputs[0] && inputs[0][0];
    const out = outputs[0][0];
    if (!out) return true;
    if (!inp) { out.fill(0); return true; }
    let sum = 0;
    for (let i = 0; i < inp.length; i++) sum += inp[i] * inp[i];
    const level = 10 * Math.log10(sum / inp.length + 1e-12);
    // следим за фоновым шумом: быстро вниз, медленно вверх
    if (level < this.floor) this.floor += (level - this.floor) * 0.2;
    else this.floor += Math.min(0.006, (level - this.floor) * 0.001);
    const thr = this.auto ? Math.min(-22, Math.max(-58, this.floor + 11)) : this.manual;
    if (level > thr) this.above++; else this.above = 0;
    let open;
    if (!this.enabled) open = true;
    else if (this.above >= this.need) { open = true; this.hold = this.holdBlocks; }
    else if (this.hold > 0 && level > thr - 6) { open = true; this.hold--; }
    else if (this.hold > 0) { open = true; this.hold -= 2; }
    else open = false;
    if (this.muted) open = false;
    const target = open ? 1 : 0;
    const d = this.delay, n = d.length;
    for (let i = 0; i < out.length; i++) {
      const x = inp[i];
      const y = this.enabled ? d[this.di] : x;
      d[this.di] = x;
      this.di = (this.di + 1) % n;
      this.gain += (target - this.gain) * (target > this.gain ? this.att : this.rel);
      out[i] = y * this.gain;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    if (this.report && ++this.report % 12 === 0) this.port.postMessage({ level, thr, open });
    return true;
  }
}

registerProcessor('volna-gate', Gate);
registerProcessor('volna-capture', Capture);
registerProcessor('volna-player', Player);
