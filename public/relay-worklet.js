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

registerProcessor('volna-capture', Capture);
registerProcessor('volna-player', Player);
