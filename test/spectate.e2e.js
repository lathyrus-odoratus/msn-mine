// 端對端測試：滿房自動轉觀戰、觀戰者收得到即時更新、唯讀、人數同步
import WebSocket from 'ws';

const URL = 'ws://localhost:3000/ws';

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const client = { ws, name, inbox: [], waiters: [] };
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      const w = client.waiters.shift();
      if (w) w(msg);
      else client.inbox.push(msg);
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
  });
}

function recv(client, timeoutMs = 3000) {
  if (client.inbox.length) return Promise.resolve(client.inbox.shift());
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${client.name} 等不到訊息`)), timeoutMs);
    client.waiters.push((msg) => { clearTimeout(t); resolve(msg); });
  });
}

const send = (c, msg) => c.ws.send(JSON.stringify(msg));
const assert = (cond, label) => {
  if (!cond) { console.error(`✗ ${label}`); process.exit(1); }
  console.log(`✓ ${label}`);
};

const a = await connect('A');
const b = await connect('B');
const c = await connect('C');

// 開一局
send(a, { type: 'create', name: 'Alice' });
const created = await recv(a);
send(b, { type: 'join', code: created.code, name: 'Bob' });
const startA = await recv(a);
await recv(b); // Bob start
assert(startA.type === 'start', '對局已開始');

// 滿房後 Charlie 用同房號加入 → 自動轉觀戰
send(c, { type: 'join', code: created.code, name: 'Charlie' });
const spec = await recv(c);
assert(spec.type === 'spectate_state', '滿房加入 → 收到 spectate_state（非 error/start）');
assert(spec.you === undefined, '觀戰者沒有座位（you 不存在）');
assert(Array.isArray(spec.reveals) && spec.reveals.length === 0, '進場時棋盤尚無翻開格');
assert(spec.names[0] === 'Alice' && spec.names[1] === 'Bob', '觀戰者看得到雙方暱稱');
assert(spec.winner === null, '對局進行中（winner 為 null）');

// 人數廣播：三方都收到 spectators count=1
const cntA = await recv(a);
const cntB = await recv(b);
const cntC = await recv(c);
assert(cntA.type === 'spectators' && cntA.count === 1, '玩家 A 收到觀戰人數=1');
assert(cntB.type === 'spectators' && cntB.count === 1, '玩家 B 收到觀戰人數=1');
assert(cntC.type === 'spectators' && cntC.count === 1, '觀戰者也收到人數=1');

// Alice（座位 0，先手）點一格 → 三方都收到一致的 update
send(a, { type: 'click', x: 0, y: 0 });
const uA = await recv(a);
const uB = await recv(b);
const uC = await recv(c);
assert(uA.type === 'update', '玩家收到 update');
assert(JSON.stringify(uA) === JSON.stringify(uC), '觀戰者收到的 update 與玩家完全一致');
assert(JSON.stringify(uB) === JSON.stringify(uC), '兩玩家與觀戰者三方同步');

// 觀戰者點擊應被忽略：送 click 後三方都不該再收到任何訊息
send(c, { type: 'click', x: 5, y: 5 });
await new Promise((r) => setTimeout(r, 250));
assert(a.inbox.length === 0 && b.inbox.length === 0 && c.inbox.length === 0, '觀戰者的點擊被伺服器忽略（唯讀）');

// 觀戰者離場 → 玩家收到人數歸零
c.ws.close();
const cnt0 = await recv(a);
assert(cnt0.type === 'spectators' && cnt0.count === 0, '觀戰者離場後玩家收到人數=0');

console.log('\n觀戰測試全部通過 🎉');
a.ws.close();
b.ws.close();
process.exit(0);
