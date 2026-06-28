// msn-mine 伺服器：HTTP（serve web/dist）+ WebSocket（房間配對與權威遊戲狀態）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createGame, click, snapshot, unclaimedMines, WIDTH, HEIGHT, MINE_COUNT, WIN_TARGET } from './lib/game.js';

const PORT = process.env.PORT || 3000;
const GRACE_MS = Number(process.env.GRACE_MS || 60000); // 斷線後保留房間的寬限時間
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'web', 'dist');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  // 服務前端建置產物；找不到檔案 fallback 到 index.html
  let file = path.join(DIST, path.normalize(req.url.split('?')[0]).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST) || req.url === '/') file = path.join(DIST, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) {
      fs.readFile(path.join(DIST, 'index.html'), (err2, html) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('Frontend not built. Run: cd web && npm run build');
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

// code -> { code, players: [ws|null, ws|null], names, game, rematch, tokens: [string, string], timers: [Timer|null, Timer|null] }
const rooms = new Map();
// 重連 token -> { room, seat }
const tokens = new Map();

const newToken = () => crypto.randomBytes(16).toString('hex');

function destroyRoom(room) {
  for (const t of room.timers) if (t) clearTimeout(t);
  for (const tk of room.tokens) if (tk) tokens.delete(tk);
  for (const p of room.players) if (p) p.room = null;
  for (const s of room.spectators) { send(s, { type: 'room_closed' }); s.room = null; }
  rooms.delete(room.code);
}

// 觀戰者預設暱稱：隨機菜市場名字（姓 + 名），撞名也無妨——可隨時改
const SURNAMES = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭', '謝', '郭', '洪'];
const GIVEN_NAMES = ['淑芬', '美玲', '雅婷', '怡君', '志明', '家豪', '俊傑', '建宏', '淑惠', '美惠', '雅雯', '宗翰', '冠廷', '心怡', '詩涵', '欣怡', '志偉', '秀英', '麗華', '雅琪'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomMarketName = () => pick(SURNAMES) + pick(GIVEN_NAMES);

// 嗆聲：前端送索引、伺服器只驗證範圍（文字內容在前端 useGame.js 的 TAUNTS，須同步）
const TAUNT_COUNT = 5;
const TAUNT_COOLDOWN_MS = 700; // 防洗版

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉易混淆字元
function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  for (const p of room.players) send(p, msg);
}

// 廣播給玩家 + 觀戰者（盤面更新、終局、人數變動都要全房同步）
function broadcastAll(room, msg) {
  for (const p of room.players) send(p, msg);
  for (const s of room.spectators) send(s, msg);
}

const spectatorNames = (room) => room.spectators.map((s) => s.name);

// 觀戰者進場 / 離場 / 改名時，把最新名單推給全房（玩家會看到「👁 王小明 觀戰中」）
function broadcastSpectatorList(room) {
  broadcastAll(room, { type: 'spectators', names: spectatorNames(room) });
}

// 觀戰者要看的當前局面：跟重連快照同格式，但沒有座位、沒有 token（唯讀）。
// 帶 ws 時附上「你的觀戰暱稱」yourName
function spectateState(room, ws) {
  const g = room.game;
  return {
    type: 'spectate_state',
    started: !!g, // 對局是否已開始（觀戰一個還在等人的房間時為 false）
    names: room.names,
    turn: g ? g.turn : 0,
    scores: g ? g.scores : [0, 0],
    winner: g ? g.winner : null,
    width: WIDTH, height: HEIGHT,
    mineCount: MINE_COUNT, winTarget: WIN_TARGET,
    reveals: g ? snapshot(g) : [],
    remaining: g && g.winner !== null ? unclaimedMines(g) : [],
    yourName: ws ? ws.name : undefined,
    spectatorNames: spectatorNames(room),
  };
}

function addSpectator(ws, room) {
  ws.room = room;
  ws.seat = null;
  ws.isSpectator = true;
  ws.name = randomMarketName(); // 進場先給個菜市場名字，之後可隨時改
  room.spectators.push(ws);
  send(ws, spectateState(room, ws));
  broadcastSpectatorList(room);
}

function startGame(room) {
  room.game = createGame();
  room.rematch = [false, false];
  room.players.forEach((ws, i) => {
    send(ws, {
      type: 'start',
      you: i,
      token: room.tokens[i],
      names: room.names,
      turn: room.game.turn,
      scores: room.game.scores,
      width: WIDTH, height: HEIGHT,
      mineCount: MINE_COUNT, winTarget: WIN_TARGET,
    });
  });
  // 觀戰者也要看到新一局的空盤面
  for (const s of room.spectators) send(s, spectateState(room, s));
}

// Cloudflare 會切斷閒置 100 秒的連線，每 30 秒 ping 一次保活；
// 同時靠 pong 偵測悄悄死掉的連線，及時釋放座位進入重連寬限期
const KEEPALIVE_MS = 30000;
setInterval(() => {
  for (const c of wss.clients) {
    if (c.isAlive === false) {
      c.terminate();
      continue;
    }
    c.isAlive = false;
    c.ping();
  }
}, KEEPALIVE_MS);

wss.on('connection', (ws) => {
  ws.room = null;
  ws.seat = null;
  ws.isSpectator = false;
  ws.lastTaunt = 0;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      const code = newCode();
      const room = {
        code,
        players: [ws, null],
        names: [String(msg.name || '玩家1').slice(0, 12), ''],
        game: null,
        rematch: [false, false],
        tokens: [newToken(), newToken()],
        timers: [null, null],
        spectators: [],
      };
      rooms.set(code, room);
      tokens.set(room.tokens[0], { room, seat: 0 });
      tokens.set(room.tokens[1], { room, seat: 1 });
      ws.room = room;
      ws.seat = 0;
      send(ws, { type: 'created', code, token: room.tokens[0] });
      return;
    }

    if (msg.type === 'join') {
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) return send(ws, { type: 'error', message: '找不到這個房間' });
      if (room.players[1]) return addSpectator(ws, room); // 滿房 → 同一條連結自動轉觀戰
      room.players[1] = ws;
      room.names[1] = String(msg.name || '玩家2').slice(0, 12);
      ws.room = room;
      ws.seat = 1;
      startGame(room);
      return;
    }

    if (msg.type === 'spectate') {
      // 主動觀戰：不管座位空不空都只看不玩
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) return send(ws, { type: 'error', message: '找不到這個房間' });
      return addSpectator(ws, room);
    }

    if (msg.type === 'rejoin') {
      const entry = tokens.get(String(msg.token || ''));
      if (!entry) return send(ws, { type: 'error', code: 'rejoin_failed', message: '房間已結束' });
      const { room, seat } = entry;
      // 踢掉殘留的舊連線（例如重複分頁）
      const old = room.players[seat];
      if (old && old !== ws) {
        old.room = null;
        old.terminate();
      }
      if (room.timers[seat]) {
        clearTimeout(room.timers[seat]);
        room.timers[seat] = null;
      }
      room.players[seat] = ws;
      ws.room = room;
      ws.seat = seat;

      if (!room.game) {
        // 還在等待室就斷線重連：回到等待畫面
        send(ws, { type: 'created', code: room.code, token: room.tokens[seat] });
      } else {
        send(ws, {
          type: 'rejoined',
          you: seat,
          token: room.tokens[seat],
          names: room.names,
          turn: room.game.turn,
          scores: room.game.scores,
          winner: room.game.winner,
          width: WIDTH, height: HEIGHT,
          mineCount: MINE_COUNT, winTarget: WIN_TARGET,
          reveals: snapshot(room.game),
          remaining: room.game.winner !== null ? unclaimedMines(room.game) : [],
          opponentWantsRematch: room.rematch[1 - seat],
        });
        send(room.players[1 - seat], { type: 'opponent_reconnected' });
      }
      return;
    }

    if (msg.type === 'rename') {
      // 玩家或觀戰者隨時改名（等待室、對局中皆可）
      const room = ws.room;
      if (!room) return;
      const name = String(msg.name || '').slice(0, 12).trim();
      if (!name) return;
      if (ws.isSpectator) {
        ws.name = name;
        broadcastSpectatorList(room);
      } else if (ws.seat === 0 || ws.seat === 1) {
        room.names[ws.seat] = name;
        broadcastAll(room, { type: 'player_renamed', seat: ws.seat, name });
      }
      return;
    }

    if (msg.type === 'taunt') {
      // 玩家或觀戰者嗆聲：伺服器只驗證索引範圍，附上發言者名字後廣播
      const room = ws.room;
      if (!room) return;
      const i = msg.i | 0;
      if (i < 0 || i >= TAUNT_COUNT) return;
      const now = Date.now();
      if (now - (ws.lastTaunt || 0) < TAUNT_COOLDOWN_MS) return; // 冷卻中
      ws.lastTaunt = now;
      const name = ws.isSpectator ? ws.name : room.names[ws.seat];
      broadcastAll(room, { type: 'taunt', i, name, spectator: !!ws.isSpectator });
      return;
    }

    const room = ws.room;
    if (!room || !room.game) return;
    if (ws.isSpectator) return; // 觀戰者唯讀：忽略 click / rematch

    if (msg.type === 'click') {
      const result = click(room.game, ws.seat, msg.x | 0, msg.y | 0);
      if (!result) return;
      broadcastAll(room, { type: 'update', by: ws.seat, ...result });
      if (result.winner !== null) {
        broadcastAll(room, {
          type: 'gameover',
          winner: result.winner,
          scores: result.scores,
          remaining: unclaimedMines(room.game),
        });
      }
      return;
    }

    if (msg.type === 'rematch') {
      if (room.game.winner === null) return;
      room.rematch[ws.seat] = true;
      if (room.rematch[0] && room.rematch[1]) {
        startGame(room);
      } else {
        send(room.players[1 - ws.seat], { type: 'rematch_request' });
      }
      return;
    }
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    if (ws.isSpectator) {
      const i = room.spectators.indexOf(ws);
      if (i !== -1) room.spectators.splice(i, 1);
      broadcastSpectatorList(room);
      return; // 觀戰者離場只更新名單，不動房間
    }
    if (room.players[ws.seat] !== ws) return; // 已被重連的新連線取代
    room.players[ws.seat] = null;
    send(room.players[1 - ws.seat], { type: 'opponent_disconnected', graceMs: GRACE_MS });
    // 寬限期內等重連，逾時才解散房間
    room.timers[ws.seat] = setTimeout(() => {
      send(room.players[1 - ws.seat], { type: 'opponent_left' });
      destroyRoom(room);
    }, GRACE_MS);
  });
});

server.listen(PORT, () => {
  console.log(`msn-mine server listening on http://localhost:${PORT}`);
});
