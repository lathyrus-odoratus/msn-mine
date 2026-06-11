// Minesweeper Flags 核心邏輯（純函式，不碰網路）
// 規則：兩人輪流點擊。點到雷 → 得分並續手；點到非雷 → 翻開（0 會 flood fill）並換手。
// 先得 WIN_TARGET（過半）顆雷者勝。

export const WIDTH = 16;
export const HEIGHT = 16;
export const MINE_COUNT = 51;
export const WIN_TARGET = 26;

const idx = (x, y) => y * WIDTH + x;
const inBounds = (x, y) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;

function neighbors(x, y) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny)) out.push([nx, ny]);
    }
  }
  return out;
}

export function createGame(rng = Math.random) {
  const total = WIDTH * HEIGHT;
  const cells = Array.from({ length: total }, () => ({
    mine: false,
    adj: 0,
    revealed: false,
    owner: null, // 0 | 1，點到雷的玩家
  }));

  // Fisher-Yates 取前 MINE_COUNT 格埋雷
  const order = Array.from({ length: total }, (_, i) => i);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const i of order.slice(0, MINE_COUNT)) cells[i].mine = true;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (cells[idx(x, y)].mine) continue;
      cells[idx(x, y)].adj = neighbors(x, y).filter(([nx, ny]) => cells[idx(nx, ny)].mine).length;
    }
  }

  return {
    cells,
    scores: [0, 0],
    turn: 0,
    winner: null,
  };
}

// 回傳 { reveals, scores, turn, winner } 或 null（無效點擊）
// reveals: [{ x, y, mine: true, owner }] 或 [{ x, y, mine: false, adj }]
export function click(game, player, x, y) {
  if (game.winner !== null) return null;
  if (player !== game.turn) return null;
  if (!inBounds(x, y)) return null;
  const cell = game.cells[idx(x, y)];
  if (cell.revealed) return null;

  const reveals = [];

  if (cell.mine) {
    cell.revealed = true;
    cell.owner = player;
    game.scores[player]++;
    reveals.push({ x, y, mine: true, owner: player });
    if (game.scores[player] >= WIN_TARGET) game.winner = player;
    // 得分續手，turn 不變
  } else {
    // flood fill：0 才擴散，邊界數字一併翻開
    const stack = [[x, y]];
    const seen = new Set([idx(x, y)]);
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const c = game.cells[idx(cx, cy)];
      if (c.revealed || c.mine) continue;
      c.revealed = true;
      reveals.push({ x: cx, y: cy, mine: false, adj: c.adj });
      if (c.adj === 0) {
        for (const [nx, ny] of neighbors(cx, cy)) {
          const ni = idx(nx, ny);
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

// 終局時揭露所有未被搶到的雷（owner: null）
export function unclaimedMines(game) {
  const out = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const c = game.cells[idx(x, y)];
      if (c.mine && !c.revealed) out.push({ x, y, mine: true, owner: null });
    }
  }
  return out;
}
