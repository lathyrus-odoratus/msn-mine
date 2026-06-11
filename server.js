// msn-mine 伺服器：HTTP（serve web/dist）+ WebSocket（房間配對與權威遊戲狀態）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createGame, click, unclaimedMines, WIDTH, HEIGHT, MINE_COUNT, WIN_TARGET } from './lib/game.js';

const PORT = process.env.PORT || 3000;
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

// code -> { code, players: [ws|null, ws|null], names: [string, string], game, rematch: [bool, bool] }
const rooms = new Map();

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

function startGame(room) {
  room.game = createGame();
  room.rematch = [false, false];
  room.players.forEach((ws, i) => {
    send(ws, {
      type: 'start',
      you: i,
      names: room.names,
      turn: room.game.turn,
      scores: room.game.scores,
      width: WIDTH, height: HEIGHT,
      mineCount: MINE_COUNT, winTarget: WIN_TARGET,
    });
  });
}

wss.on('connection', (ws) => {
  ws.room = null;
  ws.seat = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      const code = newCode();
      const room = { code, players: [ws, null], names: [String(msg.name || '玩家1').slice(0, 12), ''], game: null, rematch: [false, false] };
      rooms.set(code, room);
      ws.room = room;
      ws.seat = 0;
      send(ws, { type: 'created', code });
      return;
    }

    if (msg.type === 'join') {
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) return send(ws, { type: 'error', message: '找不到這個房間' });
      if (room.players[1]) return send(ws, { type: 'error', message: '房間已滿' });
      room.players[1] = ws;
      room.names[1] = String(msg.name || '玩家2').slice(0, 12);
      ws.room = room;
      ws.seat = 1;
      startGame(room);
      return;
    }

    const room = ws.room;
    if (!room || !room.game) return;

    if (msg.type === 'click') {
      const result = click(room.game, ws.seat, msg.x | 0, msg.y | 0);
      if (!result) return;
      broadcast(room, { type: 'update', by: ws.seat, ...result });
      if (result.winner !== null) {
        broadcast(room, {
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
    const other = room.players[1 - ws.seat];
    send(other, { type: 'opponent_left' });
    if (other) other.room = null;
    rooms.delete(room.code);
  });
});

server.listen(PORT, () => {
  console.log(`msn-mine server listening on http://localhost:${PORT}`);
});
