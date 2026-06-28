// Minesweeper Flags 核心邏輯（純函式，不碰網路）
// 規則：兩人輪流點擊。點到雷 → 得分並續手；點到非雷 → 翻開（0 會 flood fill）並換手。
// 先得 WIN_TARGET（過半）顆雷者勝。

// 場地設定：可選的棋盤尺寸。winTarget 取過半（雷數為奇數，不會平手）
export const PRESETS = {
  standard: { key: 'standard', label: '標準', width: 16, height: 16, mineCount: 51, winTarget: 26 },
  small: { key: 'small', label: '小場', width: 12, height: 12, mineCount: 29, winTarget: 15 },
};
export const STANDARD = PRESETS.standard;

// 向後相容的預設尺寸常數（＝標準場），給既有測試與不指定設定時使用
export const WIDTH = STANDARD.width;
export const HEIGHT = STANDARD.height;
export const MINE_COUNT = STANDARD.mineCount;
export const WIN_TARGET = STANDARD.winTarget;

const idxOf = (w, x, y) => y * w + x;
const inBoundsOf = (w, h, x, y) => x >= 0 && x < w && y >= 0 && y < h;

function neighborsOf(w, h, x, y) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (inBoundsOf(w, h, nx, ny)) out.push([nx, ny]);
    }
  }
  return out;
}

// createGame(config, rng)：config 為 PRESETS 之一（預設標準場）。
// 回傳的 game 物件自帶 width/height/mineCount/winTarget，後續操作不再依賴模組常數。
export function createGame(config = STANDARD, rng = Math.random) {
  const { width, height, mineCount, winTarget } = config;
  const total = width * height;
  const cells = Array.from({ length: total }, () => ({
    mine: false,
    adj: 0,
    revealed: false,
    owner: null, // 0 | 1，點到雷的玩家
  }));

  // Fisher-Yates 取前 mineCount 格埋雷
  const order = Array.from({ length: total }, (_, i) => i);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const i of order.slice(0, mineCount)) cells[i].mine = true;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cells[idxOf(width, x, y)].mine) continue;
      cells[idxOf(width, x, y)].adj = neighborsOf(width, height, x, y)
        .filter(([nx, ny]) => cells[idxOf(width, nx, ny)].mine).length;
    }
  }

  return {
    cells,
    scores: [0, 0],
    turn: 0,
    winner: null,
    width, height, mineCount, winTarget,
  };
}

// 回傳 { reveals, scores, turn, winner } 或 null（無效點擊）
// reveals: [{ x, y, mine: true, owner }] 或 [{ x, y, mine: false, adj }]
export function click(game, player, x, y) {
  if (game.winner !== null) return null;
  if (player !== game.turn) return null;
  const { width: w, height: h } = game;
  if (!inBoundsOf(w, h, x, y)) return null;
  const cell = game.cells[idxOf(w, x, y)];
  if (cell.revealed) return null;

  const reveals = [];

  if (cell.mine) {
    cell.revealed = true;
    cell.owner = player;
    game.scores[player]++;
    reveals.push({ x, y, mine: true, owner: player });
    if (game.scores[player] >= game.winTarget) game.winner = player;
    // 得分續手，turn 不變
  } else {
    // flood fill：0 才擴散，邊界數字一併翻開
    const stack = [[x, y]];
    const seen = new Set([idxOf(w, x, y)]);
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const c = game.cells[idxOf(w, cx, cy)];
      if (c.revealed || c.mine) continue;
      c.revealed = true;
      reveals.push({ x: cx, y: cy, mine: false, adj: c.adj });
      if (c.adj === 0) {
        for (const [nx, ny] of neighborsOf(w, h, cx, cy)) {
          const ni = idxOf(w, nx, ny);
          if (!seen.has(ni)) {
            seen.add(ni);
            stack.push([nx, ny]);
          }
        }
      }
    }
    game.turn = 1 - player;
  }

  return { reveals, scores: [...game.scores], turn: game.turn, winner: game.winner };
}

// 重連用：回傳所有已翻開格子的揭露列表（與 update 的 reveals 同格式）
export function snapshot(game) {
  const { width: w, height: h } = game;
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = game.cells[idxOf(w, x, y)];
      if (!c.revealed) continue;
      out.push(c.mine ? { x, y, mine: true, owner: c.owner } : { x, y, mine: false, adj: c.adj });
    }
  }
  return out;
}

// 終局時揭露所有未被搶到的雷（owner: null）
export function unclaimedMines(game) {
  const { width: w, height: h } = game;
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = game.cells[idxOf(w, x, y)];
      if (c.mine && !c.revealed) out.push({ x, y, mine: true, owner: null });
    }
  }
  return out;
}
