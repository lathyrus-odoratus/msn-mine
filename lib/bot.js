// AI 對手的選點邏輯（純函式，吃 game 物件、回傳 {x,y}）。
// 每支 bot 有 id + version，行為一改就 version+1；紀錄會存下當局用的版本快照。

export const BOTS = {
  random: { id: 'random', version: 1, label: '隨機' },
  greedy: { id: 'greedy', version: 1, label: '貪婪' },
  smart: { id: 'smart', version: 1, label: '推理' },
};

function neighbors(w, h, x, y) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) out.push([nx, ny]);
    }
  }
  return out;
}

function unrevealed(game) {
  const { width: w, height: h } = game;
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!game.cells[y * w + x].revealed) out.push({ x, y });
    }
  }
  return out;
}

// 「確定是雷」的未翻開格：對每個翻開的數字格，其 adj 扣掉已搶到的鄰雷 = 還缺的雷數；
// 若還缺的雷數 == 未翻開鄰格數（且 >0），這些未翻開鄰格全部一定是雷。
export function certainMines(game) {
  const { width: w, height: h } = game;
  const found = new Set();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = game.cells[y * w + x];
      if (!c.revealed || c.mine) continue; // 只看翻開的數字格
      let known = 0;
      const hidden = [];
      for (const [nx, ny] of neighbors(w, h, x, y)) {
        const n = game.cells[ny * w + nx];
        if (n.revealed && n.mine) known++;
        else if (!n.revealed) hidden.push(ny * w + nx);
      }
      const need = c.adj - known;
      if (need > 0 && need === hidden.length) for (const i of hidden) found.add(i);
    }
  }
  return [...found].map((i) => ({ x: i % w, y: Math.floor(i / w) }));
}

// 估每個未翻開格「是雷」的機率（Map: index -> p）。踩地雷搶旗中「雷=分數」，
// 所以分數越高越想點。
// - 受限格（鄰接翻開數字）：對每個鄰接數字格，need=adj-已知雷，局部機率 need/該數字的未翻開鄰格數；
//   取各約束中的最大值（need===hidden→1 確定是雷）。任一約束 need===0 → 該格確定安全(0)。
// - 不受限格（無翻開數字鄰居）：用全域機率＝剩餘未搶雷數（扣掉受限格的期望雷數）/ 不受限未翻開格數。
export function mineProbabilities(game) {
  const { width: w, height: h } = game;
  const N = w * h;
  const local = new Array(N).fill(undefined); // 受限格的估計機率；undefined=尚無約束
  const safe = new Set(); // 被某約束判定確定安全
  let knownMines = 0;

  for (let i = 0; i < N; i++) {
    const c = game.cells[i];
    if (c.revealed && c.mine) knownMines++;
    if (!c.revealed || c.mine) continue; // 只看翻開的數字格
    const x = i % w, y = Math.floor(i / w);
    let known = 0;
    const hidden = [];
    for (const [nx, ny] of neighbors(w, h, x, y)) {
      const n = game.cells[ny * w + nx];
      if (n.revealed && n.mine) known++;
      else if (!n.revealed) hidden.push(ny * w + nx);
    }
    if (!hidden.length) continue;
    const need = c.adj - known;
    const p = need <= 0 ? 0 : need / hidden.length;
    for (const hi of hidden) {
      if (need <= 0) safe.add(hi);
      if (local[hi] === undefined || p > local[hi]) local[hi] = p; // 取最大局部機率
    }
  }

  // 全域：把尚未搶到的雷，扣掉受限格的期望雷數後，平均分攤到不受限的未翻開格
  let expectedConstrained = 0;
  let unconstrained = 0;
  for (let i = 0; i < N; i++) {
    if (game.cells[i].revealed) continue;
    if (safe.has(i)) continue;
    if (local[i] === undefined) unconstrained++;
    else expectedConstrained += local[i];
  }
  const minesLeft = Math.max(0, game.mineCount - knownMines);
  const globalP = unconstrained > 0
    ? Math.min(1, Math.max(0, minesLeft - expectedConstrained) / unconstrained)
    : 0;

  const out = new Map();
  for (let i = 0; i < N; i++) {
    if (game.cells[i].revealed) continue;
    out.set(i, safe.has(i) ? 0 : (local[i] === undefined ? globalP : local[i]));
  }
  return out;
}

// 選一手。
//   smart：挑「最可能是雷」的格（確定的雷機率=1 自然優先），同分隨機——能連搶確定雷、猜也猜最有利的。
//   greedy：只搶 100% 確定的雷，沒有才隨機。
//   random：純隨機。
export function pickMove(game, botId = 'greedy', rng = Math.random) {
  if (botId === 'smart') {
    let best = -1;
    const top = [];
    for (const [i, p] of mineProbabilities(game)) {
      if (p > best + 1e-9) { best = p; top.length = 0; top.push(i); }
      else if (p > best - 1e-9) top.push(i);
    }
    if (!top.length) return null;
    const i = top[Math.floor(rng() * top.length)];
    return { x: i % game.width, y: Math.floor(i / game.width) };
  }
  if (botId === 'greedy') {
    const sure = certainMines(game);
    if (sure.length) return sure[Math.floor(rng() * sure.length)];
  }
  const cells = unrevealed(game);
  if (!cells.length) return null;
  return cells[Math.floor(rng() * cells.length)];
}
