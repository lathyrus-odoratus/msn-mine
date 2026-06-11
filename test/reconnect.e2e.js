// 斷線重連端對端測試：自行啟動短寬限期（GRACE_MS=800）的伺服器於 port 3101
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 3101;
const GRACE_MS = 800;
const WS_URL = `ws://localhost:${PORT}/ws`;

const assert = (cond, label) => {
  if (!cond) { console.error(`✗ ${label}`); process.exit(1); }
  console.log(`✓ ${label}`);
};

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 啟動測試專用伺服器
const server = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), GRACE_MS: String(GRACE_MS) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
process.on('exit', () => server.kill());
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(); });
  server.on('error', reject);
  setTimeout(() => reject(new Error('伺服器啟動逾時')), 5000);
});

const a = await connect('A');
const b = await connect('B');

send(a, { type: 'create', name: 'Alice' });
const created = await recv(a);
assert(created.token && created.token.length === 32, '建房拿到重連 token');

send(b, { type: 'join', code: created.code, name: 'Bob' });
const startA = await recv(a);
const startB = await recv(b);
assert(startB.token && startB.token !== startA.token, '雙方各自拿到不同 token');

// A（座位 0，先手）點一格，累積一些棋盤狀態
send(a, { type: 'click', x: 8, y: 8 });
const u1 = await recv(a);
await recv(b);
const revealedCount = u1.reveals.length;

// A 斷線 → B 收到暫時斷線通知
a.ws.close();
const disc = await recv(b);
assert(disc.type === 'opponent_disconnected', 'B 收到對手暫時斷線通知');

// A 在寬限期內用 token 重連
const a2 = await connect('A2');
send(a2, { type: 'rejoin', token: startA.token });
const rejoined = await recv(a2);
assert(rejoined.type === 'rejoined' && rejoined.you === 0, 'A 重連回到座位 0');
assert(rejoined.reveals.length === revealedCount, `棋盤快照一致（${revealedCount} 格已翻開）`);
assert(rejoined.turn === u1.turn, '回合狀態一致');
const reconn = await recv(b);
assert(reconn.type === 'opponent_reconnected', 'B 收到對手重連通知');

// 重連後遊戲可以繼續：輪到誰誰就點一格
const cur = rejoined.turn === 0 ? a2 : b;
send(cur, { type: 'click', x: 0, y: 0 });
const u2a = await recv(a2);
const u2b = await recv(b);
assert(u2a.type === 'update' && u2b.type === 'update', '重連後對局正常繼續');

// B 斷線且不回來 → 寬限期過後 A 收到 opponent_left，房間解散
b.ws.close();
const disc2 = await recv(a2);
assert(disc2.type === 'opponent_disconnected', 'A 收到 B 斷線通知');
const left = await recv(a2, GRACE_MS + 2000);
assert(left.type === 'opponent_left', `寬限期（${GRACE_MS}ms）過後收到對手離開`);

// 房間解散後 token 應失效
await sleep(100);
const c = await connect('C');
send(c, { type: 'rejoin', token: startB.token });
const fail = await recv(c);
assert(fail.type === 'error' && fail.code === 'rejoin_failed', '房間解散後 token 失效');

console.log('\n重連測試全部通過 🎉');
a2.ws.close();
c.ws.close();
server.kill();
process.exit(0);
