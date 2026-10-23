# PropCare 物業管家 — 社區管委會與物業公司管理系統

一家物業公司管理多個社區；總幹事處理日常作業、管委會委員查帳與核准、住戶用手機查帳單與預約。
依《公寓大廈管理條例》設計：公共基金專戶列帳（第 18、19 條）、欠費逾二期催告（第 21 條）、
區權會通知期限與表決門檻（第 27、30、31、32 條）。

- 正式網址：https://propcare.crownai.ink（後端 port 3390，同時提供前端頁面）
- 資料庫：PostgreSQL `propcare`；pm2：`propcare`；nginx：`/etc/nginx/sites-available/propcare.crownai.ink`
- 架構比照 ParkMate：`backend/`（TypeScript + Express + Prisma + zod + node-cron + LINE）、`frontend/`（React + Vite + Tailwind）

## 角色

| 角色 | 範圍 | 可以做 |
|------|------|--------|
| ADMIN 物業公司管理員 | 全部社區 | 全部，含社區設定、帳號權限 |
| MANAGER 總幹事／秘書 | 指派的社區 | 日常作業；支出只能送出、不能自己核准 |
| COMMITTEE 管委會委員 | 指派的社區 | 唯讀，加上核准／退回支出 |
| 住戶 | 自己那一戶 | 住戶專區 `/r`：帳單、包裹取件碼、公設預約、報修、公告、財報、會議 |

員工端 API 以 `X-Community` 標頭指定社區，`requireCommunity` 檢查權限；住戶 token（`kind=resident`）與員工 token 互不通用。

## 功能

- 戶別與住戶：批次貼上匯入、區分所有權比例、車位清潔費；住戶初始密碼為手機末 6 碼，首次登入強制改密碼
- 管理費：每坪單價或每戶固定、自動開帳日、到期前 LINE 提醒、部分繳、整戶多期沖銷、收據號碼、作廢保留紀錄
- 收支帳：收款自動拆管理費帳戶與公共基金提撥；支出待委員核准才入帳；月報可列印公告
- 欠費與催告：逾期彙整、逾二期標示、列印催告函
- 包裹代收：取件碼、LINE 通知、逾期提醒
- 公設預約：時段、容量、每戶每週上限、可提前天數（`services/bookingService.ts`）
- 報修：住戶線上報修、派工、處理紀錄（可設內部）
- 公告：置頂、排程、下架日、LINE 推播、已讀數
- 會議：通知期限檢查、簽到與委託、逐戶表決、定額可依規約調整（`services/meetingService.ts`）
- 廠商、合約到期、法定檢查申報排程（完成後依週期自動排下一次）
- 排程（`jobs/scheduler.ts`，台北時間）：08:00 自動開帳與繳費提醒；09:00 包裹逾期提醒、週一到期事項彙整給員工

### 每個模組的操作原則

所有模組都有新增、編輯、刪除、搜尋（多欄位、空白分隔多個關鍵字）與篩選。涉及帳務或稽核的資料，刪除有限制：

- 帳單：沒有任何收款紀錄才能刪；有收款紀錄的只能作廢
- 收款：只能改方式、日期、備註；金額錯誤要作廢後重收（作廢保留紀錄並沖回收支帳）
- 收支帳：收款自動產生的不能改刪；已核准的支出被總幹事修改後要重新核准
- 包裹：已領取的保留紀錄不能刪；設施有預約紀錄時「刪除」改為停用並取消之後的預約
- 預約改期：失敗時原預約保留；報修有費用時只有管理員能刪；已召開的會議不能刪
- 廠商、合約、戶別、社區為停用（資料保留）；社區停用須輸入完整名稱確認
- 住戶只能修改／撤回自己送出、尚未被處理的報修

## 部署與維運

```bash
cd backend && npx tsc && pm2 restart propcare     # 後端
cd frontend && npm run build                        # 前端（後端直接提供 dist）
cd backend && npx prisma db push                    # 資料表異動
cd backend && npm run test:smoke                    # 全系統 API 測試（建臨時社區，跑完自動清除）
cd backend && npx ts-node --transpile-only prisma/seed.ts --reset   # 重建兩個示範社區（不動其他社區）
```

- 示範帳號（登入頁顯示，`.env` 的 `DEMO_*` 清空即隱藏）：總幹事 `demo`、委員 `committee`、住戶 `0912000001`
- 備份：cron 每天 03:55 執行 `backend/scripts/backup.mjs`，存到 `backups/`，保留 14 份
- LINE：申請官方帳號後在 `backend/.env` 填 `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`，webhook 設為 `https://propcare.crownai.ink/api/line/webhook`，重啟即生效；住戶與員工在系統內取得 6 碼綁定碼傳給官方帳號完成綁定
