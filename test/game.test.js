import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, click, unclaimedMines, WIDTH, HEIGHT, MINE_COUNT, WIN_TARGET, STANDARD, PRESETS } from '../lib/game.js';

// 固定 seed 的簡易 LCG，讓測試可重現
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function findCell(game, pred) {
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const c = game.cells[y * WIDTH + x];
      if (pred(c)) return { x, y, cell: c };
    }
  }
  return null;
}

test('棋盤有正確的雷數與相鄰數字', () => {
  const game = createGame(STANDARD, seededRng(42));
  const mines = game.cells.filter((c) => c.mine).length;
  assert.equal(mines, MINE_COUNT);

  const { x, y, cell } = findCell(game, (c) => !c.mine);
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT && game.cells[ny * WIDTH + nx].mine) count++;
    }
  }
  assert.equal(cell.adj, count);
});

test('點到雷：得分、續手', () => {
  const game = createGame(STANDARD, seededRng(1));
  const { x, y } = findCell(game, (c) => c.mine);
  const r = click(game, 0, x, y);
  assert.equal(r.scores[0], 1);
  assert.equal(r.turn, 0); // 續手
  assert.equal(r.reveals[0].mine, true);
  assert.equal(r.reveals[0].owner, 0);
});

test('點到非雷：翻開、換手、不得分', () => {
  const game = createGame(STANDARD, seededRng(1));
  const { x, y } = findCell(game, (c) => !c.mine);
  const r = click(game, 0, x, y);
  assert.equal(r.scores[0], 0);
  assert.equal(r.turn, 1);
  assert.ok(r.reveals.length >= 1);
  assert.ok(r.reveals.every((rv) => !rv.mine));
});

test('點到 0 會 flood fill 出一片', () => {
  const game = createGame(STANDARD, seededRng(7));
  const found = findCell(game, (c) => !c.mine && c.adj === 0);
  assert.ok(found, '此 seed 應有 0 格');
  const r = click(game, 0, found.x, found.y);
  assert.ok(r.reveals.length > 1);
});

test('非法點擊回傳 null：不是你的回合、重複點、越界', () => {
  const game = createGame(STANDARD, seededRng(1));
  assert.equal(click(game, 1, 0, 0), null); // turn 是 0
  assert.equal(click(game, 0, -1, 5), null);
  const { x, y } = findCell(game, (c) => c.mine);
  click(game, 0, x, y);
  assert.equal(click(game, 0, x, y), null); // 已翻開
});

test('搶到 26 雷獲勝，勝後不能再點', () => {
  const game = createGame(STANDARD, seededRng(3));
  let r = null;
  // 玩家 0 連續點雷（點雷續手，所以可以一路點下去）
  for (let i = 0; i < WIN_TARGET; i++) {
    const m = findCell(game, (c) => c.mine && !c.revealed);
    r = click(game, 0, m.x, m.y);
  }
  assert.equal(r.winner, 0);
  assert.equal(r.scores[0], WIN_TARGET);
  const m = findCell(game, (c) => c.mine && !c.revealed);
  assert.equal(click(game, 0, m.x, m.y), null);
  assert.equal(unclaimedMines(game).length, MINE_COUNT - WIN_TARGET);
});

test('小場設定：12×12、29 雷、先搶 15、game 自帶尺寸', () => {
  const game = createGame(PRESETS.small, seededRng(9));
  assert.equal(game.width, 12);
  assert.equal(game.height, 12);
  assert.equal(game.cells.length, 144);
  assert.equal(game.cells.filter((c) => c.mine).length, 29);
  assert.equal(game.winTarget, 15);

  // 連點 15 雷即獲勝
  let r = null;
  for (let i = 0; i < 15; i++) {
    let m = null;
    for (let k = 0; k < game.cells.length && !m; k++) if (game.cells[k].mine && !game.cells[k].revealed) m = k;
    r = click(game, 0, m % 12, Math.floor(m / 12));
  }
  assert.equal(r.winner, 0);
  assert.equal(r.scores[0], 15);
});
