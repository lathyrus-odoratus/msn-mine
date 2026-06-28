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
assert(typeof spec.yourName === 'string' && spec.yourName.length > 0, '觀戰者拿到預設菜市場名字');
assert(spec.spectatorNames.includes(spec.yourName), '觀戰名單含自己');

// 名單廣播：三方都收到 spectators，名單含 1 人
const cntA = await recv(a);
const cntB = await recv(b);
const cntC = await recv(c);
assert(cntA.type === 'spectators' && cntA.names.length === 1, '玩家 A 收到觀戰名單（1 人）');
assert(cntB.type === 'spectators' && cntB.names.length === 1, '玩家 B 收到觀戰名單（1 人）');
assert(cntC.type === 'spectators' && cntC.names.length === 1, '觀戰者也收到名單');

// 改名：觀戰者改名 → 全房收到更新名單
send(c, { type: 'rename', name: '隔壁老王' });
const rn = await recv(a);
assert(rn.type === 'spectators' && rn.names.includes('隔壁老王'), '觀戰者改名後名單更新');
await recv(b); await recv(c); // 消化同則廣播

// 改名：玩家改名 → 全房收到 player_renamed
send(a, { type: 'rename', name: '艾莉絲' });
const pr = await recv(b);
assert(pr.type === 'player_renamed' && pr.seat === 0 && pr.name === '艾莉絲', '玩家改名廣播 player_renamed');
await recv(a); await recv(c); // 消化同則廣播

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
assert(cnt0.type === 'spectators' && cnt0.names.length === 0, '觀戰者離場後名單清空');

// 主動觀戰：座位還空著（只有 1 人）時送 spectate 也只看不玩
const d = await connect('D');
const e = await connect('E');
send(d, { type: 'create', name: 'Dave' });
const room2 = await recv(d);
send(e, { type: 'spectate', code: room2.code }); // 座位 1 還空著
const spec2 = await recv(e);
assert(spec2.type === 'spectate_state', '座位空著時主動 spectate → 仍是觀戰（不佔座位）');
assert(spec2.started === false, '對局尚未開始時 started=false');
await recv(d); // Dave 收到觀戰人數=1
await recv(e); // 觀戰者 E 自己也收到人數廣播，先消化掉
// 真正的玩家加入後，座位仍由玩家補上、觀戰者看到對局開始
const f = await connect('F');
send(f, { type: 'join', code: room2.code, name: 'Frank' });
const dStart = await recv(d);
assert(dStart.type === 'start' && dStart.you === 0, '空座位仍保留給真正加入的玩家');
await recv(f); // Frank start
const specStart = await recv(e);
assert(specStart.type === 'spectate_state' && specStart.started === true, '觀戰者在對局開始時收到已開局盤面');

console.log('\n觀戰測試全部通過 🎉');
a.ws.close();
b.ws.close();
d.ws.close();
e.ws.close();
f.ws.close();
process.exit(0);
