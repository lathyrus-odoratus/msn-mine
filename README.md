# msn-mine — MSN 對戰踩地雷（Minesweeper Flags）POC

> 🤖 本專案使用 **Claude Fable 5**（`claude-fable-5`）製作——從玩法討論、技術選型、
> 實作、測試到部署上線。開發過程的問答與決策紀錄見 [CONVERSATIONS.md](CONVERSATIONS.md)。

仿 MSN Messenger 經典對戰踩地雷的網頁小遊戲：兩人輪流點擊，
**點到雷得 1 分並續手**，點到空格/數字換對手，先搶過半地雷獲勝。
建房時可選場地大小：**標準 16×16・51 雷・先搶 26**，或 **小場 12×12・29 雷・先搶 15**。

## 架構

- `server.js` + `lib/game.js` — Node.js 權威伺服器（房間配對、棋盤真相、回合仲裁），WebSocket 走 `ws`，路徑 `/ws`
- `web/` — Vite + Vue 3 前端；production 模式由 Node server 直接服務 `web/dist`

## 開發

```bash
npm install && (cd web && npm install)

# 終端 1：遊戲伺服器（port 3000）
npm start

# 終端 2：前端 dev server（port 5173，/ws 會 proxy 到 3000）
cd web && npm run dev
```

## 跑起來玩（production 模式）

```bash
cd web && npm run build && cd ..
npm start
# 開兩個瀏覽器分頁連 http://localhost:3000
# 分頁 A 建立房間拿 4 碼房號，分頁 B 輸入房號加入即可開打
```

同一 WiFi 的朋友連 `http://<你的IP>:3000` 也能加入。

## 測試

```bash
npm test            # 遊戲核心邏輯單元測試
npm run test:e2e    # 端對端測試：完整對局 + 斷線重連（e2e.js 需先 npm start）
```

## 邀請連結與觀戰

每個房間都有網址 `/room/ABCD`：建房後網址自動換成它，按「複製邀請連結」就能丟給朋友。
點連結進站時**同一條連結自動分流**——房間還有空位就加入當玩家，已經坐滿兩人則自動進入
**唯讀觀戰**：載入當前棋盤、跟著看每一手，全房（玩家＋觀戰者）都看得到「👁 N 人觀戰」。
觀戰者看到的資訊和玩家完全一樣（只有已翻開的格子），看不到未翻開的雷，因此旁觀不影響公平。
觀戰者進場會拿到一個隨機菜市場名字，全房看得到「👁 王小明 觀戰中」；玩家與觀戰者都能隨時改名。

對局中所有人（含觀戰者）都能按預設**嗆聲**，泡泡會附上發言者名字、觀戰者標 👁、幾秒後自動消失；
伺服器只接受預設嗆聲的索引（不開放自由輸入），並有冷卻防洗版。

## 斷線重連

玩家斷線後伺服器保留房間 `GRACE_MS`（預設 60 秒）等待重連；前端把座位 token 存在
sessionStorage，刷新頁面或網路恢復後自動帶完整棋盤快照回到對局。逾時未歸隊則
通知對手並解散房間。

## 部署（GCP VM「wisp」+ Docker + Cloudflare Tunnel）

正式站：https://mineduel.miao-bao.cc

架構：Docker 容器綁 `127.0.0.1:8090` → cloudflared tunnel（`/etc/cloudflared/config.yml`
的 ingress 規則 `mineduel.miao-bao.cc → http://localhost:8090`）→ Cloudflare DNS。
VM 不開對外 port。伺服器每 30 秒 ws ping 保活（Cloudflare 會切斷閒置 100 秒的連線）。

`docker compose` 另起一個 Postgres 容器（`db`，只在 compose 內部網路、不對外公開 port）
存對局紀錄，資料放具名 volume `mine-pgdata`。連線字串由 compose 注入 `DATABASE_URL`；
密碼可用環境變數 `PG_PASSWORD` 覆寫（預設 `mine_local_pw`）。沒有 DB 時 app 自動降級、
不持久化也照常運作。

更新部署：

