<script setup>
// 探雷模式（Mine Runner）原型 — 純前端本地雙人 hot-seat。
// 精簡模型「走過就插」：移動是唯一的建構動作，角色走過的每一格 = 一面旗（蓋著）；
// 排好路線→（可選）按引爆→執行：角色逐格跑、沿路插旗，最後一次掀開所有旗。
// 命中雷退時間，執行完依時間軸判斷下一個是誰（連莊）。規格見 docs/explore-mode.md。
import { reactive, ref, computed, onMounted, onUnmounted } from 'vue';
import { navigate } from '../router.js';
import { playStep, playClaimSelf, playReveal, playWin, playStart } from '../sound.js';

const CONFIG = {
  W: 12, H: 12, MINES: 30,        // 盤面與雷數
  WIN: 16,                        // 先搶幾顆雷獲勝（過半）
  CAP: 8,                         // 每回合最多插幾面新旗（＝行動上限）
  COST_REVEAL_ALL: 1,             // 引爆固定成本
  REVEAL_MINE_REFUND: 1,          // 命中雷退還的時間（連莊）
  RANGE: 2,                       // 看對手旗子的基礎視野（Chebyshev）
  EXPOSE_LEAD: 3,                 // 領先每 N 顆雷，你的旗被對手看見的半徑 +1
  WALK_MS: 110, STEP_MS: 280,     // 執行動畫節奏
  CELL_MIN: 40, CELL_MAX: 96,     // 格子大小上下限
  VIEW_MAX: 1024, VIEW_RATIO: 0.66, VIEW_MARGIN: 48, // RWD 可視窗
};
const NUM_COLORS = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];
const WIDTHS = [480, 720, 1024, 1280];
const COLORS = ['#1d5fd6', '#d62a2a'];
const NAMES = ['玩家 1', '玩家 2'];

const cells = reactive([]);       // { mine, adj, revealed, owner, mark:[bool,bool] }
const players = reactive([]);     // { x, y, score, time }
const active = ref(0);
const path = reactive([]);        // 這回合規劃的逐格路線 [{x,y}…]（每格相鄰）
const armed = ref(false);         // 是否已排「引爆」
const executing = ref(false);
const confirming = ref(false);
const message = ref('');
const winner = ref(null);
const showRulers = ref(false);
const winW = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);
let lastActive = null;

const idx = (x, y) => y * CONFIG.W + x;
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// RWD：盤面填滿可用寬度（上限 VIEW_MAX）→ 反推格子大小
const cellPx = computed(() => {
  const target = Math.min(CONFIG.VIEW_MAX, winW.value - CONFIG.VIEW_MARGIN);
  return Math.max(CONFIG.CELL_MIN, Math.min(CONFIG.CELL_MAX, Math.floor(target / CONFIG.W)));
});
const viewW = computed(() => CONFIG.W * cellPx.value);
const viewH = computed(() => Math.round(viewW.value * CONFIG.VIEW_RATIO));
const charW = computed(() => Math.round(cellPx.value * 0.93)); // 角色 1.5×
const charH = computed(() => Math.round(charW.value * 30 / 24));

