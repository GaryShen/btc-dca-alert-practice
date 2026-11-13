// 每天檢查（Vercel 函式，Vercel 排程每天叫一次）：規則見 docs/需求單.md【上線與通知】。
// 順序：確認排程密碼 → 讀我存的條件 → 抓價格和指標 → 算 → 記一筆 → 需要的話傳 Telegram。
// 計算、指標、價格資料都用網頁那一份（calc.js、indicators/、data/），不另外抄。
// 金鑰只從環境變數讀；回應和執行紀錄裡的文字都先遮掉金鑰（redact）。不用任何套件，只用 Node 內建的。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const calc = require('../calc.js');

const ROOT = path.join(__dirname, '..');
const KRAKEN_URL = 'https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440';
const TIMEOUT = 10000; // 10 秒沒回應就算抓不到
const ENV_NAMES = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'CRON_SECRET'];
const SECRET_NAMES = ['SUPABASE_SECRET_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'CRON_SECRET'];
// 還沒存過、或讀回來不對時用的預設值：跟 index.html 欄位的預設值一樣（docs/需求單.md【使用者要填什麼】）
const DEFAULT_RULE = { weekly_amount: 100, indicator: 'drawdown.js', comparison: '大於', threshold: 30, multiplier: 2 };
const OPS = { '大於': '>', '小於': '<' };

function redact(text) {
  let t = String(text);
  for (const name of SECRET_NAMES) { const v = process.env[name]; if (v) t = t.split(v).join('***'); }
  return t;
}

// Authorization 必須剛好是「Bearer 排程密碼」；沒設排程密碼一律不放行。用等長比較，不洩漏猜對幾個字
function authorized(header) {
  const secret = process.env.CRON_SECRET;
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header), b = Buffer.from('Bearer ' + secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function reply(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// 抓 JSON：10 秒沒回應、HTTP 不是 2xx、內容不是 JSON 都丟錯（err.status 帶 HTTP 狀態碼）
async function getJson(url, opts, what) {
  let res, text;
  try {
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT) });
    text = await res.text();
  } catch (e) {
    throw new Error(what + (e && e.name === 'TimeoutError' ? ' 10 秒沒回應' : ' 連不上'));
  }
  if (!res.ok) {
    const err = new Error(what + ' 回應 ' + res.status + '：' + text.slice(0, 200));
    err.status = res.status;
    throw err;
  }
  try { return text ? JSON.parse(text) : null; } catch (e) { throw new Error(what + ' 回來的內容看不懂'); }
}

// Supabase REST（用 secret key，只有這支程式拿得到）
function db(pathAndQuery, method, body, prefer) {
  const key = process.env.SUPABASE_SECRET_KEY;
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_')) headers.Authorization = 'Bearer ' + key; // 舊版 service_role 金鑰是 JWT，要多帶這行；新版 sb_secret_ 只看 apikey
  if (prefer) headers.Prefer = prefer;
  const url = process.env.SUPABASE_URL.replace(/\/+$/, '') + pathAndQuery;
  return getJson(url, { method, headers, body: body && JSON.stringify(body) }, 'Supabase');
}

// 在獨立的環境裡跑 indicators/ 的檔案（它們是給網頁用的一般 script，靠全域的 registerIndicator 登記）
function runFile(file, globals) {
  const ctx = vm.createContext({ fetch, console, ...globals });
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  return ctx;
}
function indicatorFiles() {
  const list = runFile('indicators/清單.js', {}).INDICATOR_FILES;
  if (!Array.isArray(list)) throw new Error('indicators/清單.js 格式不對');
  return Array.from(list);
}
async function loadIndicator(file) {
  let ind = null;
  try { runFile('indicators/' + file, { registerIndicator: (x) => { ind = x; } }); }
  catch (e) { throw new Error('指標「' + file + '」載入失敗：' + (e && e.message || e)); }
  if (calc.indicatorProblem(ind)) throw new Error('指標「' + file + '」' + calc.indicatorProblem(ind));
  if (typeof ind.load === 'function') { // 要網路資料的指標：排程每次都抓，10 秒沒回應算抓不到
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => ind.load()),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('10 秒沒回應')), TIMEOUT); })
      ]);
    } catch (e) {
      throw new Error('指標「' + ind.name + '」抓不到資料：' + (e && e.message || e));
    } finally { clearTimeout(timer); }
  }
  return ind;
}

