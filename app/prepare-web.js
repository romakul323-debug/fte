// Копирует веб-клиент из ../public в www (то, что попадёт внутрь приложения).
// Адрес сервера по умолчанию можно задать переменной VOLNA_SERVER при сборке.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'public');
const dst = path.join(__dirname, 'www');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
fs.rmSync(path.join(dst, 'sw.js'), { force: true }); // service worker внутри приложения не нужен
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'volna.config.json'), 'utf8')); } catch {}
const server = (process.env.VOLNA_SERVER || cfg.server || '').trim();
fs.writeFileSync(
  path.join(dst, 'config.js'),
  `window.VOLNA_SERVER = ${JSON.stringify(server)};\n` +
    `window.VOLNA_DISCOVERY = ${JSON.stringify(cfg.discovery || '')};\n` +
    `window.VOLNA_ANDROID = ${JSON.stringify(cfg.android || '')};\n`
);
console.log('www готов' + (server ? `, сервер по умолчанию: ${server}` : ''));
