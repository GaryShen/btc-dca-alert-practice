# Git 救援小抄

一句話：**改之前先存檔，改之後驗證，不對就退回。**

不用背指令：在 Claude 桌面 App 的 Code 分頁，用中間那欄的話跟它說就好。它要執行 `git` 指令前會先問你，對照右邊的指令看一眼再按允許。

## 三句話

| 我想… | 跟 Code 說 | 它會用的 Git 指令 | GitHub Desktop 的位置 |
|---|---|---|---|
| 看存檔紀錄 | 列出存檔紀錄 | `git log --oneline` | 左邊 **History** |
| 看這次改了哪裡 | 這次改了哪些檔案、哪幾行？（或點對話框旁的 `+N −M`） | `git diff` | 左邊 **Changes** |
| 還沒存檔，全部退回 | 把還沒存檔的修改全部退回，回到上一個存檔（先列出會退回的檔案） | `git restore .`（見下方〈退回的範圍〉） | **Changes** 檔案清單上按右鍵 → **Discard All Changes** |

## 看得懂它在做什麼

- **存檔是兩步**：`git add` 挑出這次要存的檔案（放進暫存區），`git commit` 才真的存成一版。只做 add 還沒有存檔點。
- 其他教學可能用 `git checkout -- 檔名` 還原檔案，跟 `git restore 檔名` 是同一件事。本片用 restore，因為 checkout 也拿來切換分支，容易混在一起。

## 退回的範圍

`git restore .` 不是「整個資料夾回到上一個存檔」，它只處理這種情況：檔案改過、還沒 `git add`。其他情況：

| 情況 | 指令 |
|---|---|
| 改過、還沒 `git add` | `git restore .` |
| 已經 `git add`（暫存）了 | `git restore --staged --worktree .`（暫存區和檔案都回到上一個存檔；**這次新增、而且已經 `git add` 的檔案會被刪掉**） |
| **還沒 `git add`** 的新增檔案（Untracked） | `git restore` 不會動它。先 `git status` 看「Untracked files」，再請 Code 處理（`git clean -n` 只列出、不刪） |

所以跟 Code 說退回時，請它**先列出會退回的檔案，已暫存和新增的也要列**，看過再按允許。

## 已經存檔了才發現壞掉

| 我想… | 跟 Code 說 | Git 指令 | GitHub Desktop |
|---|---|---|---|
| 把最後一次存檔的修改反做一次（紀錄會多一筆「退回」，原本的紀錄還在） | 把最後一個存檔的修改反做一次，用 revert | `git revert HEAD` | **History** 在那一筆上按右鍵 → **Revert Changes in Commit** |

更早的存檔也可以退：先「列出存檔紀錄」，告訴它要退哪一筆。

## 不要用

- `git reset --hard`、`git push --force`：本集練習不使用。前者可能丟掉還沒存檔的修改，後者可能覆寫 GitHub 上的版本紀錄，造成資料遺失。要退回，用本片示範的方式。CLAUDE.md 範本裡也寫了不要用。
- 「幫我改回來」：它改了幾個地方你不一定都看得到，叫它改回來可能又動到別處。退回存檔，一字不差。

## 小提醒

- **只有存過檔的版本退得回來。** 所以驗收過就存一個檔。
- 存檔只在你的電腦裡；在 GitHub Desktop 按 **Push origin** 才會上傳到 GitHub。
- 存檔會記下你的名字和 email，推上 GitHub 後別人看得到。email 建議用 GitHub 給的 `…@users.noreply.github.com`（GitHub 設定 → Emails → 勾 Keep my email addresses private）。

---

整理：2026-10-11（v2），10-12 補〈看得懂它在做什麼〉；App 介面文字以實際畫面為準。
