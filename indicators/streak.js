// 指標插件：連跌週數（格式說明見 drawdown.js 開頭）
// 到當週為止，價格連續幾週比前一週低；當週沒有比上一週低（漲或持平）就是 0。
// 開始日期之前的價格也算進去；最前面沒有上一週可比的週是「資料不足」。
registerIndicator({
  name: '連跌週數',
  unit: '週',
  digits: 0,
  threshold: { min: 0, max: 52, integer: true },
  weeksNeeded: 2,
  compute: function (history) {
    if (history.length < 2) return '資料不足';
    var n = 0;
    // 從當週往回數，遇到「沒有比上一週低」就停
    for (var i = history.length - 1; i > 0 && history[i].price < history[i - 1].price; i--) n++;
    return n;
  }
});
