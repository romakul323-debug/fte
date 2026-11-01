'use strict';
// Хранилище. Локально — JSON-файл data/db.json.
// На хостинге (есть DATABASE_URL) — то же самое состояние хранится в Postgres (например, бесплатный Neon),
// потому что диск у бесплатных хостингов стирается при перезапуске.
const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'db.json');
const DB_URL = process.env.DATABASE_URL || '';
fs.mkdirSync(DIR, { recursive: true });

const data = { users: [], servers: [], channels: [], members: [], messages: [] };
let pool = null;

async function init() {
  if (DB_URL) {
    const { Pool } = require('pg');
    // внутренние адреса (localhost, dpg-xxx у Render) — без SSL, внешние (Neon и т.п.) — с SSL
    let host = '';
    try { host = new URL(DB_URL).hostname; } catch {}
    const noSsl = /sslmode=disable/.test(DB_URL) || !host.includes('.') || /^(localhost|127\.0\.0\.1)$/.test(host);
    pool = new Pool({ connectionString: DB_URL, ssl: noSsl ? false : { rejectUnauthorized: false }, max: 2 });
    await pool.query('CREATE TABLE IF NOT EXISTS volna_state (id INT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())');
    const r = await pool.query('SELECT data FROM volna_state WHERE id = 1');
    if (r.rows[0]) Object.assign(data, r.rows[0].data);
    console.log('  База: Postgres');
    return;
  }
  if (fs.existsSync(FILE)) {
    try {
      Object.assign(data, JSON.parse(fs.readFileSync(FILE, 'utf8')));
    } catch (e) {
      console.error('db.json повреждён, сохраняю копию и начинаю с нуля:', e.message);
      fs.copyFileSync(FILE, FILE + '.broken-' + Date.now());
    }
  }
}

let timer = null;
let writing = Promise.resolve();
let dirty = false;

function writeNow() {
  clearTimeout(timer);
  timer = null;
  if (!pool) {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, FILE);
    return Promise.resolve();
  }
  // записи в Postgres идут строго по очереди
  dirty = false;
  const json = JSON.stringify(data);
  writing = writing
    .then(() => pool.query(
      'INSERT INTO volna_state (id, data, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
      [json]
    ))
    .catch((e) => { console.error('  ! Ошибка записи в базу:', e.message); dirty = true; save(); });
  return writing;
}
function save() {
  if (!timer) timer = setTimeout(writeNow, pool ? 1500 : 500);
}
async function flush() {
  if (timer || dirty) await writeNow();
  await writing;
}

// ---------- картинки (аватары, баннеры, вложения) ----------
const MEDIA_DIR = path.join(DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
const SAFE_ID = /^[a-f0-9-]{36}$/;
let mediaTable = false;
async function putMedia(id, mime, buf) {
  if (!SAFE_ID.test(id)) throw new Error('bad id');
  if (pool) {
    if (!mediaTable) {
      await pool.query('CREATE TABLE IF NOT EXISTS volna_media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BYTEA NOT NULL)');
      mediaTable = true;
    }
    await pool.query('INSERT INTO volna_media (id, mime, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [id, mime, buf]);
    return;
  }
  fs.writeFileSync(path.join(MEDIA_DIR, id + '.bin'), buf);
  fs.writeFileSync(path.join(MEDIA_DIR, id + '.mime'), mime);
}
async function getMedia(id) {
  if (!SAFE_ID.test(id)) return null;
  if (pool) {
    try {
      const r = await pool.query('SELECT mime, data FROM volna_media WHERE id = $1', [id]);
      return r.rows[0] ? { mime: r.rows[0].mime, buf: r.rows[0].data } : null;
    } catch { return null; }
  }
  try {
    return { mime: fs.readFileSync(path.join(MEDIA_DIR, id + '.mime'), 'utf8'), buf: fs.readFileSync(path.join(MEDIA_DIR, id + '.bin')) };
  } catch { return null; }
}

module.exports = { DIR, data, init, save, flush, putMedia, getMedia };
