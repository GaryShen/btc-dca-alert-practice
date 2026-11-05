-- 建 rules 表：存每個帳號填的定投條件（規則見 docs/需求單.md【雲端存檔】）
-- 只在 Supabase 專案 btc-dca-alert（yseazcbmjxcgxlotlebu）執行

begin;  -- 開始一個交易：下面全部成功才生效，中途出錯就全部不算

create table public.rules (  -- 在 public 底下建一張叫 rules 的表
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,  -- 這筆是誰的：對應登入帳號；當主鍵所以一個帳號只能一筆；沒填就自動用登入者；帳號刪掉這筆跟著刪
  start_date date not null,  -- 開始日期
  end_date date not null,  -- 結束日期
  weekly_amount numeric not null,  -- 每週金額（美元）
  indicator text not null,  -- 指標：存 indicators/清單.js 裡的檔名，例如 'drawdown.js'、'fear_greed.js'
  comparison text not null check (comparison in ('大於', '小於')),  -- 大於或小於：只能填這兩個字
  threshold numeric not null,  -- 門檻
  multiplier numeric not null,  -- 加碼倍數
  updated_at timestamptz not null default now()  -- 最後更新時間：新增時自動填現在時間
);  -- 表格欄位定義結束

create function public.rules_set_updated_at()  -- 建一個函式：每次修改時把最後更新時間改成現在
returns trigger  -- 這個函式是給觸發器用的
language plpgsql  -- 用 PostgreSQL 內建的程式語言寫
set search_path = ''  -- 不依賴搜尋路徑，避免被同名物件冒充（Supabase 安全檢查建議）
as $$  -- 函式內容開始
begin  -- 函式本體開始
  new.updated_at := now();  -- 把要寫進去的這一筆的更新時間設成資料庫的現在時間（不用網頁的時鐘）
  return new;  -- 把改好的這一筆交回去寫入
end;  -- 函式本體結束
$$;  -- 函式內容結束

create trigger rules_updated_at  -- 建一個觸發器
before update on public.rules  -- 在 rules 表每次修改「之前」啟動
for each row execute function public.rules_set_updated_at();  -- 每改一筆就跑一次上面的函式

alter table public.rules enable row level security;  -- 打開資料列權限（RLS）：沒有規則允許的列，一律看不到、改不到

revoke all on table public.rules from anon, authenticated;  -- 先把 Supabase 預設給的權限全部收回，不靠預設值
grant select, insert, update on table public.rules to authenticated;  -- 登入的人：只給讀、新增、修改（不給刪除）
-- 沒登入的人（anon）上面已全部收回，不再給任何權限

create policy "本人可以讀自己那一筆"  -- 讀取規則
on public.rules for select  -- 套用在讀取
to authenticated  -- 只對登入的人
using ((select auth.uid()) = user_id);  -- 只能讀 user_id 等於自己帳號的那一筆

create policy "本人可以新增自己那一筆"  -- 新增規則
on public.rules for insert  -- 套用在新增
to authenticated  -- 只對登入的人
with check ((select auth.uid()) = user_id);  -- 新增的這筆 user_id 必須是自己，不能替別人建

create policy "本人可以修改自己那一筆"  -- 修改規則
on public.rules for update  -- 套用在修改
to authenticated  -- 只對登入的人
using ((select auth.uid()) = user_id)  -- 只能挑到自己那一筆來改
with check ((select auth.uid()) = user_id);  -- 改完 user_id 還是要是自己，不能把這筆轉給別人

commit;  -- 全部成功，正式生效
