# 探雷即時對戰 Roadmap（同盤搶雷・loop 累積）

> 建立：2026-06-30｜更新：2026-07-03
> 方向：把即時制單人 `MineRunner.vue` 擴展成**同盤搶雷對戰**——N 人（人 vs Bot／人 vs 人）在同一張盤
> 競爭翻雷，跨多張圖累積、先到 GOAL 勝，成長共享。設計決策見 `CONVERSATIONS.md` 與下方備註。

## 現況（2026-07-03）

- **階段 0（純前端雙人 vs bot）完成、上線**——同盤搶雷可玩；#10 平衡調校為持續驗收（有即時調校面板）。
- **階段 1 連線核心完成、上線**——`/runner-vs` 建房／輸碼／公開房 → 同盤連線對戰；server 權威翻牌仲裁、
  seed 同步盤面、server 授時定格換圖。正式站 **mineduel.miao-bao.cc** 已跑，wss 端對端驗過。
- **剩下**：連線手感精修（#15 對手插值/走路動畫、#16 跳躍同步）、韌性（#20 重連、#18 能量校驗）、
  #19 bot 上線，與階段 2 打磨。
- 標記：`[x]` 完成｜`[~]` 部分完成｜`[ ]` 未做。**下一步候選**：#15（畫面順滑）｜#20（斷線重連）｜#10（平衡驗收）。

## 階段 0：純前端 vsBot（驗手感，不碰 server）— 完成（#10 持續驗收）

- [x] **1. 雙人化狀態模型** — `me` → `players[2]`（玩家+bot），各自 x/y/score/energy/moveSlots/buff/face/mode/charge/flight/orbitAngle/baseRegen/成長上限；`cells` 保持單一共享盤面；攝影機與輸入綁 players[0]。
- [x] **2. 翻牌歸屬與雙人計分** — reveal 帶 player；cell 記 owner；同盤先到先得；雙方各自累積雷數。
- [x] **3. 雙人渲染與頭上 HUD** — 兩角色（顏色區分）、各自軌道能量/slot/buff/飄字；攝影機跟玩家，對手即時移動動畫；主 HUD 雙方比分。
- [x] **4. bot 即時 AI 迴圈** ⭐ — 復用 `pickMove` 選目標雷 → 尋路移動 → 翻牌；bot 自己的能量/slot/節奏；三種強度。（階段 1 也要的核心）
- [x] **5. bot 障礙跳躍** — bot 遇障礙自動完成蓄力跳越或繞路。
- [x] **6. 後追加成（移動＋回復）** — `catchupMult` 依雷數差：落後者移動 ×1.35 ＋ 能量/slot 回復加成。雪球防制核心。
- [x] **7. 共享機制適配（loop/成長/buff）** — 障礙共享；翻 0 buff 個人、揭數字共享；重置雷任一人踩→兩人一起換；成長對等（slot+1/能量+1/回復+0.6）。
- [x] **8. 雙人勝負與結算** — 先到累積 GOAL 勝；結算顯雙方分數/用時/張數；重置雷過場改雙人比分對照。
- [x] **9. 大廳 vsBot 入口** — runner 加「對電腦」選 bot 類型。
- [ ] **10. 平衡調校（驗手感）** — bot 強度/節奏、雪球數值、成長曲線、GOAL；此階段驗收門檻。

## 階段 1：server 權威連線對戰（N 人）— 核心完成、上線；剩同步精修

