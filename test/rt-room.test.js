import test from 'node:test';
import assert from 'node:assert/strict';
import { createRtRoom, rtAddPlayer, rtStart, rtReveal, rtResolveReset } from '../lib/rt-room.js';
import { createBoard } from '../lib/runner-board.js';

const cfg = { W: 12, H: 12, MINES: 30, GOAL: 60, RESET_TRIGGER: 8 };

function startedRoom() {
  const room = createRtRoom('TEST', cfg);
  rtAddPlayer(room, 'A');
  rtAddPlayer(room, 'B');
  const seed = rtStart(room);
  return { room, mirror: createBoard({ W: cfg.W, H: cfg.H, MINES: cfg.MINES, seed }) };
}

test('加入玩家依序給 id、分數歸零', () => {
  const room = createRtRoom('T', cfg);
  assert.equal(rtAddPlayer(room, 'A'), 0);
  assert.equal(rtAddPlayer(room, 'B'), 1);
  assert.equal(rtAddPlayer(room, 'C'), 2);   // N 人：不寫死 2
  assert.deepEqual(room.scores, { 0: 0, 1: 0, 2: 0 });
});

test('翻雷歸屬 by、加分；同格第二人翻 → blocked、分數不變', () => {
  const { room, mirror } = startedRoom();
  const mi = mirror.cells.findIndex((c) => c.mine);
  const x = mi % cfg.W, y = Math.floor(mi / cfg.W);
  const e1 = rtReveal(room, 0, x, y);
  assert.equal(e1[0].kind, 'mine');
  assert.equal(e1[0].owner, 0);
  assert.equal(room.scores[0], 1);
  const e2 = rtReveal(room, 1, x, y);
  assert.equal(e2[0].kind, 'blocked');
  assert.equal(room.scores[1], 0);
});

test('搶滿 GOAL → rt_over 帶 winnerId', () => {
  const room = createRtRoom('T', { ...cfg, GOAL: 3 });
  rtAddPlayer(room, 'A'); rtAddPlayer(room, 'B');
  const seed = rtStart(room);
  const mirror = createBoard({ W: cfg.W, H: cfg.H, MINES: cfg.MINES, seed });
  const mines = mirror.cells.map((c, i) => (c.mine ? i : -1)).filter((i) => i >= 0);
  let over = null;
  for (let k = 0; k < 3; k++) {
    const evs = rtReveal(room, 0, mines[k] % cfg.W, Math.floor(mines[k] / cfg.W));
    over = evs.find((e) => e.type === 'rt_over') || over;
  }
  assert.ok(over);
  assert.equal(over.winnerId, 0);
});

test('踩重置雷 → 定格鎖翻牌；rtResolveReset 才換新盤（server 授時）', () => {
  const room = createRtRoom('T', { ...cfg, RESET_TRIGGER: 30 }); // 門檻拉高讓一開始就可能指派
  rtAddPlayer(room, 'A');
  const seed = rtStart(room);
  const mirror = createBoard({ W: cfg.W, H: cfg.H, MINES: cfg.MINES, seed });
  const mines = mirror.cells.map((c, i) => (c.mine ? i : -1)).filter((i) => i >= 0);
  // 先翻一顆雷觸發 resetIdx 指派
  rtReveal(room, 0, mines[0] % cfg.W, Math.floor(mines[0] / cfg.W));
  assert.ok(room.resetIdx >= 0, '應已指派重置雷');
  const rx = room.resetIdx % cfg.W, ry = Math.floor(room.resetIdx / cfg.W);
  const oldSeed = room.seed;

  // 踩重置雷：只回 reveal(reset)、進定格、盤面先不換
  const evs = rtReveal(room, 0, rx, ry);
  assert.equal(evs[0].kind, 'reset');
  assert.ok(!evs.find((e) => e.type === 'map_reset'), '定格期間不立刻換盤');
  assert.equal(room.awaitingReset, true, '進入定格、鎖翻牌');
  assert.equal(room.seed, oldSeed, '盤面尚未換');

  // 定格期間翻牌被忽略
  assert.deepEqual(rtReveal(room, 0, 0, 0), [], '定格期間 rtReveal 回空');

  // 定格結束 → resolve：換新盤、解鎖
  const reset = rtResolveReset(room);
  assert.equal(reset.type, 'map_reset');
  assert.notEqual(room.seed, oldSeed, '換了新盤');
  assert.equal(room.awaitingReset, false, '解鎖');
});