const meChar = () => players[active.value] || { x: 0, y: 0 };
// 可插旗：尚未翻開、且還不是自己的旗
const flaggable = (x, y) => { const c = cells[idx(x, y)]; return c && !c.revealed && !c.mark[active.value]; };
// 規劃路線會新增的旗（去重）
const plannedFlags = computed(() => {
  const s = new Set();
  for (const c of path) if (c.flag && flaggable(c.x, c.y)) s.add(idx(c.x, c.y));
  return s;
});
// 路線上只穿過、不插旗的格（Shift 走出來的）
const travelSet = computed(() => {
  const s = new Set();
  for (const c of path) { const i = idx(c.x, c.y); if (!plannedFlags.value.has(i)) s.add(i); }
  return s;
});
// 已落實、尚未引爆的旗（前幾回合走過插的）
const persistentFlags = computed(() => {
  let n = 0;
  for (const c of cells) if (c.mark[active.value]) n++;
  return n;
});
const used = computed(() => plannedFlags.value.size + (armed.value ? CONFIG.COST_REVEAL_ALL : 0));
const remaining = computed(() => CONFIG.CAP - used.value);
const projPos = computed(() => (path.length ? path[path.length - 1] : meChar()));
// 攝影機焦點：執行時跟真實角色、編排時跟投影終點
const camTarget = computed(() => (executing.value ? meChar() : projPos.value));
const boardStyle = computed(() => {
  const t = camTarget.value, cx = (t.x + 0.5) * cellPx.value, cy = (t.y + 0.5) * cellPx.value;
  return {
    '--cell': cellPx.value + 'px',
    gridTemplateColumns: `repeat(${CONFIG.W}, ${cellPx.value}px)`,
    left: `calc(50% - ${cx}px)`, top: `calc(50% - ${cy}px)`,
    transformOrigin: `${cx}px ${cy}px`,
  };
});
function visRadiusFor(o) {
  const lead = players[o].score - players[1 - o].score;
  return CONFIG.RANGE + Math.max(0, Math.floor(lead / CONFIG.EXPOSE_LEAD));
}

function newGame() {
  cells.length = 0;
  const N = CONFIG.W * CONFIG.H;
  for (let i = 0; i < N; i++) cells.push({ mine: false, adj: 0, revealed: false, owner: null, mark: [false, false] });
  const order = [...Array(N).keys()];
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const i of order.slice(0, CONFIG.MINES)) cells[i].mine = true;
  for (let y = 0; y < CONFIG.H; y++) for (let x = 0; x < CONFIG.W; x++) {
    if (cells[idx(x, y)].mine) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && nx < CONFIG.W && ny >= 0 && ny < CONFIG.H && cells[idx(nx, ny)].mine) n++;
    }
    cells[idx(x, y)].adj = n;
  }
  players.length = 0;
  players.push({ x: 1, y: 1, score: 0, time: 0 });
  players.push({ x: CONFIG.W - 2, y: CONFIG.H - 2, score: 0, time: 0 });
  active.value = 0; lastActive = null; path.length = 0; armed.value = false;
  executing.value = false; confirming.value = false; message.value = ''; winner.value = null;
  playStart();
}

// ---- 編排：走一步＝路線多一格（走過的格將被插旗） ----
function stepTo(x, y, doFlag) {
  if (winner.value !== null || executing.value || armed.value) return false;
  const pp = projPos.value;
  if (x < 0 || x >= CONFIG.W || y < 0 || y >= CONFIG.H) return false;
  if (cheb(pp.x, pp.y, x, y) !== 1) return false; // 只能走到相鄰格
  const isNewFlag = doFlag && flaggable(x, y) && !plannedFlags.value.has(idx(x, y));
  if (isNewFlag && remaining.value < 1) { message.value = '插旗上限已滿（按 Shift 穿過、或先引爆）'; return false; }
  path.push({ x, y, flag: doFlag });
  message.value = '';
  return true;
}
function keyMove(dx, dy, shift) {
  if (winner.value !== null || executing.value) return;
  if (armed.value) { message.value = '已排引爆，按退一步解除'; return; }
  confirming.value = false;
  const pp = projPos.value, tx = pp.x + dx, ty = pp.y + dy;
  const prev = path.length >= 2 ? path[path.length - 2] : meChar();
  if (path.length && tx === prev.x && ty === prev.y) { path.pop(); message.value = ''; return; } // 走回上一格＝收回
  stepTo(tx, ty, !shift); // 按住 Shift＝只穿過不插旗
}
// 點一格 → 沿直線逐格走過去（Shift+點＝穿過不插旗），預算用完就停
function clickCell(x, y, ev) {
  if (winner.value !== null || executing.value) return;
  if (armed.value) { message.value = '已排引爆，按退一步解除'; return; }
  confirming.value = false;
  const doFlag = !(ev && ev.shiftKey);
  let pp = projPos.value, guard = 0;
  while ((pp.x !== x || pp.y !== y) && guard++ < 200) {
    if (!stepTo(pp.x + sign(x - pp.x), pp.y + sign(y - pp.y), doFlag)) break;
    pp = projPos.value;
  }
}
function armReveal() {
  if (executing.value || armed.value) return;
  confirming.value = false;
  if (plannedFlags.value.size + persistentFlags.value < 1) { message.value = '還沒有旗子可引爆'; return; }
  if (remaining.value < CONFIG.COST_REVEAL_ALL) { message.value = '行動上限不足'; return; }
  armed.value = true; message.value = '';
}
function undo() {
  if (executing.value) return;
  confirming.value = false;
  if (armed.value) armed.value = false;
  else path.pop();
}
function clearPlan() { if (!executing.value) { confirming.value = false; path.length = 0; armed.value = false; } }

