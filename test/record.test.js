import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, click, snapshot, unclaimedMines, STANDARD, PRESETS } from '../lib/game.js';
import { buildGameRecord, replayBoard } from '../lib/record.js';

function seededRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

// 把一局打到分出勝負，同時記下事件流（模擬 server 的記錄方式）
function playAndRecord(config, seed) {
  const game = createGame(config, seededRng(seed));
  const moves = [];
  let turn = 0;
  let guard = 0;
  while (game.winner === null && guard++ < 2000) {
    // 找下一個未翻開的格，由當前回合玩家點
    let target = null;
    for (let y = 0; y < game.height && !target; y++) {
      for (let x = 0; x < game.width && !target; x++) {
        if (!game.cells[y * game.width + x].revealed) target = { x, y };
      }
    }
    const r = click(game, turn, target.x, target.y);
    if (!r) break;
    moves.push({ by: turn, x: target.x, y: target.y, reveals: r.reveals, scores: r.scores, turn: r.turn, winner: r.winner });
    turn = r.turn;
  }
  return { game, moves };
}

function expectedBoard(game) {
  const b = Array.from({ length: game.height }, () => Array(game.width).fill(null));
  for (const r of snapshot(game)) b[r.y][r.x] = r.mine ? { mine: true, owner: r.owner } : { mine: false, adj: r.adj };
  for (const r of unclaimedMines(game)) b[r.y][r.x] = { mine: true, owner: null };
  return b;
}

test('事件流可重播出與實局完全一致的最終盤面與比分（標準場）', () => {
  const { game, moves } = playAndRecord(STANDARD, 123);
  assert.notEqual(game.winner, null, '對局應分出勝負');

  const record = buildGameRecord({
    code: 'TEST', config: STANDARD, names: ['A', 'B'], styles: [{}, {}],
    moves, winner: game.winner, scores: game.scores,
    remaining: unclaimedMines(game), startedAt: 0, endedAt: 1,
  });

  const rep = replayBoard(record);
  assert.deepEqual(rep.board, expectedBoard(game), '重播盤面需與實局一致');
  assert.deepEqual(rep.scores, game.scores, '重播比分需一致');
  assert.equal(rep.winner, game.winner);
});

test('事件流可逐步重播（小場）：播到一半的盤面只含前段揭露', () => {
  const { game, moves } = playAndRecord(PRESETS.small, 77);
  const record = buildGameRecord({
    code: 'T2', config: PRESETS.small, names: ['A', 'B'], styles: [{}, {}],
    moves, winner: game.winner, scores: game.scores,
    remaining: unclaimedMines(game), startedAt: 0, endedAt: 1,
  });

  const half = Math.floor(moves.length / 2);
  const mid = replayBoard(record, half);
  // 前 half 手揭露的格數 = 盤面上非 null 的格數
  const revealedInMid = mid.board.flat().filter(Boolean).length;
  let expectCount = 0;
  for (let i = 0; i < half; i++) expectCount += 0; // 由 reveals 累計
  const seen = new Set();
  for (let i = 0; i < half; i++) for (const r of moves[i].reveals) seen.add(`${r.x},${r.y}`);
  assert.equal(revealedInMid, seen.size, '播到一半的揭露格數需吻合前段事件');
  assert.ok(revealedInMid < record.width * record.height, '中途盤面不應全開');
});
