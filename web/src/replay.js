// 前端重播：與 lib/record.js 的 replayBoard 同邏輯（兩處須保持一致）。
// 從事件流套用前 upto 手的 reveals，重建盤面與比分。
function emptyBoard(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(null));
}

export function replayBoard(record, upto = Infinity) {
  const board = emptyBoard(record.width, record.height);
  const n = Math.min(upto, record.moves.length);
  let scores = [0, 0];
  let winner = null;
  for (let k = 0; k < n; k++) {
    const m = record.moves[k];
    for (const r of m.reveals) {
      board[r.y][r.x] = r.mine ? { mine: true, owner: r.owner } : { mine: false, adj: r.adj };
    }
    scores = m.scores;
    winner = m.winner ?? winner;
  }
  if (n >= record.moves.length) {
    for (const r of record.remaining || []) board[r.y][r.x] = { mine: true, owner: null };
    winner = record.winner;
    scores = record.finalScores;
  }
  return { board, scores, winner };
}
