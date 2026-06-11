// 端對端煙霧測試：兩個 ws client 模擬完整對局直到分出勝負
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

send(a, { type: 'create', name: 'Alice' });
const created = await recv(a);
assert(created.type === 'created' && created.code.length === 4, `建房拿到房號 ${created.code}`);

// 加入錯誤房號
send(b, { type: 'join', code: 'XXXX', name: 'Bob' });
const err = await recv(b);
assert(err.type === 'error', `錯誤房號被拒：${err.message}`);

send(b, { type: 'join', code: created.code, name: 'Bob' });
const startA = await recv(a);
const startB = await recv(b);
assert(startA.type === 'start' && startA.you === 0, 'Alice 收到 start（座位 0）');
assert(startB.type === 'start' && startB.you === 1, 'Bob 收到 start（座位 1）');
assert(startA.mineCount === 51 && startA.winTarget === 26, '51 雷、26 勝');

// 非自己回合點擊應被忽略（B 先點 → 不該有任何回應）
send(b, { type: 'click', x: 0, y: 0 });
await new Promise((r) => setTimeout(r, 200));
assert(b.inbox.length === 0, '非自己回合的點擊被伺服器忽略');

// 雙方輪流亂點直到分勝負（客戶端只看 update 維護自己視角的棋盤）
const clients = [a, b];
const known = new Map(); // "x,y" -> revealed
let turn = 0;
let gameover = null;
let guard = 0;

outer: while (guard++ < 2000) {
  // 找一個還沒翻開的格子
  let x, y;
  do {
    x = Math.floor(Math.random() * 16);
    y = Math.floor(Math.random() * 16);
  } while (known.has(`${x},${y}`));

  send(clients[turn], { type: 'click', x, y });
  const u1 = await recv(a);
  const u2 = await recv(b);
  if (JSON.stringify(u1) !== JSON.stringify(u2)) { console.error('雙方收到的 update 不一致'); process.exit(1); }
  if (u1.type !== 'update') { console.error('預期 update，收到', u1.type); process.exit(1); }
  for (const r of u1.reveals) known.set(`${r.x},${r.y}`, r);
  turn = u1.turn;
  if (u1.winner !== null) {
    gameover = [await recv(a), await recv(b)];
    break outer;
  }
}

assert(gameover !== null, '對局有分出勝負');
const [goA, goB] = gameover;
assert(goA.type === 'gameover' && goB.type === 'gameover', '雙方都收到 gameover');
assert(goA.scores[goA.winner] === 26, `贏家拿到 26 分（比數 ${goA.scores.join(':')}，贏家座位 ${goA.winner}）`);
const flagged = [...known.values()].filter((r) => r.mine).length;
assert(flagged + goA.remaining.length === 51, `已搶雷 ${flagged} + 剩餘雷 ${goA.remaining.length} = 51`);

// 再來一局
send(a, { type: 'rematch' });
const req = await recv(b);
assert(req.type === 'rematch_request', 'Bob 收到對手想再來一局');
send(b, { type: 'rematch' });
const re1 = await recv(a);
const re2 = await recv(b);
assert(re1.type === 'start' && re2.type === 'start', '雙方同意後重新開局');

// 斷線通知（寬限期內先收到 disconnected；逾時解散的情境由 test/reconnect.e2e.js 覆蓋）
a.ws.close();
const left = await recv(b);
assert(left.type === 'opponent_disconnected', 'Alice 離線後 Bob 收到斷線通知');

console.log('\n全部通過 🎉');
b.ws.close();
process.exit(0);
