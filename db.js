'use strict';
// Простое хранилище в JSON-файле. Для старта хватает с запасом;
// позже можно заменить на PostgreSQL, не трогая клиент.
const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');
fs.mkdirSync(DIR, { recursive: true });

const data = { users: [], servers: [], channels: [], members: [], messages: [] };

if (fs.existsSync(FILE)) {
  try {
    Object.assign(data, JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch (e) {
    console.error('db.json повреждён, сохраняю копию и начинаю с нуля:', e.message);
    fs.copyFileSync(FILE, FILE + '.broken-' + Date.now());
  }
}

let timer = null;
function flush() {
  clearTimeout(timer);
  timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}
function save() {
  if (!timer) timer = setTimeout(flush, 500);
}

module.exports = { DIR, data, save, flush };