// ---- 執行 ----
function detonate() {
  const p = players[active.value];
  p.time += CONFIG.COST_REVEAL_ALL;
  let total = 0, mines = 0;
  for (const c of cells) {
    if (!c.mark[active.value]) continue;
    total++;
    if (c.revealed) { c.mark[active.value] = false; continue; }
    c.revealed = true; c.mark[active.value] = false;
    if (c.mine) {
      c.owner = active.value; p.score++; mines++;
      p.time -= CONFIG.REVEAL_MINE_REFUND;
      if (p.score >= CONFIG.WIN) winner.value = active.value;
    }
  }
  message.value = `💥 引爆 ${total} 旗 → 命中 ${mines} 顆雷`;
  if (winner.value !== null) playWin();
  else if (mines > 0) playClaimSelf();
  else if (total > 0) playReveal();
}
function requestExecute() {
  if (executing.value || winner.value !== null || (!path.length && !armed.value)) return;
  confirming.value = true;
}
function cancelExecute() { confirming.value = false; }
const planSummary = computed(() => {
  const parts = [];
  if (plannedFlags.value.size) parts.push(`插 ${plannedFlags.value.size} 旗`);
  if (armed.value) parts.push(`引爆 ${plannedFlags.value.size + persistentFlags.value} 旗`);
  return parts.join('・') || '無動作';
});
async function execute() {
  confirming.value = false;
  if (executing.value || winner.value !== null || (!path.length && !armed.value)) return;
  executing.value = true; message.value = '';
  const p = players[active.value];
  for (const c of path) {
    p.x = c.x; p.y = c.y;
    if (c.flag && flaggable(c.x, c.y)) { cells[idx(c.x, c.y)].mark[active.value] = true; p.time += 1; } // 走過就插（Shift 穿過則否）
    playStep();
    await sleep(CONFIG.WALK_MS);
  }
  if (armed.value && winner.value === null) { await sleep(CONFIG.STEP_MS); detonate(); }
  path.length = 0; armed.value = false; executing.value = false;
  if (winner.value === null) endTurn();
}
function endTurn() {
  lastActive = active.value;
  const [t0, t1] = [players[0].time, players[1].time];
  active.value = t0 === t1 ? (lastActive === 0 ? 1 : 0) : (t0 < t1 ? 0 : 1);
}
function yieldTurn() {
  if (executing.value) return;
  confirming.value = false; path.length = 0; armed.value = false;
  players[active.value].time = Math.max(players[active.value].time, players[1 - active.value].time + 1);
  endTurn();
}

function onKey(e) {
  const KEYMAP = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const m = KEYMAP[e.key];
  if (m) { e.preventDefault(); keyMove(m[0], m[1], e.shiftKey); return; }
  const k = e.key.toLowerCase();
  if (k === 'r') { e.preventDefault(); armReveal(); }
  else if (k === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'Enter') { e.preventDefault(); confirming.value ? execute() : requestExecute(); }
}
const onResize = () => { winW.value = window.innerWidth; };
onMounted(() => { newGame(); window.addEventListener('keydown', onKey); window.addEventListener('resize', onResize); });
onUnmounted(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); });

