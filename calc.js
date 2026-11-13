// 計算核心：網頁（<script src="calc.js">）和每天檢查（api/check.js 用 require）共用這一份，不要另外抄。
// 規則見 docs/需求單.md【規則】【資料】。這裡只吃傳進來的資料：不碰畫面、不上網。
function parseCsv(text) {
  return text.trim().split(/\r?\n/).slice(1).map(function (line) {
    var parts = line.split(',');
    return { date: parts[0].trim(), price: Number(parts[1]) };
  }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

var INSUFFICIENT = '資料不足';

// history：完整歷史（依日期排序）；s：{ start, end, amount, indicator, op('>' 或 '<'), threshold, multiplier }
// 指標只拿得到截至當週（含）的資料；指標出錯就整次不給結果，回 { weeks: [], error }
function simulate(history, s) {
  var ind = s.indicator, weeks = [];
  for (var i = 0; i < history.length; i++) {
    var r = history[i];
    if (r.date < s.start || r.date > s.end) continue;
    // 開始日期前的價格也給指標用。ponytail: 每週複製一次歷史，O(n²)；幾千週內都很快，再大才改成傳索引
    var past = history.slice(0, i + 1), v;
    try {
      v = past.length < (ind.weeksNeeded || 1) ? INSUFFICIENT : ind.compute(past);
    } catch (e) {
      return { weeks: [], error: '「' + ind.name + '」計算出錯：' + (e && e.message || e) };
    }
    if (typeof v === 'number') v = { value: v };
    if (v !== INSUFFICIENT && !(v && typeof v.value === 'number' && isFinite(v.value))) {
      return { weeks: [], error: '「' + ind.name + '」計算出錯：' + r.date + ' 算出來的不是數字' };
    }
    // 剛好等於門檻不算
    var boost = v !== INSUFFICIENT && (s.op === '<' ? v.value < s.threshold : v.value > s.threshold);
    weeks.push({
      date: r.date, price: r.price, ind: v, boost: boost, // boost：條件有沒有成立（倍數設 1 時成立了也不會多投）
      dca: s.amount,
      plan: boost ? s.amount * s.multiplier : s.amount
    });
  }
  if (!weeks.length) return { weeks: weeks };
  var last = weeks[weeks.length - 1].price;
  function total(key) {
    var invested = 0, btc = 0, boosts = 0;
    weeks.forEach(function (w) {
      invested += w[key];
      btc += w[key] / w.price;
      if (w[key] > s.amount) boosts++;
    });
    return { invested: invested, btc: btc, avg: invested / btc, boosts: boosts, value: btc * last };
  }
  return { weeks: weeks, dca: total('dca'), plan: total('plan') };
}

// ----- Kraken 每日 K 線（日期用 UTC，第 6 個值是當天成交均價，四捨五入到整數）；看不懂就丟錯 -----
function krakenRows(json) {
  if (!json || (json.error && json.error.length) || !json.result) throw new Error('看不懂回傳內容');
  var key = Object.keys(json.result).filter(function (k) { return k !== 'last'; })[0];
  var rows = json.result[key];
  if (!Array.isArray(rows)) throw new Error('看不懂回傳內容');
  return rows.map(function (row) {
    var d = new Date(row[0] * 1000);
    return { date: d.toISOString().slice(0, 10), day: d.getUTCDay(), price: Math.round(Number(row[5])) };
  });
}

// 內建資料（到 after）之後、已過完的週一；today 是 UTC 今天（還沒過完，不用）
function krakenMondays(json, after, today) {
  today = today || new Date().toISOString().slice(0, 10);
  var out = krakenRows(json).filter(function (r) { return r.day === 1 && r.date > after && r.date < today; });
  out.forEach(function (r) { if (!(r.price > 0)) throw new Error('價格不是數字'); });
  if (!out.length) throw new Error('沒有新的週一');
  return out.map(function (r) { return { date: r.date, price: r.price }; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}

// ----- 指標檔有沒有登記好（網頁和排程用同一套）-----
function indicatorProblem(ind) {
  return !ind || typeof ind.name !== 'string' || typeof ind.compute !== 'function' || !ind.threshold ? '檔案壞掉，沒有登記到指標' : '';
}

// ----- 填的條件檢查（手動填、讀回雲端存的、排程讀的都用這一套）：過了回數字，沒過回錯誤訊息 -----
function checkAmount(text) {
  var n = Number(text);
  return text === '' || !isFinite(n) || n <= 0 ? '每週金額要大於 0。' : n;
}
function checkThreshold(text, ind) {
  var t = ind.threshold, n = Number(text);
  if (!(t.integer ? /^-?\d+$/.test(text) : text !== '' && isFinite(n)) || n < t.min || n > t.max) {
    return '「' + ind.name + '」的門檻只接受 ' + t.min + ' 到 ' + t.max + (t.integer ? ' 的整數。' : ' 之間的數字。');
  }
  return n;
}
function checkMultiplier(text) {
  var n = Number(text);
  return text === '' || !isFinite(n) || n < 1 ? '加碼倍數至少要 1。' : n;
}

// 網頁是一般 <script>（雙擊打開也能用），上面的函式直接變成全域；Node（排程）才走 module.exports
if (typeof module !== 'undefined') {
  module.exports = {
    parseCsv: parseCsv, INSUFFICIENT: INSUFFICIENT, simulate: simulate,
    krakenRows: krakenRows, krakenMondays: krakenMondays, indicatorProblem: indicatorProblem,
    checkAmount: checkAmount, checkThreshold: checkThreshold, checkMultiplier: checkMultiplier
  };
}
