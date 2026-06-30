import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMove, certainMines, mineProbabilities, BOTS } from '../lib/bot.js';

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
  assert.equal(BOTS.smart.id, 'smart');
});

test('smart 認得確定的雷（機率=1）並優先點', () => {
  // 自洽盤：(0,0) 是唯一的雷，三個鄰格 (0,1)(1,0)(1,1) 都是數字 1 → (0,0) 必為雷
  const cells = Array.from({ length: 9 }, () => ({ mine: false, adj: 0, revealed: true, owner: null }));
  const at = (x, y) => cells[y * 3 + x];
  at(0, 0).mine = true; at(0, 0).revealed = false;
  at(0, 1).adj = 1; at(1, 0).adj = 1; at(1, 1).adj = 1;
  const game = { cells, width: 3, height: 3, mineCount: 1 };
  assert.equal(mineProbabilities(game).get(0), 1); // (0,0) 確定是雷
  assert.deepEqual(pickMove(game, 'smart'), { x: 0, y: 0 });
});

// 綜合兩個數字線索：(0,1) 與 (1,1) 都說「(0,0)、(1,0) 之中有 1 顆雷」，
// 而 (2,0)=0 又確認 (1,0) 安全 → smart 會避開安全格、挑機率較高的 (0,0)（greedy 只會亂猜）。
test('smart 避開可推得安全的格，挑最可能是雷的', () => {
  const cells = Array.from({ length: 9 }, () => ({ mine: false, adj: 0, revealed: true, owner: null }));
  const at = (x, y) => cells[y * 3 + x];
  at(0, 0).mine = true; at(0, 0).revealed = false; // 唯一的雷，未翻開
  at(1, 0).revealed = false; // 未翻開的安全格
  at(0, 1).adj = 1; // 鄰 (0,0)、(1,0)，其中 1 雷
  at(1, 1).adj = 1; // 同上
  // (2,0) adj 維持 0：鄰格 (1,0) 必安全
  const game = { cells, width: 3, height: 3, mineCount: 1 };

  const probs = mineProbabilities(game);
  assert.equal(probs.get(0), 0.5); // (0,0) 半機率（線索無法單獨確定）
  assert.equal(probs.get(1), 0); // (1,0) 被推得安全
  assert.deepEqual(pickMove(game, 'smart'), { x: 0, y: 0 });
});
