// 指標插件：距最高點跌幅
//
// 每個指標檔都呼叫一次 registerIndicator({ ... })，要寫清楚：
//   name        名稱（選單上顯示的字）
//   unit        單位
//   digits      明細顯示到小數第幾位（不寫就是 2）
//   threshold   門檻可以填的範圍 { min, max, integer: 是否只收整數 }
//   weeksNeeded 需要幾週資料：截至當週（含當週）至少要有幾週價格；不夠的話網頁直接當「資料不足」，不會呼叫 compute
//   compute     怎麼算：history 是截至當週（含）的每週價格 [{ date, price }]，最後一筆就是當週，拿不到之後的價格。
//               回傳數字，或 { value: 數字, note: 明細上的補充說明 }；資料不夠就回 '資料不足'。
//   source      資料來源（用到外部資料的指標才寫），選單旁邊會標「資料來源：…」
//   load        （需要網路資料的指標才寫）一個函式，回傳 Promise：抓好資料就 resolve，抓不到就 reject。
//               網頁只在正式畫面呼叫它（驗收模式不上網）；抓好之前選單標「準備中」，
//               reject 或 10 秒沒回應就標「出錯」。抓到的資料沒有某個週一，compute 就回 '資料不足'。
registerIndicator({
  name: '距最高點跌幅',
  unit: '%',
  digits: 2,
  threshold: { min: 0, max: 100, integer: true },
  weeksNeeded: 1,
  compute: function (history) {
    if (!history.length) return '資料不足';
    // 最高點＝截至當週的最高價，開始日期之前的價格也算進去
    var high = 0;
    history.forEach(function (r) { if (r.price > high) high = r.price; });
    var price = history[history.length - 1].price;
    // 跌幅＝（最高點 − 當週價格）÷ 最高點，以 % 表示。
    // 先乘 100 再除：剛好 30% 會算成剛好 30，不會變成 30.000000000000004 被誤判成「超過」
    return { value: (high - price) * 100 / high, note: '最高點 $' + high.toLocaleString('en-US') };
  }
});
