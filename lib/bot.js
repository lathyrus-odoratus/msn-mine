// AI 對手的選點邏輯（純函式，吃 game 物件、回傳 {x,y}）。
// 每支 bot 有 id + version，行為一改就 version+1；紀錄會存下當局用的版本快照。

export const BOTS = {
  random: { id: 'random', version: 1, label: '隨機' },
  greedy: { id: 'greedy', version: 1, label: '貪婪' },
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

// 選一手。greedy：優先搶確定的雷（得分又續手），沒有才隨機；random：純隨機。
export function pickMove(game, botId = 'greedy', rng = Math.random) {
  if (botId === 'greedy') {
    const sure = certainMines(game);
    if (sure.length) return sure[Math.floor(rng() * sure.length)];
  }
  const cells = unrevealed(game);
  if (!cells.length) return null;
  return cells[Math.floor(rng() * cells.length)];
}
