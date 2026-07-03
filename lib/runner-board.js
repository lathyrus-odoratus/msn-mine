// 探雷即時對戰・共享盤面核心（純函式，無 Vue/DOM）。
// web 端（本機 loopback 預測）與 server 端（權威仲裁）共用同一份 → 同 seed 建出同一張盤。
// 只負責「共享」的部分：盤面、翻一格的歸屬與 flood、重置雷指派。
// 個人狀態（能量/buff/分數增減）由呼叫端依回傳的 kind 自行套用——盤面核心不碰。

// 決定性 RNG（mulberry32）：同 seed → 同序列，client 與 server 才會建出一模一樣的盤。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (W, x, y) => y * W + x;
const inB = (W, H, x, y) => x >= 0 && x < W && y >= 0 && y < H;

// 用 seed 建盤：Fisher–Yates 洗牌（seeded）決定雷位，再算每格相鄰雷數。
export function createBoard({ W, H, MINES, seed }) {
  const rng = mulberry32(seed);
  const N = W * H;
  const cells = new Array(N);
  for (let i = 0; i < N; i++) cells[i] = { mine: false, adj: 0, revealed: false, owner: -1 };
  const order = [...Array(N).keys()];
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const i of order.slice(0, MINES)) cells[i].mine = true;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (cells[at(W, x, y)].mine) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if ((dx || dy) && inB(W, H, x + dx, y + dy) && cells[at(W, x + dx, y + dy)].mine) n++;
    cells[at(W, x, y)].adj = n;
  }
  return { W, H, MINES, seed, cells };
}

// flood 揭開連通的 0 區（含邊界數字）；回傳這次新翻開的格 index 陣列（共享事件用）。
export function floodOpen(board, sx, sy) {
  const { W, H, cells } = board;
  const opened = [];
  const stack = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (!inB(W, H, nx, ny)) continue;
      const c = cells[at(W, nx, ny)];
      if (c.revealed || c.mine) continue;
      c.revealed = true; opened.push(at(W, nx, ny));
      if (c.adj === 0) stack.push([nx, ny]);
    }
  }
  return opened;
}

// 翻開 (x,y) 由 playerId 執行；回傳 kind + 資料並 mutate board。個人效果（分數/能量/buff）呼叫端套。
//   blocked：已翻開，什麼都不做（同盤先到先得靠這個擋）
//   reset  ：踩到重置雷（換圖，owner 不歸屬、不計分）
//   mine   ：搶到雷 → owner=playerId（呼叫端 +1 分）
//   zero   ：翻到 0 → flood（呼叫端補滿能量＋buff）；flooded=新翻開的格
//   number ：翻到數字（呼叫端依 adj 退能量）
export function revealCell(board, x, y, playerId, resetIdx) {
  const { W, cells } = board;
  const i = at(W, x, y);
  const c = cells[i];
  if (c.revealed) return { kind: 'blocked', i };
  if (c.mine) {
    if (i === resetIdx) { c.revealed = true; return { kind: 'reset', i }; }
    c.revealed = true; c.owner = playerId;
    return { kind: 'mine', i, owner: playerId };
  }
  c.revealed = true;
  if (c.adj === 0) return { kind: 'zero', i, flooded: floodOpen(board, x, y) };
  return { kind: 'number', i, adj: c.adj };
}

export function minesLeft(board) {
  let n = 0;
  for (const c of board.cells) if (c.mine && !c.revealed) n++;
  return n;
}

// 指派重置雷：剩餘未翻雷數落在 (0, trigger] 時，隨機選一顆。用傳入 rng 讓權威端可重現。
export function pickReset(board, trigger, rng) {
  const rem = [];
  for (let k = 0; k < board.cells.length; k++) if (board.cells[k].mine && !board.cells[k].revealed) rem.push(k);
  if (rem.length > 0 && rem.length <= trigger) return rem[Math.floor(rng() * rem.length)];
  return -1;
}
