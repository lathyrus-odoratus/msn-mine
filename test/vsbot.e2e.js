// 端對端：人機局——立即開打、電腦會回手、可被旁觀
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
function recv(client, timeoutMs = 4000) {
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

// 建人機局 → 立即開打（直接收 start，不經 created/等待室）
send(a, { type: 'create', name: '挑戰者', vsBot: true, botId: 'greedy' });
const start = await recv(a);
assert(start.type === 'start' && start.you === 0, '人機局立即開打（收到 start，座位 0）');
assert(start.names[1] === '🤖 電腦', '對手是電腦');
assert(typeof start.code === 'string' && start.code.length === 4, `start 帶房號 ${start.code}（可分享觀戰）`);

// 人類下棋直到把回合交給電腦，then 電腦應自動回一手（by:1）
const revealed = new Set();
let botMoved = false;
for (let i = 0; i < 300 && !botMoved; i++) {
  let x, y, k, tries = 0;
  do { x = (Math.random() * 16) | 0; y = (Math.random() * 16) | 0; k = `${x},${y}`; tries++; } while (revealed.has(k) && tries < 60);
  if (revealed.has(k)) break;
  send(a, { type: 'click', x, y });
  const u = await recv(a);
  if (u.type !== 'update') continue;
  for (const r of u.reveals) revealed.add(`${r.x},${r.y}`);
  if (u.winner !== null) break;
  if (u.turn === 1) {
    // 換電腦的回合 → 下一則應是電腦下的（by:1）
    const bm = await recv(a);
    assert(bm.type === 'update' && bm.by === 1, '把回合交給電腦後，電腦自動回手（by:1）');
    botMoved = true;
  }
}
assert(botMoved, '對局中電腦確實有下手');

// 人機房可被旁觀（座位 1 是電腦，第三方加入 → 轉觀戰）
const c = await connect('C');
send(c, { type: 'join', code: start.code, name: '路人' });
const spec = await recv(c);
assert(spec.type === 'spectate_state', '加入人機房 → 自動轉觀戰（可旁觀人機對戰）');

console.log('\n人機局測試全部通過 🎉');
a.ws.close();
c.ws.close();
process.exit(0);
