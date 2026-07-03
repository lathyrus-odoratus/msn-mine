// 探雷即時對戰・端對端：in-process 開 server，兩個 ws client 走建房/加入/開局/翻牌，
// 驗證翻牌仲裁廣播、同盤先到先得、位置轉發。
process.env.PORT = process.env.PORT || '3111';
process.env.DATABASE_URL = ''; // 不連 PG，走記憶體降級
await import('../server.js');
import WebSocket from 'ws';
import { createBoard } from '../lib/runner-board.js';

const PORT = process.env.PORT;
const URL = `ws://localhost:${PORT}/ws`;

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const client = { ws, name, inbox: [], waiters: [] };
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      const w = client.waiters.shift();
      if (w) w(msg); else client.inbox.push(msg);
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}
function recv(client, timeoutMs = 3000) {
  if (client.inbox.length) return Promise.resolve(client.inbox.shift());
  return new Promise((resolve, reject) => {
    const waiter = (msg) => { clearTimeout(t); resolve(msg); };
    const t = setTimeout(() => {
      const i = client.waiters.indexOf(waiter);
      if (i !== -1) client.waiters.splice(i, 1);   // 逾時要移除殭屍 waiter，否則會吃掉後續訊息
      reject(new Error(`${client.name} 等不到訊息`));
    }, timeoutMs);
    client.waiters.push(waiter);
  });
}
// 等到某型別的訊息（略過中間的 rt_lobby 等）
async function recvType(client, type, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const m = await recv(client, Math.max(50, deadline - Date.now()));
    if (m.type === type) return m;
  }
}
const send = (c, msg) => c.ws.send(JSON.stringify(msg));
const assert = (cond, label) => {
  if (!cond) { console.error(`✗ ${label}`); process.exit(1); }
  console.log(`✓ ${label}`);
};

await new Promise((r) => setTimeout(r, 300)); // 等 server listen

const a = await connect('A');
const b = await connect('B');

// 建房 / 加入
send(a, { type: 'rt_create', name: 'Alice', cfg: { W: 12, H: 12, MINES: 30, GOAL: 60, RESET_TRIGGER: 8 } });
const created = await recvType(a, 'rt_created');
assert(created.code && created.code.length === 4, `建房拿到房號 ${created.code}`);
assert(created.id === 0, 'Alice 是 id 0');

send(b, { type: 'rt_join', code: created.code, name: 'Bob' });
const joined = await recvType(b, 'rt_joined');
assert(joined.id === 1, 'Bob 是 id 1');

// 開局 → 兩人都收到同一個 seed
send(a, { type: 'rt_start' });
const boardA = await recvType(a, 'board');
const boardB = await recvType(b, 'board');
assert(boardA.seed === boardB.seed, `兩人拿到同一 seed（同盤）：${boardA.seed}`);

// 用 seed 重建盤面找一顆雷
const board = createBoard({ W: 12, H: 12, MINES: 30, seed: boardA.seed });
const mi = board.cells.findIndex((c) => c.mine);
const mx = mi % 12, my = Math.floor(mi / 12);

// A 翻雷 → 兩人都收到 reveal(by:0, kind:mine, owner:0)
send(a, { type: 'reveal_req', x: mx, y: my });
const revA = await recvType(a, 'reveal');
const revB = await recvType(b, 'reveal');
assert(revA.kind === 'mine' && revA.owner === 0, 'A 翻到雷、歸屬 0');
assert(revB.by === 0 && revB.kind === 'mine', 'B 也收到同一則 reveal（廣播）');

// B 翻同一格 → blocked（先到先得）
send(b, { type: 'reveal_req', x: mx, y: my });
const blocked = await recvType(b, 'reveal');
assert(blocked.kind === 'blocked', '同格第二人翻 → blocked（先到先得）');

// 位置轉發：A move → B 收到 position，A 不會收到自己的
send(a, { type: 'rt_move', x: 3, y: 4 });
const pos = await recvType(b, 'position');
assert(pos.id === 0 && pos.x === 3 && pos.y === 4, 'B 收到 A 的位置轉發');
await new Promise((r) => setTimeout(r, 100));
assert(a.inbox.every((m) => m.type !== 'position'), 'A 不會收到自己的位置');

// ── 重置雷：定格期間不換盤，server 授時（此處 1s）後才 map_reset ──
const c = await connect('C');
send(c, { type: 'rt_create', name: 'Carol', cfg: { W: 12, H: 12, MINES: 30, GOAL: 300, RESET_TRIGGER: 30, RESET_FREEZE_SEC: 2 } });
await recvType(c, 'rt_created');
send(c, { type: 'rt_start' });
const cBoard = await recvType(c, 'board');
const cb = createBoard({ W: 12, H: 12, MINES: 30, seed: cBoard.seed });
const cMines = cb.cells.map((cc, i) => (cc.mine ? i : -1)).filter((i) => i >= 0);
let gotReset = false;
for (const idx of cMines) {                       // 逐顆翻雷，總會踩到那顆重置雷
  send(c, { type: 'reveal_req', x: idx % 12, y: Math.floor(idx / 12) });
  if ((await recvType(c, 'reveal')).kind === 'reset') { gotReset = true; break; }
}
assert(gotReset, '翻到重置雷（kind reset）');
let early = false;
try { await recvType(c, 'map_reset', 800); early = true; } catch { /* 預期定格中收不到 */ }
assert(!early, '定格期間不立刻換盤');
const mr = await recvType(c, 'map_reset', 2600);
assert(mr.seed !== cBoard.seed, `定格 ~2s 後 server 才換新盤（seed ${mr.seed}）`);

console.log('\n✅ rt e2e 全過');
process.exit(0);