// ---- 渲染輔助 ----
const tokenAt = computed(() => {
  const arr = new Array(CONFIG.W * CONFIG.H).fill(-1);
  players.forEach((p, i) => { arr[idx(p.x, p.y)] = i; });
  return arr;
});
const ghostIdx = computed(() => {
  if (executing.value || !path.length) return -1;
  return idx(projPos.value.x, projPos.value.y);
});
function showOppFlag(x, y) {
  const o = 1 - active.value;
  if (!cells[idx(x, y)].mark[o]) return false;
  return cheb(meChar().x, meChar().y, x, y) <= visRadiusFor(o);
}
</script>

<template>
  <div class="runner">
    <div class="runner-bar">
      <button class="link-btn" @click="navigate('/')">← 回大廳</button>
      <strong>🧪 探雷模式原型</strong>
      <span class="bar-right">
        <button class="link-btn" :class="{ on: showRulers }" @click="showRulers = !showRulers">📐 尺規</button>
        <button class="link-btn" @click="newGame">🔄 重開</button>
      </span>
    </div>

    <div class="runner-hud">
      <span v-for="(p, i) in players" :key="i" class="hud-player" :class="{ turn: active === i && winner === null }"
            :style="{ '--c': COLORS[i] }">
        <b>{{ NAMES[i] }}</b> 雷 {{ p.score }}/{{ CONFIG.WIN }} ・ 時間 {{ p.time }}
      </span>
    </div>

    <div class="timetrack">
      <span class="tt-label">時間軸</span>
      <div class="tt-rail">
        <span v-for="(p, i) in players" :key="i" class="tt-mark" :style="{ left: Math.min(100, p.time * 5) + '%', '--c': COLORS[i] }">▼</span>
      </div>
    </div>

    <div v-if="winner !== null" class="runner-over" :style="{ '--c': COLORS[winner] }">
      🏆 {{ NAMES[winner] }} 獲勝！<button @click="newGame">再來一局</button>
    </div>
    <template v-else>
      <div class="runner-turn">
        輪到 <b :style="{ color: COLORS[active] }">{{ NAMES[active] }}</b>
        ・剩 <b>{{ remaining }}</b>/{{ CONFIG.CAP }} 旗
        <span class="msg" v-if="message">{{ message }}</span>
        <span class="msg exec" v-else-if="executing">執行中…</span>
      </div>

      <div class="ctrl-bar" v-if="!confirming">
        <button class="boom" :disabled="executing || armed || (plannedFlags.size + persistentFlags < 1) || remaining < CONFIG.COST_REVEAL_ALL"
                @click="armReveal">💥 引爆 (R)</button>
        <button class="exec-btn" :disabled="executing || (!path.length && !armed)" @click="requestExecute">▶ 執行 (Enter)</button>
        <button class="link-btn" :disabled="executing || (!path.length && !armed)" @click="undo">↩ 退一步 (Z)</button>
        <button class="link-btn" :disabled="executing || (!path.length && !armed)" @click="clearPlan">✕ 清空</button>
        <button class="link-btn" :disabled="executing" @click="yieldTurn">↦ 跳過</button>
      </div>
      <div class="ctrl-bar confirm" v-else>
        <span class="confirm-summary">預覽：{{ planSummary }}</span>
        <button class="exec-btn" @click="execute">✅ 確認執行 (Enter)</button>
        <button class="link-btn" @click="cancelExecute">✕ 取消</button>
      </div>
    </template>

    <div class="viewport" :style="{ width: viewW + 'px', height: viewH + 'px' }">
      <div class="board" :style="boardStyle">
        <template v-for="(c, i) in cells" :key="i">
          <div class="cell" :class="{ revealed: c.revealed }"
               @click="clickCell(i % CONFIG.W, Math.floor(i / CONFIG.W), $event)">
            <span v-if="c.revealed && c.mine" class="mine" :style="{ background: COLORS[c.owner] }"></span>
            <span v-else-if="c.revealed" class="num" :style="{ color: NUM_COLORS[c.adj] }">{{ c.adj || '' }}</span>
            <span v-else-if="c.mark[active]" class="flag" :class="{ armed }" :style="{ color: COLORS[active] }">🚩</span>
            <span v-else-if="showOppFlag(i % CONFIG.W, Math.floor(i / CONFIG.W))" class="flag oppflag"
                  :style="{ color: COLORS[1 - active] }">🚩</span>
            <!-- 規劃路線會插的旗（蓋著）：虛線旗 -->
            <span v-if="!c.revealed && plannedFlags.has(i) && !c.mark[active]"
                  class="flag planned" :class="{ armed }" :style="{ color: COLORS[active] }">⚐</span>
            <!-- 只穿過、不插旗的格：腳印點 -->
            <span v-if="!c.revealed && travelSet.has(i) && !c.mark[active]" class="footprint">·</span>
            <span v-if="ghostIdx === i" class="ghost" :style="{ color: COLORS[active] }">◌</span>
            <template v-if="tokenAt[i] !== -1">
              <span class="ground"></span>
              <span class="char" :class="{ active: tokenAt[i] === active && !executing }" :style="{ color: COLORS[tokenAt[i]] }">
                <svg viewBox="0 0 24 30" :width="charW" :height="charH">
                  <rect x="8.6" y="23.5" width="2.4" height="5.5" rx="1.2" fill="currentColor" />
                  <rect x="13" y="23.5" width="2.4" height="5.5" rx="1.2" fill="currentColor" />
                  <ellipse cx="12" cy="20" rx="5.6" ry="6" fill="currentColor" />
                  <circle cx="12" cy="10.5" r="6" fill="currentColor" />
                  <path d="M6 10.5 a6 6 0 0 1 12 0 Z" fill="rgba(0,0,0,.24)" />
                  <circle cx="12" cy="6" r="1.15" fill="#ffe27a" />
                  <circle cx="9.8" cy="12.1" r="1.5" fill="#fff" />
                  <circle cx="14.2" cy="12.1" r="1.5" fill="#fff" />
                  <circle cx="10" cy="12.3" r=".7" fill="#243" />
                  <circle cx="14" cy="12.3" r=".7" fill="#243" />
                </svg>
              </span>
            </template>
          </div>
        </template>
      </div>
    </div>

    <p class="runner-help">
      <b>走過就插</b>：<b>WASD</b> 走（走回上一格＝收回）或<b>點一格</b>沿直線過去，路線每格<b>蓋著插一面旗 ⚐</b>。
      <b>按住 Shift 走／Shift＋點＝只穿過不插旗</b>（顯示腳印 ·），用來繞過不想下注的格子。
      按 <b>💥 引爆 (R)</b> 排定一次掀開所有旗，<b>▶ 執行 (Enter)</b> 逐格跑。命中雷退時間 → 連莊。
    </p>

    <div v-if="showRulers" class="rulers">
      <div v-for="w in WIDTHS" :key="w" class="ruler-box" :style="{ width: w + 'px' }">
        <span class="ruler-label">{{ w }}px</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.runner { display: flex; flex-direction: column; gap: 9px; align-items: center; padding: 8px 4px 16px; }
