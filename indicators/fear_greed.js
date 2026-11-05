// 指標插件：恐懼貪婪指數（格式說明見 drawdown.js 開頭）
// 資料：alternative.me 的免費 API，每天一筆 0–100，日期以 UTC 為準。
// 2018-02-01 以前沒有資料，API 偶爾也缺某一天：那些週一回「資料不足」，不當成 0。
(function () {
  var URL = 'https://api.alternative.me/fng/?limit=0';
  var byDate = {}; // 'YYYY-MM-DD' → 0–100

  registerIndicator({
    name: '恐懼貪婪指數',
    unit: '',
    digits: 0,
    threshold: { min: 0, max: 100, integer: true },
    weeksNeeded: 1,
    source: 'alternative.me',
    load: function () {
      return fetch(URL).catch(function () { throw new Error('連不上 alternative.me'); })
        .then(function (res) {
          if (!res.ok) throw new Error('alternative.me 回應 ' + res.status);
          return res.json();
        })
        .then(function (json) {
          if (!json || !Array.isArray(json.data) || !json.data.length) throw new Error('看不懂回傳內容');
          json.data.forEach(function (row) {
            var value = Number(row.value), time = Number(row.timestamp);
            if (!Number.isInteger(value) || value < 0 || value > 100 || !isFinite(time)) throw new Error('看不懂回傳內容');
            byDate[new Date(time * 1000).toISOString().slice(0, 10)] = value;
          });
        });
    },
    compute: function (history) {
      var value = byDate[history[history.length - 1].date];
      return value === undefined ? '資料不足' : value;
    }
  });
})();
