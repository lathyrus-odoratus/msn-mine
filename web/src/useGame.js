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
  opponentOffline: false, // 對手暫時斷線（寬限期內）
  opponentWantsRematch: false,
  rematchSent: false,
  reconnecting: false,
});

let ws = null;
let intentionalClose = false;

// token 存 sessionStorage：刷新分頁不丟，且兩個分頁互不干擾（方便本機測試）
const TOKEN_KEY = 'mine-token';
const saveToken = (t) => sessionStorage.setItem(TOKEN_KEY, t);
const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function ensureConnected() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) return resolve();
    intentionalClose = false;
    ws = new WebSocket(wsUrl());
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('連線失敗'));
    ws.onmessage = (ev) => handleMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      ws = null;
      if (intentionalClose) return;
      // 遊戲中意外斷線 → 自動嘗試重連
      if (state.phase !== 'lobby') attemptRejoin();
    };
  });
}

function emptyBoard() {
  return Array.from({ length: state.height }, () => Array.from({ length: state.width }, () => null));
}

function applyMeta(msg) {
  state.you = msg.you;
  state.names = msg.names;
  state.turn = msg.turn;
  state.scores = [...msg.scores];
  state.width = msg.width;
  state.height = msg.height;
  state.mineCount = msg.mineCount;
  state.winTarget = msg.winTarget;
  if (msg.token) saveToken(msg.token);
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'created':
      state.code = msg.code;
      if (msg.token) saveToken(msg.token);
      state.reconnecting = false;
      state.phase = 'waiting';
      break;
    case 'start':
      applyMeta(msg);
      state.board = emptyBoard();
      state.winner = null;
      state.lastMove = null;
      state.opponentLeft = false;
      state.opponentOffline = false;
      state.opponentWantsRematch = false;
      state.rematchSent = false;
      state.reconnecting = false;
      state.error = '';
      state.notice = '';
      state.phase = 'playing';
      break;
    case 'rejoined': {
      applyMeta(msg);
      state.board = emptyBoard();
      for (const r of msg.reveals) {
        state.board[r.y][r.x] = r.mine ? { mine: true, owner: r.owner } : { mine: false, adj: r.adj };
      }
      for (const r of msg.remaining) {
        state.board[r.y][r.x] = { mine: true, owner: null };
      }
      state.winner = msg.winner;
      state.opponentWantsRematch = !!msg.opponentWantsRematch;
      state.rematchSent = false;
      state.opponentLeft = false;
      state.reconnecting = false;
      state.error = '';
      state.notice = '';
      state.phase = msg.winner !== null ? 'over' : 'playing';
      break;
    }
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
    case 'opponent_disconnected':
      state.opponentOffline = true;
      break;
    case 'opponent_reconnected':
      state.opponentOffline = false;
      break;
    case 'opponent_left':
      state.opponentLeft = true;
      state.opponentOffline = false;
      state.notice = '對手已離開房間';
      clearToken();
      if (state.phase === 'playing') state.phase = 'over';
      break;
    case 'error':
      if (msg.code === 'rejoin_failed') {
        clearToken();
        state.reconnecting = false;
        if (state.phase !== 'lobby') {
          state.phase = 'lobby';
          state.error = msg.message;
        }
      } else {
        state.error = msg.message;
      }
      break;
  }
}

// 斷線重連：每 1.5 秒試一次，最多 20 次（涵蓋伺服器 60 秒寬限期的大半）
async function attemptRejoin() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token || state.reconnecting) return;
  state.reconnecting = true;
  for (let i = 0; i < 20 && state.reconnecting; i++) {
    try {
      await ensureConnected();
      ws.send(JSON.stringify({ type: 'rejoin', token }));
      return; // 等伺服器回 rejoined / created / error
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (state.reconnecting) {
    state.reconnecting = false;
    state.error = '無法重新連線';
    state.phase = 'lobby';
  }
}

// 頁面載入時：若有上一局的 token 就嘗試回到房間
export function resumeIfPossible() {
  if (sessionStorage.getItem(TOKEN_KEY)) attemptRejoin();
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
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (state.phase !== 'playing' || state.turn !== state.you) return;
  if (state.board[y][x] !== null) return;
  ws.send(JSON.stringify({ type: 'click', x, y }));
}

export function requestRematch() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  state.rematchSent = true;
  ws.send(JSON.stringify({ type: 'rematch' }));
}

export function backToLobby() {
  intentionalClose = true;
  clearToken();
  if (ws) {
    ws.close();
    ws = null;
  }
  state.phase = 'lobby';
  state.error = '';
  state.notice = '';
  state.code = '';
  state.opponentLeft = false;
  state.opponentOffline = false;
  state.reconnecting = false;
}
