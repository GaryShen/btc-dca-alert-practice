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


-- ===== W5：建 checks 表，記每次成功檢查的結果（規則見 docs/需求單.md【上線與通知】6）=====
-- 只在 Supabase 專案 btc-dca-alert（yseazcbmjxcgxlotlebu）執行；上面 rules 那段已經執行過，這次只執行這一段

begin;  -- 開始一個交易：下面全部成功才生效，中途出錯就全部不算

create table public.checks (  -- 在 public 底下建一張叫 checks 的表
  user_id uuid not null references auth.users (id) on delete cascade,  -- 這筆是誰的：對應登入帳號；帳號刪掉這筆跟著刪；排程程式寫入時要自己填（它沒有登入，不能用 auth.uid()）
  check_date date not null default ((now() at time zone 'Asia/Taipei')::date),  -- 哪一天：台灣日期；沒填就用資料庫現在時間換成台灣日期，不靠排程主機的時區
  checked_at timestamptz not null default now(),  -- 檢查時間：新增時自動填資料庫的現在時間
  price_date date not null,  -- 用的是哪一天的價格（Kraken 每日價格，UTC 日期）
  price_usd numeric not null,  -- 那天的價格（美元）
  indicator text not null,  -- 用的指標：存 indicators/清單.js 裡的檔名，例如 'drawdown.js'
  indicator_value numeric,  -- 指標的值；空白（null）＝那天「資料不足」
  condition_met boolean not null,  -- 條件有沒有成立；資料不足一律填 false
  weekly_invest numeric not null,  -- 這週該投多少（美元）
  notify text not null default '傳送中' check (notify in ('傳送中', '開始幫你看了', '週一', '條件成立了', '沒傳', '傳送失敗')),  -- 有沒有傳通知：先記紀錄時是「傳送中」，傳完再補成傳了哪一種／沒傳／傳送失敗
  notify_error text,  -- 通知傳送失敗的原因（沒失敗就空白）；不能寫進任何金鑰
  constraint checks_一個帳號一天一筆 primary key (user_id, check_date)  -- 唯一限制：同一個帳號、同一天只能有一筆，第二筆資料庫直接拒絕
);  -- 表格欄位定義結束

alter table public.checks enable row level security;  -- 打開資料列權限（RLS）：沒有規則允許的列，一律看不到、改不到

revoke all on table public.checks from anon, authenticated, service_role;  -- 先把 Supabase 預設給的權限全部收回，不靠預設值
grant select on table public.checks to authenticated;  -- 登入的人：只給讀；新增、修改、刪除都不給
-- 沒登入的人（anon）上面已全部收回，不再給任何權限
grant select, insert, update, delete on table public.checks to service_role;  -- 排程程式（secret key）：可以讀、新增、修改、刪除 checks

revoke all on table public.rules from service_role;  -- 收回 Supabase 預設給排程程式在 rules 的權限（只改 service_role，網頁用的權限不動）
grant select on table public.rules to service_role;  -- 排程程式：rules 只能讀，不能改網頁存的條件

create policy "本人可以讀自己的檢查紀錄"  -- 讀取規則
on public.checks for select  -- 套用在讀取
to authenticated  -- 只對登入的人
using ((select auth.uid()) = user_id);  -- 只能讀 user_id 等於自己帳號的那幾筆
-- 不建新增、修改、刪除的規則：登入的人就算有權限也一筆都動不了（雙重擋）
-- service_role 本來就會略過 RLS，所以不用替它建規則；它能做什麼只由上面的 grant 決定

commit;  -- 全部成功，正式生效
