// 對局事件流：把每一手記下來，並能從事件流「重播」出盤面。
// 這是對局紀錄 / Replays / 即時 log 三者共用的核心資料格式。
// 注意：事件本身就帶 reveals（含搶到雷的 owner），所以重播完全不需要原始雷盤，
// 也不依賴 game.js 的版本——存什麼就能播什麼。

// 組裝一局完整紀錄（持久化、replay 都吃這個物件）。
// bot：若為人機局，傳入該局所用 AI 的描述（{id,version,label}），會掛在 players[1] 並標 vsBot。
export function buildGameRecord({ code, config, names, styles, moves, winner, scores, remaining, startedAt, endedAt, bot = null }) {
  const players = [
    { name: names[0], style: styles[0] },
    { name: names[1], style: styles[1] },
  ];
  if (bot) players[1].bot = { id: bot.id, version: bot.version, label: bot.label };
  return {
    code,
    preset: config.key,
    width: config.width,
    height: config.height,
    mineCount: config.mineCount,
    winTarget: config.winTarget,
    vsBot: !!bot, // 人機局標記（方便日後排行榜排除）
    players,
    moves, // [{ by, x, y, reveals, scores, turn }]，依發生順序
    winner,
    finalScores: scores,
    remaining, // 終局未被搶到的雷（owner: null）
    startedAt,
    endedAt,
  };
}

// 空盤面（board[y][x] = null | { mine, owner } | { mine:false, adj }）
function emptyBoard(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(null));
}

// 套用一手的 reveals 到盤面（replay 逐步播放用）
export function applyReveals(board, reveals) {
  for (const r of reveals) {
    board[r.y][r.x] = r.mine ? { mine: true, owner: r.owner } : { mine: false, adj: r.adj };
  }
  return board;
}

// 從事件流重播出「到第 upto 手為止」的盤面與比分（upto 省略＝整局）
export function replayBoard(record, upto = Infinity) {
  const board = emptyBoard(record.width, record.height);
  const n = Math.min(upto, record.moves.length);
  let scores = [0, 0];
  let winner = null;
  for (let k = 0; k < n; k++) {
    const m = record.moves[k];
    applyReveals(board, m.reveals);
    scores = m.scores;
    winner = m.winner ?? winner;
  }
  // 播到終局才揭露未搶到的雷
  if (n >= record.moves.length) {
    for (const r of record.remaining || []) board[r.y][r.x] = { mine: true, owner: null };
    winner = record.winner;
    scores = record.finalScores;
  }
  return { board, scores, winner };
}
