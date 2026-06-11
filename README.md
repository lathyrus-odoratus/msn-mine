# msn-mine — MSN 對戰踩地雷（Minesweeper Flags）POC

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

## 斷線重連

玩家斷線後伺服器保留房間 `GRACE_MS`（預設 60 秒）等待重連；前端把座位 token 存在
sessionStorage，刷新頁面或網路恢復後自動帶完整棋盤快照回到對局。逾時未歸隊則
通知對手並解散房間。

## 部署到 GCP VM

```bash
cd web && npm run build && cd ..
PORT=3000 node server.js   # 或交給 systemd / pm2，前面可掛 nginx 反代（記得開 WebSocket upgrade）
```

## Roadmap

- [ ] AI 對手（POC 跑通後）
- [x] 斷線重連
- [ ] 音效 / 爆雷動畫
