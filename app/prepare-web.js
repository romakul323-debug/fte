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
// Если адрес сервера известен — приложение открывает сайт сервера напрямую:
// обновления интерфейса приходят без пересборки, а при выключенном сервере показывается offline.html.
const capPath = path.join(__dirname, 'capacitor.config.json');
const cap = JSON.parse(fs.readFileSync(capPath, 'utf8'));
if (server) cap.server = { url: server, errorPath: 'offline.html' };
else delete cap.server;
// своё имя браузера: туннель Tuna не показывает приложению страницу-предупреждение
cap.overrideUserAgent = 'VolnaApp/1.0';
fs.writeFileSync(capPath, JSON.stringify(cap, null, 2) + '\n');
fs.copyFileSync(path.join(__dirname, 'offline.html'), path.join(dst, 'offline.html'));
fs.writeFileSync(path.join(dst, 'offline-config.js'), `window.VOLNA_SERVER = ${JSON.stringify(server)};\n`);
// адрес сервера для расширения показа экрана iPhone
const extPlist = path.join(__dirname, 'ios', 'App', 'VolnaScreen', 'Info.plist');
if (fs.existsSync(extPlist)) {
  const pl = fs.readFileSync(extPlist, 'utf8').replace(/(<key>VolnaServer<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${server.replace(/[<&]/g, '')}$2`);
  fs.writeFileSync(extPlist, pl);
}
console.log('www готов' + (server ? `, сервер по умолчанию: ${server}` : ''));