// 讀我存的條件。只有一個人用：rules 最多一份；還沒存過，就從 Supabase 帳號找出唯一那個帳號
async function readRule() {
  const rows = await db('/rest/v1/rules?select=*', 'GET');
  if (!Array.isArray(rows)) throw new Error('Supabase rules 回來的內容看不懂');
  if (rows.length > 1) throw new Error('rules 裡有不只一個帳號的條件，不知道要用哪一份');
  if (rows[0]) return { userId: rows[0].user_id, row: rows[0], saved: true };
  const r = await db('/auth/v1/admin/users', 'GET');
  const users = r && Array.isArray(r.users) ? r.users : [];
  if (users.length !== 1) throw new Error('Supabase 帳號不是剛好一個（現在 ' + users.length + ' 個），不知道是誰的');
  return { userId: users[0].id, row: DEFAULT_RULE, saved: false };
}

// 讀回來的檢查同【雲端存檔】8：哪一項不對，那一項用預設值（bad 記下是哪幾項）
async function settingsFrom(row) {
  const bad = [];
  const pick = (name, value, fallback) => {
    if (typeof value === 'string') { bad.push(name); return fallback; }
    return value;
  };
  const amount = pick('每週金額', calc.checkAmount(String(row.weekly_amount ?? '')), DEFAULT_RULE.weekly_amount);
  let file = row.indicator;
  if (!indicatorFiles().includes(file)) { bad.push('加碼指標'); file = DEFAULT_RULE.indicator; }
  const ind = await loadIndicator(file); // 指標檔壞掉、抓不到資料＝這次失敗（需求單【上線與通知】5）
  const op = OPS[row.comparison] || pick('條件（大於或小於）', 'x', '>');
  const threshold = pick('門檻', calc.checkThreshold(String(row.threshold ?? ''), ind), DEFAULT_RULE.threshold);
  const multiplier = pick('加碼倍數', calc.checkMultiplier(String(row.multiplier ?? '')), DEFAULT_RULE.multiplier);
  return { file, ind, op, threshold, multiplier, amount, bad };
}

function dayShift(date, days) { return new Date(Date.parse(date + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10); }
function usd(n) { return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 }); }

function messageText(kind, c) {
  const ind = c.s.ind, unit = ind.unit || '';
  const value = c.w.ind === calc.INSUFFICIENT ? '資料不足，不加碼'
    : c.w.ind.value.toFixed(ind.digits == null ? 2 : ind.digits) + unit + (c.w.ind.note ? '（' + c.w.ind.note + '）' : '');
  const lines = [
    kind,
    '檢查日：' + c.today + '（台灣時間）',
    '價格：' + c.w.date + ' ' + usd(c.w.price) + '（Kraken 當天成交均價，UTC 日期）',
    '條件：' + ind.name + ' ' + (c.s.op === '<' ? '小於' : '大於') + ' ' + c.s.threshold + unit,
    '指標：' + value,
    '條件' + (c.w.boost ? '成立' : '沒成立'),
    '這週該投：' + usd(c.w.plan)
  ];
  if (c.s.bad.length) lines.push('讀回來不對、改用預設值：' + c.s.bad.join('、'));
  lines.push('這是你自己設的條件到了，不是買賣建議。');
  return lines.join('\n');
}

async function sendTelegram(text) {
  const url = 'https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/sendMessage';
  const json = await getJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }) // 只傳到環境變數那一個 chat id
  }, 'Telegram');
  if (!json || json.ok !== true) throw new Error('Telegram 沒有回 ok');
}

