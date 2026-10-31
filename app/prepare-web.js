// Копирует веб-клиент из ../public в www (то, что попадёт внутрь приложения).
// Адрес сервера по умолчанию можно задать переменной VOLNA_SERVER при сборке.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'public');
const dst = path.join(__dirname, 'www');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
fs.rmSync(path.join(dst, 'sw.js'), { force: true }); // service worker внутри приложения не нужен
const server = (process.env.VOLNA_SERVER || '').trim();
fs.writeFileSync(path.join(dst, 'config.js'), `window.VOLNA_SERVER = ${JSON.stringify(server)};\n`);
console.log('www готов' + (server ? `, сервер по умолчанию: ${server}` : ''));