```bash
rsync -az --delete --exclude node_modules --exclude web/node_modules \
  --exclude web/dist --exclude .git ./ wisp:~/msn-mine/
ssh wisp 'cd ~/msn-mine && docker compose up -d --build'
```

## Roadmap

- [x] 斷線重連

三層結構，每層有前進閘門，沒過門檻不動工。
原則：**紀錄先行、登入殿後**——對局紀錄掛在 game ID 上、個人戰績用 localStorage
匿名 ID，都不需要帳號；登入買到的只有跨裝置同步與排行榜公信力，留到第三層。

### 第一層：把遊戲做好玩（現在做）

目標：朋友圈玩起來覺得讚。零帳號、零營運負擔。

- [x] 遊戲說明（標題列「❔ 玩法」彈窗；強調「點到雷反而得分」這個反直覺規則）
- [x] 音效（Web Audio 即時合成：搶雷/換手/勝負/嗆聲/開局；靜音開關存 localStorage）
- [ ] 爆雷動畫（含網頁內 editor/config 線上調參）
- [ ] 結果分享（Wordle 式一鍵複製戰報：emoji 棋盤縮圖 🟦🟥 + 比數 + 遊戲連結）
- [x] 連結預覽 OG metadata（title + description；image 待定）
- [x] 嗆聲表情（快捷 taunt：玩家與觀戰者皆可發、附名字、觀戰者標 👁、防洗版冷卻）
- [ ] Chat（房間內自由輸入聊天；陌生人開放後有言論治理問題，留意）
- [x] 路由（/room/ABCD 邀請連結；/rooms 進行中列表、/replays/:id 回放分享，支援瀏覽器上一步）
- [x] 自訂旗子（滿版方塊取代 ⚑ 以免跟數字 1 混淆；自選顏色 + 程式化 identicon 花紋可重抽；
      localStorage 保存、跟著名字一起廣播給對手與觀戰者）
- [x] 對局紀錄儲存（每局事件流寫進 Postgres，供 Replays/觀戰/分享取用。無 DB 時自動降級不持久化）

### 第二層：內容與深度（閘門：朋友圈每週還有人自發開局）

- [x] 觀戰（唯讀即時版：滿房自動轉觀戰、看當前盤面＋每一手、人數同步）
- [x] 房間列表（/api/rooms 列出進行中對局；首頁「進行中(n)」→ 列表可直接觀戰；4 秒輪詢更新）
- [x] Replays（播放 UI：BoardView 重繪、進度條/逐手前後、自動播放；/replays、/replays/:id 可分享）
- [ ] 即時 log（房間內逐手文字戰報；與 Replays 共用同一套對局事件流）
- [x] AI 對手（伺服器端 bot 佔座位 1，沿用權威遊戲邏輯，記 vsBot + bot_id + bot_version；
      人機局可旁觀/記錄。greedy：搶確定的雷否則隨機；smart：機率推理挑最可能是雷、結合多線索
      避開安全格。大廳可選類型＋ⓘ 邏輯說明）

### 第三層：營運（閘門：出現陌生玩家，週活躍對局有基本盤）

- [ ] Discord OAuth 登入（認領匿名戰績；個資頁與刪帳號流程一併處理）
- [ ] 排行榜（對戰制不比時間 → 勝率 / Elo 積分）
- [ ] 經驗值 / 代幣 / 任務系統（代幣消費端接「自訂旗子」商店；每日任務拉回訪）
- [ ] 回饋 / 客服管道（開 Discord 社群伺服器掛連結，跟 OAuth 同生態；朋友圈階段你本人就是客服）
- [ ] 道具 / 天賦技能 / 場地規則（程式不難，平衡與測試是無底洞；每加一個道具組合空間翻倍，放最後）
- 注意：chat 對陌生人開放後有言論治理問題，進這層前要想好

## 實驗：探雷模式（Mine Runner）

獨立的新玩法原型，與經典對戰並存，網址 `/runner`（本地雙人 hot-seat）。
角色在固定斜角 2.5D 地圖上奔跑，**走過就插旗**、一次引爆收割；回合制移動、時間軸排序、
編排→執行（盲擲）。設計與演化見 [`docs/explore-mode.md`](docs/explore-mode.md)。
目前純前端驗手感，尚未接網路。
