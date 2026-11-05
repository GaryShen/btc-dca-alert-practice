// Supabase 連線設定（專案 btc-dca-alert）。規則見 docs/需求單.md【雲端存檔】。
// 這裡只能放專案網址和 publishable key：它本來就會被瀏覽器看到，能讀寫什麼由資料庫的 RLS 決定。
// secret key、service_role 金鑰絕對不要放這裡，也不要放進 repo。
var SUPABASE_URL = 'https://yseazcbmjxcgxlotlebu.supabase.co';
var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_KH9FeBk5WxUINHvmmpe9rQ__a4btm8b';