- [x] **11. game.js 解耦回合語意** — `lib/runner-board.js` 抽「翻一格」核心（seed 建盤/flood/歸屬/先到先得），MineRunner 改用它當單一真相。
- [x] **12. server 即時對戰房型** — `lib/rt-room.js`（N 人、無回合）＋ server.js `rt_` 協議房型，與經典回合制分開。
- [x] **13. 即時 ws 協議** — client→（reveal_req / rt_move / rt_create/join/start）；server→（board seed / reveal / position / map_reset / rt_over / rt_lobby）。前端 `net-loopback`＋`net-ws` 同介面。
- [x] **14. server 翻牌仲裁** ⭐ — `rtReveal` 序列化、先到先得定 owner+score、指派重置雷、判勝、廣播。
- [~] **15. 位置同步與預測** ⭐ — 已做降頻送位置（走一格才送）＋對手 CSS 插值；本地預測/子格插值待精修。
- [ ] **16. 跳躍事件同步** — 事件式（非連續幀）：jump_start 帶初始值（起點/方向/n/落地/時長），雙方各自算飛行、落地對齊。
- [~] **17. 全域換圖事件同步** — 重置雷→全房定格（server 授時 RESET_FREEZE_SEC，鎖翻牌）→ 時間到才廣播 map_reset（新 seed）＋成長。剩倒數 3 秒各 client 自數（近同時、微漂移）待精修。
- [ ] **18. 能量/buff 權威校驗** — 個人狀態 client 算求流暢，server 翻牌時校驗能量；buff/成長以 server 事件為準。
- [ ] **19. bot 上 server 即時 agent** — P0 的 bot 迴圈搬 server（或 vsBot 維持純前端不連線），擇一實作。
- [ ] **20. 即時斷線重連** — 重連快照：盤面 + 雙方位置/能量/slot/buff/成長 + loop 進度 + 比分。

## 階段 2：打磨

- [ ] **21. 雪球防制最終調校** — 連線環境重調後追/回復加成曲線、CATCHUP_GAP、成長平衡。
- [ ] **22. record/replay 即時版** — 位置流（降頻）＋事件（翻牌/跳躍/換圖/成長）記錄與回放。
- [ ] **23. lobby 即時對戰入口完善** — 建房/加入/分享/選 bot，與經典對戰並存、清楚區分。
- [ ] **24. 觀戰即時局** — spectator 收位置流+事件、唯讀渲染。
- [ ] **25. 效能與頻寬** — 位置廣播頻率/壓縮、訊息批次、rAF 與網路解耦。
- [ ] **26. 終調與文件** — 手感/平衡最終調；更新 `docs/explore-mode.md` 即時對戰規格、README roadmap、`CONVERSATIONS.md`。

## 關鍵路徑與備註

- ✅ 階段 0（#1–#9）與階段 1 連線核心（#11–#14、#17 定格）皆完成並上線；#4 bot AI 階段 0/1 共用。
- **連線心智模型**：server 只擁「翻牌」（唯一會搶的資源），位置/移動/能量 client 算、seed 同步盤面；
  server 幾乎 event-driven、不跑模擬 tick——N 人能 scale 的前提。
- **架構接縫**：`lib/runner-board.js` 純盤面核心（web＋server 共用）；net 層 `net-loopback`（單機自仲裁）／
  `net-ws`（連線）同介面，`MineRunner` 靠 props.net＋roster 一套元件跑單機/連線；配對在 `RunnerLobby`。
- **剩餘同步精修**：#15 對手插值＋走路動畫（現靠 CSS transition，稍僵、腳不動）；#16 對手跳躍目前只到落點、非弧線。
- **韌性未做**：#20 斷線即出局、#18 能量無 server 校驗。
- 復用：`server.js` 房間/token/keepalive、`lib/bot.js` pickMove 皆已復用；`lib/game.js` 為經典回合制、與 runner 分開。

### 已拍板的設計取捨
- **同盤搶雷 + loop 累積對戰（B 案）**：跨圖累積、先到 GOAL 勝、成長共享。
- **跳躍進對戰**：用事件同步（送初始值各自算飛行），不傳連續幀。
- **雪球防制**：後追 ×1.35 移動 ＋ 能量/slot 回復加成；重置雷不偏向落後者。
- **翻 0 的 buff 個人、但揭開數字共享**：保留「幫對手看到情報」的博弈取捨。
