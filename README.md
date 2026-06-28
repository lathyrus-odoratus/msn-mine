# msn-mine — MSN 對戰踩地雷（Minesweeper Flags）POC

> 🤖 本專案使用 **Claude Fable 5**（`claude-fable-5`）製作——從玩法討論、技術選型、
> 實作、測試到部署上線。開發過程的問答與決策紀錄見 [CONVERSATIONS.md](CONVERSATIONS.md)。

仿 MSN Messenger 經典對戰踩地雷的網頁小遊戲：16×16 棋盤埋 51 顆雷，兩人輪流點擊，
**點到雷得 1 分並續手**，點到空格/數字換對手，先搶到 **26 顆雷**獲勝。

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

## 斷線重連

玩家斷線後伺服器保留房間 `GRACE_MS`（預設 60 秒）等待重連；前端把座位 token 存在
sessionStorage，刷新頁面或網路恢復後自動帶完整棋盤快照回到對局。逾時未歸隊則
通知對手並解散房間。

## 部署（GCP VM「wisp」+ Docker + Cloudflare Tunnel）

正式站：https://mineduel.miao-bao.cc

架構：Docker 容器綁 `127.0.0.1:8090` → cloudflared tunnel（`/etc/cloudflared/config.yml`
的 ingress 規則 `mineduel.miao-bao.cc → http://localhost:8090`）→ Cloudflare DNS。
VM 不開對外 port。伺服器每 30 秒 ws ping 保活（Cloudflare 會切斷閒置 100 秒的連線）。

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

- [ ] 遊戲說明（規則教學頁/彈窗；「點到雷反而得分」跟一般踩地雷直覺相反，一行字不夠）
- [ ] 音效 / 爆雷動畫
- [ ] 結果分享（Wordle 式一鍵複製戰報：emoji 棋盤縮圖 🟦🟥 + 比數 + 遊戲連結）
- [ ] Chat + 嗆聲表情（房間內聊天與快捷 taunt）
- [x] 路由（/room/ABCD 邀請連結；觀戰、回放分享的前置）
- [ ] 自訂旗子 emoji（localStorage 保存；撞旗時用底色/邊框區分敵我）
- [ ] 對局紀錄儲存・輕量版（每局事件流寫進 Postgres，replay UI 做之前先攢數據；個人戰績綁 localStorage 匿名 ID，日後登入可認領）

### 第二層：內容與深度（閘門：朋友圈每週還有人自發開局）

- [x] 觀戰（唯讀即時版：滿房自動轉觀戰、看當前盤面＋每一手、人數同步）
- [ ] 即時 log + Replays（共用同一套對局事件流，一起設計資料格式；觀戰已先用快照做出唯讀版）
- [ ] AI 對手（從「看數字算機率」的基本款做起）

### 第三層：營運（閘門：出現陌生玩家，週活躍對局有基本盤）

- [ ] Discord OAuth 登入（認領匿名戰績；個資頁與刪帳號流程一併處理）
- [ ] 排行榜（對戰制不比時間 → 勝率 / Elo 積分）
- [ ] 經驗值 / 代幣 / 任務系統（代幣消費端接「自訂旗子」商店；每日任務拉回訪）
- [ ] 回饋 / 客服管道（開 Discord 社群伺服器掛連結，跟 OAuth 同生態；朋友圈階段你本人就是客服）
- [ ] 道具 / 天賦技能 / 場地規則（程式不難，平衡與測試是無底洞；每加一個道具組合空間翻倍，放最後）
- 注意：chat 對陌生人開放後有言論治理問題，進這層前要想好