async function run() {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // 台灣日期（UTC+8）
  const utcToday = new Date().toISOString().slice(0, 10);
  const priceDate = dayShift(utcToday, -1); // 最新一筆已經過完的 Kraken 每日價格＝前一個 UTC 日

  // 1. 讀我存的條件；今天已經檢查過就到此為止（不重算、不重送）
  const rule = await readRule();
  const uid = encodeURIComponent(rule.userId);
  const prev = (await db('/rest/v1/checks?select=check_date,condition_met&user_id=eq.' + uid + '&order=check_date.desc&limit=1', 'GET'))[0];
  if (prev && prev.check_date === today) return { status: 200, body: { ok: true, result: '今天檢查過了', check_date: today } };
  const s = await settingsFrom(rule.row);

  // 2. 抓價格：內建資料＋Kraken 週一，最後接上前一個 UTC 日那筆（它本身是週一就已經在裡面）
  const kraken = await getJson(KRAKEN_URL, {}, 'Kraken');
  let history, latest;
  try {
    const builtin = calc.parseCsv(fs.readFileSync(path.join(ROOT, 'data/btc_weekly.csv'), 'utf8'));
    history = builtin.concat(calc.krakenMondays(kraken, builtin[builtin.length - 1].date, utcToday));
    latest = calc.krakenRows(kraken).filter((r) => r.date === priceDate)[0];
  } catch (e) {
    throw new Error('Kraken ' + (e && e.message || e));
  }
  if (!latest) throw new Error('Kraken 沒有 ' + priceDate + '（前一個 UTC 日）那筆');
  if (!(latest.price > 0)) throw new Error('Kraken ' + priceDate + ' 的價格不是數字');
  if (history[history.length - 1].date !== priceDate) history.push({ date: priceDate, price: latest.price });

  // 3. 算：跟網頁同一個 simulate()，只算最後這一筆
  const r = calc.simulate(history, { start: priceDate, end: priceDate, amount: s.amount, indicator: s.ind, op: s.op, threshold: s.threshold, multiplier: s.multiplier });
  if (r.error) throw new Error(r.error);
  const w = r.weeks[0];
  if (!w) throw new Error('算不出 ' + priceDate + ' 的結果');

  // 4. 要不要通知（一天最多一則）：第一次 → 週一（台灣時間）→ 上次沒成立、今天成立 → 其他不傳
  const kind = !prev ? '開始幫你看了'
    : new Date(today + 'T00:00:00Z').getUTCDay() === 1 ? '週一'
    : !prev.condition_met && w.boost ? '條件成立了'
    : '沒傳';

  // 5. 先記一筆；同一天第二筆會被資料庫的唯一限制擋下（409）＝今天檢查過了，不傳通知
  try {
    await db('/rest/v1/checks', 'POST', {
      user_id: rule.userId, check_date: today, price_date: w.date, price_usd: w.price, indicator: s.file,
      indicator_value: w.ind === calc.INSUFFICIENT ? null : w.ind.value, condition_met: w.boost,
      weekly_invest: w.plan, notify: kind === '沒傳' ? '沒傳' : '傳送中'
    }, 'return=minimal');
  } catch (e) {
    if (e.status === 409) return { status: 200, body: { ok: true, result: '今天檢查過了', check_date: today } };
    throw e;
  }
  const result = { ok: true, result: '檢查完成', check_date: today, price_date: w.date, indicator_value: w.ind === calc.INSUFFICIENT ? calc.INSUFFICIENT : w.ind.value, condition_met: w.boost, weekly_invest: w.plan, notify: kind, bad: s.bad };
  if (kind === '沒傳') return { status: 200, body: result };

  // 6. 記好了才傳通知，再把結果補記上去；傳送失敗紀錄照留，當天不重送
  let patch = { notify: kind };
  try {
    await sendTelegram(messageText(kind, { today, s, w }));
  } catch (e) {
    patch = { notify: '傳送失敗', notify_error: redact(e && e.message || e) };
  }
  result.notify = patch.notify;
  if (patch.notify_error) result.notify_error = patch.notify_error;
  try {
    await db('/rest/v1/checks?user_id=eq.' + uid + '&check_date=eq.' + today, 'PATCH', patch, 'return=minimal');
  } catch (e) {
    result.record_warning = '通知結果沒補記上（紀錄停在「傳送中」）：' + redact(e && e.message || e);
  }
  return { status: 200, body: result };
}

module.exports = async function handler(req, res) {
  if (!authorized(req.headers.authorization)) return reply(res, 401, { ok: false, error: '沒有權限' }); // 什麼都不做
  const missing = ENV_NAMES.filter((n) => !process.env[n]);
  if (missing.length) return reply(res, 500, { ok: false, error: '環境變數沒設：' + missing.join('、') });
  try {
    const out = await run();
    console.log(redact(JSON.stringify(out.body)));
    reply(res, out.status, out.body);
  } catch (e) {
    // 抓不到資料、算不出來、記不進去：這次失敗，沒有留下今天那一筆，也不傳通知
    const msg = redact('檢查失敗：' + (e && e.message || e));
    console.error(msg);
    reply(res, 500, { ok: false, error: msg });
  }
};