.runner-bar { display: flex; align-items: center; gap: 14px; width: 100%; justify-content: space-between; max-width: 620px; }
.bar-right { display: flex; gap: 12px; }
.link-btn.on { background: #2a6fd6; color: #fff; border-radius: 4px; padding: 1px 6px; }
.runner-hud { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
.hud-player { font-size: 13px; padding: 3px 8px; border-radius: 5px; border: 1px solid #ccc; border-left: 4px solid var(--c); }
.hud-player.turn { background: #fffbe6; border-color: var(--c); }
.timetrack { display: flex; align-items: center; gap: 8px; width: 100%; max-width: 620px; font-size: 12px; color: #666; }
.tt-label { flex: none; }
.tt-rail { position: relative; flex: 1; height: 14px; background: #eee; border-radius: 7px; }
.tt-mark { position: absolute; transform: translateX(-50%); color: var(--c); font-size: 12px; transition: left .2s; }
.runner-turn { font-size: 14px; }
.runner-turn .msg { margin-left: 10px; color: #b34; }
.runner-turn .msg.exec { color: #2a6fd6; }
.runner-over { font-size: 18px; font-weight: 700; color: var(--c); display: flex; gap: 12px; align-items: center; }
.ctrl-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
.ctrl-bar.confirm { background: #fff7e6; border: 1px solid #f0c674; border-radius: 6px; padding: 5px 10px; }
.confirm-summary { font-size: 13px; color: #8a6d2b; font-weight: 600; }
.boom { padding: 5px 12px; font-size: 13px; background: #ffe9e9; border-color: #e3a; color: #c2185b; font-weight: 600; }
.boom:disabled { background: #eee; color: #aaa; }
.exec-btn { padding: 6px 16px; font-size: 14px; font-weight: 700; background: #2a6fd6; color: #fff; }
.exec-btn:disabled { background: #b9c4d0; }

.viewport {
  position: relative; overflow: hidden; margin-top: 6px;
  perspective: 1200px; border-radius: 8px;
  background: linear-gradient(180deg, #8b97a6 0%, #6f7c8c 100%);
  box-shadow: inset 0 0 30px rgba(0, 0, 0, .25);
}
.board {
  position: absolute; display: grid; gap: 1px; background: #b9c4d0; padding: 1px;
  transform: rotateX(46deg);
  transition: left .18s linear, top .18s linear, transform-origin .18s linear;
}
.cell {
  width: var(--cell); height: var(--cell); background: #cdd7e2; position: relative;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  box-shadow: inset 1px 1px 0 #e6edf4, inset -1px -1px 0 #9fb0c1;
}
.cell.revealed { background: #eef2f6; box-shadow: inset 0 0 0 1px #d4dde6; }
.num { font-size: calc(var(--cell) * 0.46); font-weight: 700; }
.mine { width: 60%; height: 60%; border-radius: 4px; }
.flag { font-size: calc(var(--cell) * 0.68); line-height: 1; }
.flag.planned { opacity: .85; }
.flag.armed { animation: armed-pulse .8s ease-in-out infinite; }
@keyframes armed-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.22); } }
.oppflag { opacity: .85; filter: drop-shadow(0 0 1px #000); }
.ghost { position: absolute; font-size: calc(var(--cell) * 0.5); opacity: .55; }
.footprint { position: absolute; font-size: calc(var(--cell) * 0.7); color: #4a5a6a; opacity: .5; line-height: 0; }
.ground {
  position: absolute; bottom: 5px; left: 50%; width: 60%; height: 7px;
  transform: translateX(-50%); border-radius: 50%;
  background: rgba(0, 0, 0, .3); filter: blur(1px); pointer-events: none;
}
.char {
  position: absolute; left: 50%; bottom: 9px; pointer-events: none;
  transform: translateX(-50%) rotateX(-46deg); transform-origin: bottom center;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, .3));
}
.char svg { display: block; }
.char:not(.active) { opacity: .5; }
.char.active { animation: char-bob 1.1s ease-in-out infinite; }
@keyframes char-bob {
  0%, 100% { transform: translateX(-50%) rotateX(-46deg) translateY(0); }
  50%      { transform: translateX(-50%) rotateX(-46deg) translateY(-2px); }
}
.runner-help { font-size: 12px; color: #777; max-width: 560px; text-align: center; line-height: 1.6; }
.rulers { position: fixed; inset: 0; pointer-events: none; z-index: 50; }
.ruler-box {
  position: absolute; top: 60px; bottom: 20px; left: 50%; transform: translateX(-50%);
  border-left: 1px dashed rgba(214, 42, 42, .55); border-right: 1px dashed rgba(214, 42, 42, .55);
}
.ruler-box .ruler-label {
  position: absolute; top: -18px; right: -2px; font-size: 11px; color: #d62a2a;
  background: rgba(255, 255, 255, .85); padding: 0 3px; border-radius: 3px;
}
</style>
