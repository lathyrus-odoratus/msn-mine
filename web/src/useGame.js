import { reactive } from 'vue';

// 與伺服器溝通的單一狀態來源
export const state = reactive({
  phase: 'lobby', // lobby | waiting | playing | over
  error: '',
  notice: '',
  code: '',
  you: null, // 0 | 1
  names: ['', ''],
  turn: 0,
  scores: [0, 0],
  winner: null,
  winTarget: 26,
  mineCount: 51,
  width: 16,
  height: 16,
  board: [], // board[y][x] = null（未翻）| { mine, adj?, owner? }
  lastMove: null, // { x, y }
  opponentLeft: false,
  opponentWantsRematch: false,
  rematchSent: false,
});

let ws = null;

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function ensureConnected() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) return resolve();
    ws = new WebSocket(wsUrl());
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('連線失敗'));
    ws.onmessage = (ev) => handleMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      if (state.phase !== 'lobby') {
        state.error = '與伺服器斷線了';
        state.phase = 'lobby';
      }
    };
  });
}

function emptyBoard() {
  return Array.from({ length: state.height }, () => Array.from({ length: state.width }, () => null));
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'created':
      state.code = msg.code;
      state.phase = 'waiting';
      break;
    case 'start':
      state.you = msg.you;
      state.names = msg.names;
      state.turn = msg.turn;
      state.scores = [...msg.scores];
      state.width = msg.width;
      state.height = msg.height;
      state.mineCount = msg.mineCount;
      state.winTarget = msg.winTarget;
      state.board = emptyBoard();
      state.winner = null;
      state.lastMove = null;
      state.opponentLeft = false;
      state.opponentWantsRematch = false;
      state.rematchSent = false;
      state.error = '';
      state.notice = '';
      state.phase = 'playing';
      break;
    case 'update':
      for (const r of msg.reveals) {
        state.board[r.y][r.x] = r.mine ? { mine: true, owner: r.owner } : { mine: false, adj: r.adj };
      }
      if (msg.reveals.length) {
        const r = msg.reveals[0];
        state.lastMove = { x: r.x, y: r.y };
      }
      state.scores = [...msg.scores];
      state.turn = msg.turn;
      break;
    case 'gameover':
      state.winner = msg.winner;
      state.scores = [...msg.scores];
      for (const r of msg.remaining) {
        state.board[r.y][r.x] = { mine: true, owner: null };
      }
      state.phase = 'over';
      break;
    case 'rematch_request':
      state.opponentWantsRematch = true;
      break;
    case 'opponent_left':
      state.opponentLeft = true;
      state.notice = '對手已離開房間';
      if (state.phase === 'playing') state.phase = 'over';
      break;
    case 'error':
      state.error = msg.message;
      break;
  }
}

export async function createRoom(name) {
  state.error = '';
  await ensureConnected();
  ws.send(JSON.stringify({ type: 'create', name }));
}

export async function joinRoom(code, name) {
  state.error = '';
  await ensureConnected();
  ws.send(JSON.stringify({ type: 'join', code, name }));
}

export function clickCell(x, y) {
  if (state.phase !== 'playing' || state.turn !== state.you) return;
  if (state.board[y][x] !== null) return;
  ws.send(JSON.stringify({ type: 'click', x, y }));
}

export function requestRematch() {
  state.rematchSent = true;
  ws.send(JSON.stringify({ type: 'rematch' }));
}

export function backToLobby() {
  if (ws) {
    ws.close();
    ws = null;
  }
  state.phase = 'lobby';
  state.error = '';
  state.notice = '';
  state.code = '';
  state.opponentLeft = false;
}
