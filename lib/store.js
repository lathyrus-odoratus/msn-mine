// 對局紀錄持久化（Postgres）。設計原則：可選 —— 沒有 DATABASE_URL 或連不上時
// 自動降級成「不持久化」，遊戲照常運作（本機開發與測試不需要 pg）。
import pg from 'pg';

let pool = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS games (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT NOT NULL,
  preset       TEXT NOT NULL,
  width        INT NOT NULL,
  height       INT NOT NULL,
  mine_count   INT NOT NULL,
  win_target   INT NOT NULL,
  winner       INT,
  player0_name TEXT,
  player1_name TEXT,
  final_scores INT[] NOT NULL,
  move_count   INT NOT NULL,
  record       JSONB NOT NULL,
  started_at   TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS games_created_idx ON games (created_at DESC);
-- 人機局標記（冪等，對既有表安全）
ALTER TABLE games ADD COLUMN IF NOT EXISTS vs_bot      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE games ADD COLUMN IF NOT EXISTS bot_id      TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS bot_version INT;
`;

export function hasStore() {
  return pool !== null;
}

// 啟動時呼叫。pg 容器可能比 app 晚就緒，故帶重試；最終失敗就回傳 false 走記憶體模式。
export async function initStore() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('[store] 無 DATABASE_URL，對局紀錄不持久化（記憶體模式）');
    return false;
  }
  const p = new pg.Pool({ connectionString: url, max: 4 });
  for (let i = 0; i < 12; i++) {
    try {
      await p.query(SCHEMA);
      pool = p;
      console.log('[store] Postgres 就緒，schema 已確保');
      return true;
    } catch (e) {
      console.log(`[store] 等待 Postgres…(${i + 1}/12) ${e.code || e.message}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  console.warn('[store] Postgres 連不上，改用記憶體模式（不持久化）');
  await p.end().catch(() => {});
  return false;
}

// 寫入一局（fire-and-forget；失敗只記 log，不影響遊戲流程）
export async function saveGame(record) {
  if (!pool) return;
  const bot = record.players[1]?.bot || null;
  try {
    await pool.query(
      `INSERT INTO games
        (code, preset, width, height, mine_count, win_target, winner,
         player0_name, player1_name, final_scores, move_count, record, started_at, ended_at,
         vs_bot, bot_id, bot_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
               to_timestamp($13/1000.0), to_timestamp($14/1000.0), $15, $16, $17)`,
      [
        record.code, record.preset, record.width, record.height,
        record.mineCount, record.winTarget, record.winner,
        record.players[0].name, record.players[1].name, record.finalScores,
        record.moves.length, JSON.stringify(record), record.startedAt, record.endedAt,
        !!record.vsBot, bot?.id ?? null, bot?.version ?? null,
      ],
    );
  } catch (e) {
    console.error('[store] 寫入失敗：', e.message);
  }
}

// 最近對局清單（給 replay 列表用，不含 moves）
export async function listGames(limit = 30) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, code, preset, width, height, win_target, winner,
            player0_name, player1_name, final_scores, move_count, ended_at, vs_bot
     FROM games ORDER BY created_at DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 30, 1), 100)],
  );
  return rows;
}

// 單局完整紀錄（含 moves，給 replay 播放）
export async function getGame(id) {
  if (!pool) return null;
  const { rows } = await pool.query('SELECT record FROM games WHERE id = $1', [id]);
  return rows[0]?.record ?? null;
}
