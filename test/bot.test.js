import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMove, certainMines, BOTS } from '../lib/bot.js';

// 手工造一個 3×3 盤面：中心是翻開的「1」，唯一未翻開的鄰格 (0,0) 必為雷
function board3x3() {
  const cells = Array.from({ length: 9 }, () => ({ mine: false, adj: 0, revealed: true, owner: null }));
  const at = (x, y) => cells[y * 3 + x];
  at(0, 0).revealed = false; // 唯一未翻開
  at(1, 1).adj = 1; // 中心數字 1（周圍只有 (0,0) 是雷）
  return { cells, width: 3, height: 3 };
}

test('certainMines 認得「一定是雷」的格', () => {
  const game = board3x3();
  const sure = certainMines(game);
  assert.deepEqual(sure, [{ x: 0, y: 0 }]);
});

test('greedy 優先搶確定的雷', () => {
  const game = board3x3();
  assert.deepEqual(pickMove(game, 'greedy'), { x: 0, y: 0 });
});

test('greedy 無確定雷時退回未翻開格；random 永遠隨機未翻開格', () => {
  // 全翻開只剩一格未翻、且無數字線索 → 兩者都只能回那格
  const cells = Array.from({ length: 9 }, () => ({ mine: false, adj: 0, revealed: true, owner: null }));
  cells[4].revealed = false; // 只有中心未翻開
  const game = { cells, width: 3, height: 3 };
  assert.deepEqual(pickMove(game, 'greedy'), { x: 1, y: 1 });
  assert.deepEqual(pickMove(game, 'random'), { x: 1, y: 1 });
});

test('全部翻開時回傳 null', () => {
  const cells = Array.from({ length: 9 }, () => ({ mine: false, adj: 0, revealed: true, owner: null }));
  assert.equal(pickMove({ cells, width: 3, height: 3 }, 'greedy'), null);
});

test('BOTS 帶 id 與 version', () => {
  assert.equal(BOTS.greedy.id, 'greedy');
  assert.ok(Number.isInteger(BOTS.greedy.version));
});
