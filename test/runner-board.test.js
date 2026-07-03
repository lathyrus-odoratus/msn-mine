import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, revealCell, floodOpen, minesLeft, pickReset, mulberry32 } from '../lib/runner-board.js';

const CFG = { W: 12, H: 12, MINES: 30 };

test('同 seed 建出一模一樣的盤（連線同步的前提）', () => {
  const a = createBoard({ ...CFG, seed: 12345 });
  const b = createBoard({ ...CFG, seed: 12345 });
  assert.deepEqual(a.cells.map((c) => c.mine), b.cells.map((c) => c.mine));
  assert.deepEqual(a.cells.map((c) => c.adj), b.cells.map((c) => c.adj));
});

test('不同 seed 幾乎必不同盤', () => {
  const a = createBoard({ ...CFG, seed: 1 });
  const b = createBoard({ ...CFG, seed: 2 });
  const same = a.cells.every((c, i) => c.mine === b.cells[i].mine);
  assert.equal(same, false);
});

test('雷數正確、adj 與周圍雷數一致', () => {
  const board = createBoard({ ...CFG, seed: 777 });
  assert.equal(board.cells.filter((c) => c.mine).length, CFG.MINES);
  assert.equal(minesLeft(board), CFG.MINES);
  const { W, H, cells } = board;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = cells[y * W + x];
    if (c.mine) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && nx < W && ny >= 0 && ny < H && cells[ny * W + nx].mine) n++;
    }
    assert.equal(c.adj, n);
  }
});

test('搶雷歸屬 owner，且同盤先到先得（已翻開回 blocked）', () => {
  const board = createBoard({ ...CFG, seed: 42 });
  const mi = board.cells.findIndex((c) => c.mine);
  const mx = mi % board.W, my = Math.floor(mi / board.W);
  const r1 = revealCell(board, mx, my, 0, -1);
  assert.equal(r1.kind, 'mine');
  assert.equal(board.cells[mi].owner, 0);
  assert.equal(minesLeft(board), CFG.MINES - 1);
  // 第二人翻同一格 → blocked、owner 不變
  const r2 = revealCell(board, mx, my, 1, -1);
  assert.equal(r2.kind, 'blocked');
  assert.equal(board.cells[mi].owner, 0);
});

test('重置雷：踩到回 reset、owner 不歸屬、不減雷（仍算已翻）', () => {
  const board = createBoard({ ...CFG, seed: 99 });
  const mi = board.cells.findIndex((c) => c.mine);
  const mx = mi % board.W, my = Math.floor(mi / board.W);
  const r = revealCell(board, mx, my, 1, mi);
  assert.equal(r.kind, 'reset');
  assert.equal(board.cells[mi].owner, -1);
  assert.equal(board.cells[mi].revealed, true);
});

test('翻到 0 會 flood，回傳新翻開的格', () => {
  const board = createBoard({ ...CFG, seed: 2024 });
  const zi = board.cells.findIndex((c) => !c.mine && c.adj === 0);
  const zx = zi % board.W, zy = Math.floor(zi / board.W);
  const r = revealCell(board, zx, zy, 0, -1);
  assert.equal(r.kind, 'zero');
  assert.ok(Array.isArray(r.flooded));
  // flood 出來的格都應為非雷且已翻開
  for (const i of r.flooded) {
    assert.equal(board.cells[i].mine, false);
    assert.equal(board.cells[i].revealed, true);
  }
});

test('pickReset：剩餘雷數在門檻內才指派、且指到的是未翻開的雷', () => {
  const board = createBoard({ ...CFG, seed: 5 });
  const rng = mulberry32(5);
  // 一開始 30 顆 > 門檻 8 → 不指派
  assert.equal(pickReset(board, 8, rng), -1);
  // 翻掉 23 顆雷（剩 7 ≤ 8）
  let claimed = 0;
  for (let i = 0; i < board.cells.length && claimed < 23; i++) {
    if (board.cells[i].mine && !board.cells[i].revealed) { board.cells[i].revealed = true; claimed++; }
  }
  const idx = pickReset(board, 8, rng);
  assert.notEqual(idx, -1);
  assert.equal(board.cells[idx].mine, true);
  assert.equal(board.cells[idx].revealed, false);
});
