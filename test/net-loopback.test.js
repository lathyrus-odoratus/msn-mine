import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoopbackNet } from '../web/src/net-loopback.js';
import { createBoard } from '../lib/runner-board.js';

const cfg = { W: 12, H: 12, MINES: 30, RESET_TRIGGER: 8 };

function freshNet() {
  const net = createLoopbackNet({ getCfg: () => cfg });
  const events = [];
  net.on((ev) => events.push(ev));
  return { net, events };
}

test('new_board 發出 board 事件帶 seed', () => {
  const { net, events } = freshNet();
  net.send({ t: 'new_board' });
  const be = events.find((e) => e.t === 'board');
  assert.ok(be && Number.isInteger(be.seed));
});

test('翻雷 → mine + owner=by；同格再翻 → blocked（先到先得）', () => {
  const { net, events } = freshNet();
  net.send({ t: 'new_board' });
  const seed = events.find((e) => e.t === 'board').seed;
  const mirror = createBoard({ ...cfg, seed });
  const mi = mirror.cells.findIndex((c) => c.mine);
  const x = mi % cfg.W, y = Math.floor(mi / cfg.W);
  net.send({ t: 'reveal_req', by: 3, x, y });
  assert.equal(events.at(-1).kind, 'mine');
  assert.equal(events.at(-1).owner, 3);
  net.send({ t: 'reveal_req', by: 4, x, y });
  assert.equal(events.at(-1).kind, 'blocked');
});

test('翻 0 → zero 事件帶 flooded 陣列', () => {
  const { net, events } = freshNet();
  net.send({ t: 'new_board' });
  const seed = events.find((e) => e.t === 'board').seed;
  const mirror = createBoard({ ...cfg, seed });
  const zi = mirror.cells.findIndex((c) => !c.mine && c.adj === 0);
  net.send({ t: 'reveal_req', by: 0, x: zi % cfg.W, y: Math.floor(zi / cfg.W) });
  const r = events.at(-1);
  assert.equal(r.kind, 'zero');
  assert.ok(Array.isArray(r.flooded));
});

test('reveal 事件回傳的 by 與請求一致（歸屬正確）', () => {
  const { net, events } = freshNet();
  net.send({ t: 'new_board' });
  const seed = events.find((e) => e.t === 'board').seed;
  const mirror = createBoard({ ...cfg, seed });
  const numI = mirror.cells.findIndex((c) => !c.mine && c.adj > 0);
  net.send({ t: 'reveal_req', by: 2, x: numI % cfg.W, y: Math.floor(numI / cfg.W) });
  assert.equal(events.at(-1).by, 2);
  assert.equal(events.at(-1).kind, 'number');
});
