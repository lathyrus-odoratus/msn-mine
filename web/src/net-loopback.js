// 本機 loopback「網路層」：同進程扮演權威伺服器，用共享核心 lib/runner-board.js 仲裁翻牌。
// 介面刻意跟未來的 ws net 一致 → 元件只跟 net 對話，單機/連線可換底層而元件不變。
//
// client → 權威（send）：
//   { t: 'reveal_req', by, x, y }   翻某格
//   { t: 'new_board' }              要一張新盤（authority 生 seed）
// 權威 → client（on 的回呼）：
//   { t: 'board', seed }                                建/換盤（client 用同 seed 建鏡像盤）
//   { t: 'reveal', by, x, y, kind, owner, adj, flooded } 翻牌仲裁結果（唯一真相）
//     kind: 'blocked' | 'reset' | 'mine' | 'zero' | 'number'
import { createBoard, revealCell, pickReset } from '../../lib/runner-board.js';

export function createLoopbackNet({ getCfg }) {
  let board = null;          // 權威盤面（與 client 鏡像盤同 seed）
  let resetIdx = -1;         // 權威重置雷位置（client 不需知道，翻到才回 kind:'reset'）
  const handlers = [];
  const emit = (ev) => { for (const h of handlers) h(ev); };

  function newBoard() {
    const cfg = getCfg();
    const seed = (Math.random() * 0x7fffffff) | 0;
    board = createBoard({ W: cfg.W, H: cfg.H, MINES: cfg.MINES, seed });
    resetIdx = -1;
    emit({ t: 'board', seed });
  }

  function send(msg) {
    if (msg.t === 'new_board') { newBoard(); return; }
    if (msg.t === 'reveal_req') {
      if (!board) return;
      const res = revealCell(board, msg.x, msg.y, msg.by, resetIdx);
      if (res.kind === 'mine' && resetIdx < 0) {
        // 搶到雷後，剩餘雷數達門檻就指派重置雷（權威端，用 Math.random；ws 版改 seeded）
        const r = pickReset(board, getCfg().RESET_TRIGGER, Math.random);
        if (r >= 0) resetIdx = r;
      }
      emit({ t: 'reveal', by: msg.by, x: msg.x, y: msg.y, kind: res.kind, owner: res.owner, adj: res.adj, flooded: res.flooded });
    }
  }

  return {
    localId: 0,                        // 本機玩家＝players[0]
    send,
    on: (cb) => { handlers.push(cb); },
  };
}
