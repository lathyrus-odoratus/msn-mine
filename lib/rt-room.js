// 探雷即時對戰・房型邏輯（純資料，無 ws）。N 人、無回合、共享盤面。
// 權威只管「翻牌」：用 runner-board 仲裁歸屬/flood/先到先得、指派重置雷、換圖、判勝。
// 個人狀態（能量/buff/移動）不在這裡——client 自算，翻牌時才由這裡定生死。
import { createBoard, revealCell, pickReset } from './runner-board.js';

export function createRtRoom(code, cfg) {
  return {
    code, cfg,                 // cfg: { W, H, MINES, GOAL, RESET_TRIGGER }
    players: [],               // [{ id, name, x, y }]
    scores: {},                // id -> 累積搶到的雷數（跨圖 loop）
    board: null, seed: 0, resetIdx: -1,
    started: false, winnerId: null,
    awaitingReset: false,      // 踩到重置雷後、等 server 定格計時期間，鎖住翻牌
  };
}

export function rtAddPlayer(room, name) {
  const id = room.players.length;
  room.players.push({ id, name: String(name || `玩家${id + 1}`).slice(0, 12), x: 0, y: 0 });
  room.scores[id] = 0;
  return id;
}

// 新一張盤（權威生 seed，client 收到後用同 seed 建鏡像盤）
export function rtNewBoard(room) {
  const seed = (Math.random() * 0x7fffffff) | 0;
  room.board = createBoard({ W: room.cfg.W, H: room.cfg.H, MINES: room.cfg.MINES, seed });
  room.seed = seed;
  room.resetIdx = -1;
  return seed;
}

// 開局：清分數、發第一張盤
export function rtStart(room) {
  room.started = true;
  room.winnerId = null;
  for (const id of Object.keys(room.scores)) room.scores[id] = 0;
  return rtNewBoard(room);
}

// 仲裁一次翻牌，回傳要廣播的事件陣列（reveal、可能的 map_reset / rt_over）。
export function rtReveal(room, by, x, y) {
  if (!room.board || room.winnerId !== null || room.awaitingReset) return [];
  const res = revealCell(room.board, x, y, by, room.resetIdx);
  const out = [{ type: 'reveal', by, x, y, kind: res.kind, owner: res.owner, adj: res.adj, flooded: res.flooded }];
  if (res.kind === 'blocked') return out;
  if (res.kind === 'mine') {
    room.scores[by] = (room.scores[by] || 0) + 1;
    if (room.resetIdx < 0) {
      const r = pickReset(room.board, room.cfg.RESET_TRIGGER, Math.random);
      if (r >= 0) room.resetIdx = r;
    }
    if (room.scores[by] >= room.cfg.GOAL) {
      room.winnerId = by;
      out.push({ type: 'rt_over', winnerId: by, scores: { ...room.scores } });
      return out;
    }
  }
  if (res.kind === 'reset') {
    // 踩重置雷 → 進入定格：鎖翻牌，換盤交給 server 授時（rtResolveReset）在 N 秒後做，全房同步
    room.awaitingReset = true;
  }
  return out;
}

// server 定格計時結束後呼叫：生新盤、解鎖，回傳要廣播的 map_reset 事件
export function rtResolveReset(room) {
  room.awaitingReset = false;
  const seed = rtNewBoard(room);
  return { type: 'map_reset', seed };
}
