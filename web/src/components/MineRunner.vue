<script setup>
// 探雷模式（Mine Runner）原型 — 即時制・單人 roguelite loop（純前端）。
// 連續移動（按住 WASD，有速度）；站定翻開腳下格（耗能量），即時掀牌：
//   中雷得分＋漸補能量；中數字補 X/10 能量；中 0 → 補滿能量＋移動加速 buff。
// 已翻開的雷＝障礙擋路，朝它蓄力可「跳過」：按 max(4,2n-3) 次起跳、飛 max(1,n/5) 秒。
// 每張圖掃到剩最後幾顆時隨機一顆＝重置雷，翻到換新圖、分數累積，多 loop 過關。
import { reactive, ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { navigate } from '../router.js';
import { playStep, playClaimSelf, playReveal, playWin, playStart, playDeny, playBuff, startBuffLoop, stopBuffLoop } from '../sound.js';

const CONFIG = {
  W: 12, H: 12, MINES: 30,        // 盤面與每張圖雷數
  GOAL: 60,                       // 累積找到幾顆雷過關（跨多張圖 loop）
  RESET_TRIGGER: 8,               // 本圖剩 ≤N 顆雷時，隨機一顆變「重置雷」
  // 移動（buffer 填充式：5 slot，走一步耗 1，回復速率＝穩態走速）
  MOVE_SLOTS: 5,                  // 移動 buffer 槽數（可攢著爆發連走）
  MOVE_REGEN_PER_SEC: 1.8,        // 基礎 slot 回復（＝穩態移動格/秒，已調降）
  MOVE_STEP_MIN: 0.12,            // 爆發每步最小間隔（≈8 格/秒上限）
  MAP_SPEED_GAIN: 0.6,           // 每換一張新地圖，回復速率 +N
  BUFF_MOVE_MULT: 2,              // 翻到 0 的移動加速倍率（作用在回復速率）
  BUFF_SEC: 6,                    // 加速持續秒數
  CAM_LERP: 12,                   // 攝影機跟隨速度
  // 重置雷換圖過場
  RESET_FREEZE_SEC: 10,           // 踩到重置雷後，拉遠俯視＋秀成績的秒數
  RESET_COUNTDOWN_SEC: 3,         // 新地圖開始前的倒數秒數
  // 跳躍
  JUMP_BASE_PRESSES: 4,           // 蓄力按鍵下限：max(BASE, 2n-3)
  JUMP_FLIGHT_MIN_SEC: 0.45,      // 飛行下限秒數：max(MIN, n/DIV)
  JUMP_FLIGHT_DIV: 7,
  JUMP_ARC_RATIO: 1.3,            // 跳躍弧線高度（×格）
  JUMP_ARM_SEC: 0.7,              // 撞障礙後，再按同方向觸發跳躍的緩衝窗（第二次才進 QTE）
  // 能量
  ENERGY_CAP: 3,
  ENERGY_START: 3,
  REVEAL_COST: 1,
  REGEN_PER_SEC: 0.5,
  MINE_REFUND: 1,
  MINE_REFUND_SEC: 1,
  NUM_REFUND_DIV: 10,
  // 後追（雙人才生效，單人預留）
  CATCHUP_GAP: 3,                 // 落後幾顆雷以上觸發後追
  CATCHUP_MOVE_MULT: 1.35,        // 落後者移動速度倍率
  // 視覺
  CELL_MIN: 40, CELL_MAX: 96,
  VIEW_MAX: 1024, VIEW_RATIO: 0.66, VIEW_MARGIN: 48,
};
const NUM_COLORS = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];
const WIDTHS = [480, 720, 1024, 1280];
const COLOR = '#1d5fd6';

const cells = reactive([]);       // { mine, adj, revealed }
const me = reactive({ x: 6, y: 6, score: 0 });
const energy = ref(CONFIG.ENERGY_START);
const elapsed = ref(0);
const loops = ref(1);
const buffUntil = ref(0);
const running = ref(false);
const message = ref('');
const flash = ref(0);
const winner = ref(false);
const showRulers = ref(false);
const winW = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);

const mode = ref('normal');       // 'normal' | 'charging' | 'flying'
const charge = reactive({ dir: [0, 0], n: 0, need: 0, count: 0, landX: 0, landY: 0 });
const flight = reactive({ active: false, fromX: 0, fromY: 0, toX: 0, toY: 0, n: 0, dur: 1, t: 0 });
const squat = ref(false);
const ringKey = ref(0);
const camX = ref(6), camY = ref(6);
const faceDir = ref(1);           // 角色面向：1 右、-1 左
const isMoving = ref(false);
const armHint = ref('');          // 撞障礙緩衝提示（顯示方向箭頭，再按一次跳）
const baseRegen = ref(CONFIG.MOVE_REGEN_PER_SEC); // 基礎 slot 回復速率，每換圖增加
const phase = ref('play');        // 'play' | 'freeze' | 'countdown'
const countNum = ref(0);          // 倒數顯示數字
const headText = ref('');         // 角色頭上飄字
const headType = ref('');         // 'deny' | 'buff'
const headKey = ref(0);           // 重播飄字動畫
const moveSlots = ref(CONFIG.MOVE_SLOTS); // 移動 buffer 當前槽數（浮點）
const maxSlots = ref(CONFIG.MOVE_SLOTS);  // 移動 buffer 上限，每換圖 +1
const energyCap = ref(CONFIG.ENERGY_CAP); // 能量上限（閃電數），每換圖 +1
const boardCanvas = ref(null);    // 盤面用單一 canvas 畫（根治 3D grid 接縫）
const orbitAngle = ref(0);        // 能量行星軌道目前角度

let boosts = [];
let resetIdx = -1;
let heldDirs = [];
let lastStepSound = 0, lastMoveT = -1, lastStepT = -1;
let jumpArm = null;               // { dir, until } 撞障礙緩衝
let buffLooping = false;          // buff 律動音樂是否正在播
let phaseT = 0;                   // 過場剩餘秒數
let raf = 0, lastT = 0;

const idx = (x, y) => y * CONFIG.W + x;
const inBoard = (x, y) => x >= 0 && x < CONFIG.W && y >= 0 && y < CONFIG.H;
const sgn = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const sameDir = (a, b) => a[0] === b[0] && a[1] === b[1];
const isObstacle = (x, y) => { const c = cells[idx(x, y)]; return c && c.revealed && c.mine; };

const buffActive = computed(() => elapsed.value < buffUntil.value);
const buffLeft = computed(() => Math.max(0, buffUntil.value - elapsed.value));
const minesLeft = computed(() => cells.reduce((n, c) => n + (c.mine && !c.revealed ? 1 : 0), 0));

const cellPx = computed(() => {
  const target = Math.min(CONFIG.VIEW_MAX, winW.value - CONFIG.VIEW_MARGIN);
  return Math.max(CONFIG.CELL_MIN, Math.min(CONFIG.CELL_MAX, Math.floor(target / CONFIG.W)));
});
const viewW = computed(() => CONFIG.W * cellPx.value);
const viewH = computed(() => Math.round(viewW.value * CONFIG.VIEW_RATIO));
const charW = computed(() => Math.round(cellPx.value * 0.93));
const charH = computed(() => Math.round(charW.value * 30 / 24));

const boardStyle = computed(() => {
  const cp = cellPx.value;
  if (phase.value === 'freeze') {
    // 重置雷展示：拉遠＋拉垂直，整張盤面入鏡
    const bw = CONFIG.W * cp, bh = CONFIG.H * cp;
    return {
      '--cell': cp + 'px',
      left: `calc(50% - ${bw / 2}px)`, top: `calc(50% - ${bh / 2}px)`,
      transformOrigin: `${bw / 2}px ${bh / 2}px`,
      transform: 'rotateX(20deg) scale(0.58)',
      transition: 'transform .55s ease, left .55s ease, top .55s ease',
    };
  }
  const cx = (camX.value + 0.5) * cp, cy = (camY.value + 0.5) * cp;
  return {
    '--cell': cp + 'px',
    left: `calc(50% - ${cx}px)`, top: `calc(50% - ${cy}px)`,
    transformOrigin: `${cx}px ${cy}px`,
    transform: 'rotateX(46deg)',
    transition: 'none',
  };
});
const hopPx = computed(() => (flight.active ? Math.sin(Math.min(1, flight.t) * Math.PI) * cellPx.value * CONFIG.JUMP_ARC_RATIO : 0));
const charStyle = computed(() => {
  const squatY = squat.value ? cellPx.value * 0.13 : 0;
  const sy = squat.value ? 0.8 : 1;
  // 腳底（-100%）對齊格中心投影點；hop 往上、squat 下蹲、scaleX 控制面向
  return { transform: `translate(-50%, -100%) translateY(${squatY - hopPx.value}px) rotateX(-46deg) scaleY(${sy}) scaleX(${faceDir.value})` };
});
const shadowStyle = computed(() => {
  const k = flight.active ? Math.max(0.4, 1 - hopPx.value / (cellPx.value * 2)) : 1;
  return { transform: `scale(${k})`, opacity: k };
});
const timeStr = computed(() => {
  const t = elapsed.value, m = Math.floor(t / 60), s = (t % 60);
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
});

const DIR_LABEL = { '0,-1': { k: 'W', a: '↑' }, '0,1': { k: 'S', a: '↓' }, '-1,0': { k: 'A', a: '←' }, '1,0': { k: 'D', a: '→' } };
const chargeKey = computed(() => DIR_LABEL[charge.dir.join(',')] || { k: '', a: '' });
const chargePct = computed(() => (charge.need ? Math.min(100, (charge.count / charge.need) * 100) : 0));
const bigMines = computed(() => Math.floor(me.score / 10));   // 大圖＝10
const smallMines = computed(() => me.score % 10);             // 小圖＝1
const energyBolts = computed(() => Math.floor(energy.value + 1e-6));       // 滿一顆＝一道閃電
const energyFrac = computed(() => energy.value - Math.floor(energy.value + 1e-6)); // 正在衝的小數
const showEbar = computed(() => energy.value < energyCap.value - 1e-6);  // 補滿就不顯示能量條
const buffPct = computed(() => Math.min(100, (buffLeft.value / CONFIG.BUFF_SEC) * 100));
const actColor = computed(() => (moveSlots.value < 1 ? '#ff4d4d' : moveSlots.value < 3 ? '#f4b400' : '#46d27a')); // 行動值（移動 slot）變色

// ---- 盤面 ----
function buildBoard() {
  cells.length = 0;
  const N = CONFIG.W * CONFIG.H;
  for (let i = 0; i < N; i++) cells.push({ mine: false, adj: 0, revealed: false });
  const order = [...Array(N).keys()];
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const i of order.slice(0, CONFIG.MINES)) cells[i].mine = true;
  for (let y = 0; y < CONFIG.H; y++) for (let x = 0; x < CONFIG.W; x++) {
    if (cells[idx(x, y)].mine) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && inBoard(nx, ny) && cells[idx(nx, ny)].mine) n++;
    }
    cells[idx(x, y)].adj = n;
  }
  me.x = 6; me.y = 6; camX.value = 6; camY.value = 6;
  boosts = []; resetIdx = -1; heldDirs = []; lastStepT = -1; jumpArm = null;
  mode.value = 'normal'; flight.active = false; squat.value = false; armHint.value = '';
}
function startCountdown() {
  phase.value = 'countdown'; phaseT = CONFIG.RESET_COUNTDOWN_SEC;
  countNum.value = CONFIG.RESET_COUNTDOWN_SEC;
}
function newGame() {
  buildBoard();
  me.score = 0; energy.value = CONFIG.ENERGY_START; elapsed.value = 0;
  loops.value = 1; buffUntil.value = 0; baseRegen.value = CONFIG.MOVE_REGEN_PER_SEC;
  maxSlots.value = CONFIG.MOVE_SLOTS; moveSlots.value = CONFIG.MOVE_SLOTS; energyCap.value = CONFIG.ENERGY_CAP;
  message.value = ''; winner.value = false; running.value = true;
  playStart();
  startCountdown();
}
// 過場結束後真正刷新地圖（保留 score / elapsed）
function doRefresh() {
  buildBoard();
  energyCap.value += 1; maxSlots.value += 1;          // 換圖成長：閃電上限 +1、移動 slot +1
  energy.value = energyCap.value; moveSlots.value = maxSlots.value; // 都補滿
  loops.value++; baseRegen.value += CONFIG.MAP_SPEED_GAIN;
  message.value = '';
  playStart();
}

// ---- 迴圈 ----
function regenRate() { return CONFIG.REGEN_PER_SEC; }
// 後追：單人無對手 → 1；雙人時自己落後 ≥CATCHUP_GAP 顆雷 → CATCHUP_MOVE_MULT（移動加速）
function catchupMult() { return 1; }
function showHead(text, type) { headText.value = text; headType.value = type; headKey.value++; }

// 行星軌道：傾斜橢圓 + 前後穿插（前面大、蓋角色；後面小、被角色擋）
function planetStyle(i) {
  const n = Math.max(1, energyBolts.value);
  const a = orbitAngle.value + ((i - 1) / n) * Math.PI * 2;
  const R = cellPx.value * 0.95;
  const x = Math.cos(a) * R;
  const y = Math.sin(a) * R * 0.4;        // 壓扁成傾斜橢圓（俯視）
  const depth = Math.sin(a);              // >0 在前、<0 在後
  const s = 0.7 + 0.45 * ((depth + 1) / 2);
  return {
    transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(2)})`,
    zIndex: depth > 0 ? 8 : 2,
    opacity: (0.5 + 0.5 * ((depth + 1) / 2)).toFixed(2),
  };
}

// 盤面用單一 canvas 繪製 → 整片一個 quad，沒有 3D grid 子元素接縫
function drawBoard() {
  const cv = boardCanvas.value; if (!cv) return;
  const cp = cellPx.value, W = CONFIG.W, H = CONFIG.H;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = W * cp, cssH = H * cp;
  if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(cp * 0.46)}px system-ui, sans-serif`;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const x = (i % W) * cp, y = Math.floor(i / W) * cp;
    if (c.revealed && c.mine) {
      const g = ctx.createLinearGradient(x, y, x + cp, y + cp);
      g.addColorStop(0, '#3a4654'); g.addColorStop(1, '#222a34');
      ctx.fillStyle = g; ctx.fillRect(x, y, cp, cp);
      ctx.strokeStyle = '#11161d'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, cp - 1, cp - 1);
      ctx.beginPath(); ctx.arc(x + cp / 2, y + cp / 2, cp * 0.27, 0, Math.PI * 2);
      ctx.fillStyle = '#11161d'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#0a0d12'; ctx.stroke();
    } else if (c.revealed) {
      ctx.fillStyle = '#c4cdd6'; ctx.fillRect(x, y, cp, cp);
      if (c.adj) { ctx.fillStyle = NUM_COLORS[c.adj]; ctx.fillText(String(c.adj), x + cp / 2, y + cp / 2 + 1); }
    } else {
      ctx.fillStyle = '#cdd7e2'; ctx.fillRect(x, y, cp, cp);
    }
  }
}
watch(() => cellPx.value, () => nextTick(drawBoard));
watch(cells, () => drawBoard(), { deep: true });
function stepOnce() {
  if (mode.value !== 'normal' || !heldDirs.length) return false;
  const d = heldDirs[heldDirs.length - 1];   // 後按的方向優先，一次只一軸 → 不斜走
  const dx = d[0], dy = d[1];
  const nx = me.x + dx, ny = me.y + dy;
  if (!inBoard(nx, ny) || isObstacle(nx, ny)) return false;
  me.x = nx; me.y = ny;
  if (dx) faceDir.value = dx > 0 ? 1 : -1;
  lastMoveT = elapsed.value;
  if (elapsed.value - lastStepSound > 0.09) { playStep(); lastStepSound = elapsed.value; }
  return true;
}
function tick(dt) {
  if (!running.value || winner.value) {
    if (buffLooping) { buffLooping = false; stopBuffLoop(); }
    return;
  }
  // 換圖過場：定格 → 刷新 → 倒數（計時暫停、輸入鎖定）
  if (phase.value !== 'play') {
    if (buffLooping) { buffLooping = false; stopBuffLoop(); }
    isMoving.value = false;
    phaseT -= dt;
    if (phase.value === 'freeze') {
      if (phaseT <= 0) { doRefresh(); startCountdown(); }
    } else { // countdown
      countNum.value = Math.max(1, Math.ceil(phaseT));
      if (phaseT <= 0) phase.value = 'play';
    }
    return;
  }
  elapsed.value += dt;
  orbitAngle.value = (orbitAngle.value + dt * 2.0) % (Math.PI * 2);
  energy.value = Math.min(energyCap.value, energy.value + regenRate() * dt);
  if (boosts.length) {
    const per = CONFIG.MINE_REFUND / CONFIG.MINE_REFUND_SEC;
    for (const b of boosts) {
      const add = Math.min(b.remain, per * dt);
      energy.value = Math.min(energyCap.value, energy.value + add);
      b.remain -= add;
    }
    boosts = boosts.filter((b) => b.remain > 1e-4);
  }
  // 移動：buffer 填充式——走一步耗 1 slot，slot 以 regen 回復；攢滿可爆發連走
  if (mode.value === 'normal') {
    const regen = baseRegen.value * (buffActive.value ? CONFIG.BUFF_MOVE_MULT : 1) * catchupMult();
    moveSlots.value = Math.min(maxSlots.value, moveSlots.value + regen * dt);
    if (heldDirs.length && moveSlots.value >= 1 && elapsed.value - lastStepT >= CONFIG.MOVE_STEP_MIN) {
      if (stepOnce()) { moveSlots.value -= 1; lastStepT = elapsed.value; }
    }
  }
  // 飛行
  if (mode.value === 'flying' && flight.active) {
    flight.t += dt / flight.dur;
    if (flight.t >= 1) {
      me.x = flight.toX; me.y = flight.toY;
      flight.active = false; mode.value = 'normal'; lastStepT = elapsed.value;
      playStep();
    }
  }
  // 攝影機
  if (mode.value === 'flying' && flight.active) {
    const t = Math.min(1, flight.t);
    camX.value = flight.fromX + (flight.toX - flight.fromX) * t;
    camY.value = flight.fromY + (flight.toY - flight.fromY) * t;
  } else {
    const k = Math.min(1, dt * CONFIG.CAM_LERP);
    camX.value += (me.x - camX.value) * k;
    camY.value += (me.y - camY.value) * k;
  }
  // buff 律動音樂：跟著 buff 起訖
  if (buffActive.value && !buffLooping) { buffLooping = true; startBuffLoop(); }
  else if (!buffActive.value && buffLooping) { buffLooping = false; stopBuffLoop(); }
  // 跳躍緩衝過期
  if (jumpArm && elapsed.value >= jumpArm.until) { jumpArm = null; armHint.value = ''; }
  // 走路動畫：剛踏過步、或攝影機還在追、或飛行中
  const camMoving = Math.abs(camX.value - me.x) > 0.05 || Math.abs(camY.value - me.y) > 0.05;
  isMoving.value = mode.value === 'flying' || camMoving || elapsed.value - lastMoveT < 0.18;
}
function loop(t) {
  if (!lastT) lastT = t;
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  tick(dt);
  raf = requestAnimationFrame(loop);
}

// ---- 翻牌 ----
function floodOpen(sx, sy) {
  const stack = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (!inBoard(nx, ny)) continue;
      const c = cells[idx(nx, ny)];
      if (c.revealed || c.mine) continue;
      c.revealed = true;
      if (c.adj === 0) stack.push([nx, ny]);
    }
  }
}
function maybeAssignReset() {
  if (resetIdx >= 0) return;
  const rem = [];
  for (let k = 0; k < cells.length; k++) if (cells[k].mine && !cells[k].revealed) rem.push(k);
  if (rem.length > 0 && rem.length <= CONFIG.RESET_TRIGGER) resetIdx = rem[Math.floor(Math.random() * rem.length)];
}
function reveal() {
  if (winner.value || mode.value === 'flying' || phase.value !== 'play') return;
  const i = idx(me.x, me.y), c = cells[i];
  if (c.revealed) { message.value = '這格已經翻開了'; return; }
  if (energy.value < CONFIG.REVEAL_COST) { message.value = '能量不足，等回復…'; flash.value++; showHead('沒能量！', 'deny'); playDeny(); return; }
  energy.value -= CONFIG.REVEAL_COST; message.value = '';
  if (c.mine) {
    if (i === resetIdx) {
      c.revealed = true; message.value = '🔄 重置雷！';
      heldDirs = []; jumpArm = null; armHint.value = ''; isMoving.value = false;
      phase.value = 'freeze'; phaseT = CONFIG.RESET_FREEZE_SEC;
      playClaimSelf();
      return;
    }
    c.revealed = true; me.score++;
    boosts.push({ remain: CONFIG.MINE_REFUND });
    if (me.score >= CONFIG.GOAL) { winner.value = true; running.value = false; playWin(); return; }
    maybeAssignReset();
    playClaimSelf();
  } else {
    c.revealed = true;
    if (c.adj === 0) {
      energy.value = energyCap.value;        // 翻 0：補滿能量
      moveSlots.value = maxSlots.value;      //        ＋補滿移動 buffer
      buffUntil.value = elapsed.value + CONFIG.BUFF_SEC;
      floodOpen(me.x, me.y);
      showHead('加速 ×2！', 'buff');
      playBuff();
    } else {
      energy.value = Math.min(energyCap.value, energy.value + c.adj / CONFIG.NUM_REFUND_DIV);
      playReveal();
    }
  }
}
// ---- 跳躍 ----
function scanJump(dir) {
  let n = 0, x = me.x + dir[0], y = me.y + dir[1];
  while (inBoard(x, y) && isObstacle(x, y)) { n++; x += dir[0]; y += dir[1]; }
  if (n === 0) return null;             // 前方不是障礙
  if (!inBoard(x, y) || isObstacle(x, y)) return null; // 落地點不可站
  return { n, landX: x, landY: y };
}
function startCharge(dir, j) {
  mode.value = 'charging'; heldDirs = [];
  charge.dir = dir; charge.n = j.n; charge.landX = j.landX; charge.landY = j.landY;
  charge.need = Math.max(CONFIG.JUMP_BASE_PRESSES, 2 * j.n - 3); charge.count = 0;
  squat.value = true;
}
function cancelCharge() { mode.value = 'normal'; squat.value = false; }
function startFlight() {
  squat.value = false;
  const fdx = sgn(charge.landX - me.x); if (fdx) faceDir.value = fdx > 0 ? 1 : -1;
  flight.active = true; flight.fromX = me.x; flight.fromY = me.y;
  flight.toX = charge.landX; flight.toY = charge.landY; flight.n = charge.n; flight.t = 0;
  flight.dur = Math.max(CONFIG.JUMP_FLIGHT_MIN_SEC, charge.n / CONFIG.JUMP_FLIGHT_DIV);
  mode.value = 'flying';
  playClaimSelf();
}

const KEYMAP = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
function onKey(e) {
  if (phase.value !== 'play') { if (KEYMAP[e.key] || e.key === ' ') e.preventDefault(); return; }
  const dir = KEYMAP[e.key];
  if (dir) {
    e.preventDefault();
    if (mode.value === 'flying') return;
    if (mode.value === 'charging') {
      if (sameDir(dir, charge.dir)) { if (!e.repeat) squat.value = true; return; }
      cancelCharge(); // 換方向 → 取消蓄力，往下走 normal
    }
    if (e.repeat) return;
    const nx = me.x + dir[0], ny = me.y + dir[1];
    if (inBoard(nx, ny) && isObstacle(nx, ny)) {
      const j = scanJump(dir);
      if (!j) { jumpArm = null; armHint.value = ''; return; } // 不能跳，擋住
      if (jumpArm && sameDir(jumpArm.dir, dir) && elapsed.value < jumpArm.until) {
        jumpArm = null; armHint.value = '';
        startCharge(dir, j);           // 第二次按同方向 → 進 QTE 蓄力
      } else {
        jumpArm = { dir, until: elapsed.value + CONFIG.JUMP_ARM_SEC };
        armHint.value = (DIR_LABEL[dir.join(',')] || {}).a || ''; // 緩衝：再按一次才跳
      }
      return;
    }
    jumpArm = null; armHint.value = '';
    heldDirs = heldDirs.filter((d) => !sameDir(d, dir));
    heldDirs.push(dir);                 // 不立即走，交給 rAF 依 interval 限速
    return;
  }
  if (e.key === 'f' || e.key === 'F' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); reveal(); }
}
function onKeyUp(e) {
  const dir = KEYMAP[e.key];
  if (!dir) return;
  if (mode.value === 'charging' && sameDir(dir, charge.dir)) {
    squat.value = false; charge.count++; ringKey.value++; playReveal();
    if (charge.count >= charge.need) startFlight();
    return;
  }
  heldDirs = heldDirs.filter((d) => !sameDir(d, dir));
}
const onBlur = () => { heldDirs = []; jumpArm = null; armHint.value = ''; if (mode.value === 'charging') cancelCharge(); };
const onResize = () => { winW.value = window.innerWidth; };
onMounted(() => {
  newGame();
  nextTick(drawBoard);
  raf = requestAnimationFrame(loop);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onResize);
});
onUnmounted(() => {
  cancelAnimationFrame(raf);
  stopBuffLoop();
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);
  window.removeEventListener('resize', onResize);
});
</script>

<template>
  <div class="runner">
    <div class="runner-bar">
      <button class="link-btn" @click="navigate('/')">← 回大廳</button>
      <strong>🧪 探雷模式・即時 loop</strong>
      <span class="bar-right">
        <button class="link-btn" :class="{ on: showRulers }" @click="showRulers = !showRulers">📐 尺規</button>
        <button class="link-btn" @click="newGame">🔄 重開</button>
      </span>
    </div>

    <div class="time-row">
      <span class="time-box">⏱ {{ timeStr }}</span>
    </div>

    <div class="runner-hud">
      <span class="hud-stat score-stat">
        <span class="mines-vis" v-if="me.score > 0">
          <i v-for="b in bigMines" :key="'b' + b" class="m-big"></i>
          <i v-for="s in smallMines" :key="'s' + s" class="m-small"></i>
        </span>
        <small class="score-num">{{ me.score }}/{{ CONFIG.GOAL }}</small>
      </span>
      <span class="hud-stat">🗺 第 <b>{{ loops }}</b> 張</span>
      <span class="hud-stat">🏃 <b>{{ baseRegen.toFixed(1) }}</b>/s</span>
      <span class="hud-stat" :class="{ warn: minesLeft <= CONFIG.RESET_TRIGGER }">本圖剩 <b>{{ minesLeft }}</b> 雷</span>
    </div>

    <div v-if="winner" class="runner-over" :style="{ '--c': COLOR }">
      🏆 累積 {{ CONFIG.GOAL }} 顆雷！{{ loops }} 張圖・用時 {{ timeStr }}
      <button @click="newGame">再來一輪</button>
    </div>
    <template v-else>
      <div class="runner-turn">
        <span class="msg" v-if="mode === 'charging'">🟦 蓄力跳 {{ charge.count }}/{{ charge.need }}（連按同方向）</span>
        <span class="msg" v-else-if="message">{{ message }}</span>
        <span v-else-if="minesLeft <= CONFIG.RESET_TRIGGER">⚠ 最後幾顆，其中一顆是重置雷——翻到就換新圖</span>
        <span v-else>移動探索，站定翻開腳下格搶雷；翻到 0 補滿能量＋加速</span>
      </div>
      <div class="ctrl-bar">
        <button class="exec-btn" :disabled="energy < CONFIG.REVEAL_COST || mode !== 'normal'" @click="reveal">🔍 翻開 (F)</button>
      </div>
    </template>

    <div class="viewport" :style="{ width: viewW + 'px', height: viewH + 'px' }">
      <div class="board" :style="boardStyle">
        <canvas ref="boardCanvas" class="bcanvas"></canvas>
      </div>
      <!-- 撞障礙緩衝：再按一次才跳 -->
      <div v-if="armHint && mode === 'normal'" class="arm-hint">再按 <b>{{ armHint }}</b> 跳越</div>
      <!-- 蓄力 QTE 提示 -->
      <div v-if="mode === 'charging'" class="qte">
        <div class="qte-title">蓄力跳越！狂按</div>
        <div class="qte-key" :key="ringKey">{{ chargeKey.k }} <small>{{ chargeKey.a }}</small></div>
        <div class="qte-bar"><span :style="{ width: chargePct + '%' }"></span></div>
        <div class="qte-count">{{ charge.count }} / {{ charge.need }}</div>
      </div>
      <!-- 角色固定畫面中央，地圖在底下捲動 -->
      <div class="actor" v-show="phase !== 'freeze'" :style="{ '--ch': charH + 'px', '--cell': cellPx + 'px' }">
        <div v-if="headText" class="headtext" :class="headType" :key="headKey">{{ headText }}</div>
        <template v-if="phase === 'play'">
          <!-- buff 剩餘：圓餅歸零式 -->
          <div v-if="buffActive" class="hbuff-pie" :style="{ '--pct': buffPct + '%' }"></div>
          <!-- 能量小數：正在衝的能量條（整數顆＝下方行星軌道閃電） -->
          <div v-if="showEbar" class="henergy">
            <span class="ebar2-fill" :style="{ width: energyFrac * 100 + '%', background: '#f4b400' }"></span>
          </div>
          <!-- 移動 buffer（貼近頭） -->
          <div v-if="mode === 'normal'" class="moveslots">
            <span v-for="i in maxSlots" :key="i" class="mslot">
              <span class="mfill" :style="{ transform: `scaleX(${Math.max(0, Math.min(1, moveSlots - (i - 1)))})`, background: actColor }"></span>
            </span>
          </div>
        </template>
        <span class="ashadow" :style="shadowStyle"></span>
        <span v-if="mode === 'charging'" class="cring" :key="ringKey"></span>
        <span class="char" :class="{ buffed: buffActive }" :style="[{ color: COLOR }, charStyle]">
          <span class="char-anim" :class="{ walk: isMoving }">
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
        </span>
        <!-- 能量行星軌道：整數顆閃電繞角色轉（傾斜橢圓、前後穿插） -->
        <div class="orbit">
          <span v-for="i in energyBolts" :key="i" class="planet" :style="planetStyle(i)">
            <svg viewBox="0 0 24 24" width="20" height="20"><path d="M13 2 4 13 11 13 9 22 20 10 13 10 Z" fill="#ffd23f" /></svg>
          </span>
        </div>
      </div>
      <!-- 換圖過場 -->
      <div v-if="phase === 'freeze'" class="scoreboard">
        <div class="sb-title">🔄 重置雷</div>
        <div class="sb-score">已搶 <b>{{ me.score }}</b> / {{ CONFIG.GOAL }} 顆雷</div>
        <div class="sb-time">用時 {{ timeStr }}</div>
        <div class="sb-loop">第 {{ loops }} 張完成 → 進入下一張</div>
      </div>
      <div v-else-if="phase === 'countdown'" class="overlay countdown">{{ countNum }}</div>
    </div>

    <p class="runner-help">
      <b>移動</b>：按住 <b>WASD</b> 連續走。<b>翻開</b>：站定按 <b>F／空白／Enter</b>，耗 1 ⚡。
      已翻開的雷會<b>擋路</b>，朝它<b>連按同方向蓄力跳</b>越過（後方要有空地）。
      中 <b>0</b> → 補滿 ⚡＋加速 {{ CONFIG.BUFF_SEC }}s；剩最後幾顆出現<b>重置雷</b>翻到換圖，搶滿 {{ CONFIG.GOAL }} 顆過關。
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
.time-row { display: flex; justify-content: center; }
.time-box {
  font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: 1px;
  min-width: 130px; text-align: center; padding: 4px 14px; border-radius: 8px;
  background: #11161d; color: #6cf; box-shadow: inset 0 0 0 1px #2a3645, 0 2px 6px rgba(0, 0, 0, .2);
}
.runner-hud { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; align-items: center; }
.hud-stat { font-size: 13px; padding: 3px 8px; border-radius: 5px; border: 1px solid #ccc; }
.hud-stat b { font-size: 15px; }
.hud-stat.warn { background: #fff0f0; border-color: #e3a; color: #c2185b; }
.score-stat { display: flex; align-items: center; gap: 6px; }
.mines-vis { display: inline-flex; align-items: center; gap: 3px; flex-wrap: wrap; max-width: 220px; }
.m-big, .m-small {
  display: inline-block; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #5a6678, #11161d 70%); box-shadow: 0 0 0 1px #0a0d12;
}
.m-big { width: 16px; height: 16px; }
.m-small { width: 8px; height: 8px; }
.score-num { color: #999; font-size: 11px; font-variant-numeric: tabular-nums; }
.hud-energy { display: flex; align-items: center; gap: 7px; font-size: 16px; }
.hud-energy.bump { animation: ebump .3s ease; }
@keyframes ebump { 0%, 100% { transform: scale(1); } 40% { transform: scale(1.1); color: #c2185b; } }
.ebar { display: inline-flex; gap: 4px; }
.eseg { width: 44px; height: 20px; background: #e3e7ec; border-radius: 4px; overflow: hidden; box-shadow: inset 0 0 0 1px #c4ccd5; }
.efill { display: block; height: 100%; background: linear-gradient(90deg, #f4b400, #ff8c00); transition: width .08s linear; }
.enum { font-variant-numeric: tabular-nums; color: #95610c; font-size: 16px; }
.hud-buff { font-size: 13px; padding: 3px 8px; border-radius: 5px; background: #e6f6ff; border: 1px solid #6cc; color: #06889c; font-weight: 600; }
.runner-turn { font-size: 13px; color: #667; height: 20px; line-height: 20px; display: flex; align-items: center; justify-content: center; }
.runner-turn .msg { color: #b34; }
.runner-over { font-size: 18px; font-weight: 700; color: var(--c); display: flex; gap: 12px; align-items: center; }
.ctrl-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
.exec-btn { padding: 6px 16px; font-size: 14px; font-weight: 700; background: #2a6fd6; color: #fff; }
.exec-btn:disabled { background: #b9c4d0; }

.viewport {
  position: relative; overflow: hidden; margin-top: 6px;
  perspective: 1200px; border-radius: 8px;
  background: linear-gradient(180deg, #8b97a6 0%, #6f7c8c 100%);
  box-shadow: inset 0 0 30px rgba(0, 0, 0, .25);
}
.board {
  position: absolute; will-change: transform;
}
.bcanvas { display: block; } /* 單一 canvas 畫整片盤面，無 3D grid 接縫 */
.arm-hint {
  position: absolute; left: 50%; top: 18%; transform: translateX(-50%); z-index: 9;
  padding: 7px 16px; border-radius: 16px; background: rgba(17, 22, 29, .82); color: #cfe9ff;
  font-size: 17px; font-weight: 600; white-space: nowrap; pointer-events: none; animation: qte-in .12s ease-out;
}
.arm-hint b { color: #4fd0ff; font-size: 22px; }
.qte {
  position: absolute; left: 50%; top: 14%; transform: translateX(-50%); z-index: 5;
  display: flex; flex-direction: column; align-items: center; gap: 5px; pointer-events: none;
  padding: 8px 14px; border-radius: 10px; background: rgba(17, 22, 29, .82);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .35); animation: qte-in .15s ease-out;
}
@keyframes qte-in { from { transform: translateX(-50%) scale(.8); opacity: 0; } }
.qte-title { font-size: 12px; color: #cfe9ff; letter-spacing: 1px; }
.qte-key {
  font-size: 26px; font-weight: 800; color: #11161d; line-height: 1;
  min-width: 46px; text-align: center; padding: 8px 12px; border-radius: 8px;
  background: linear-gradient(180deg, #fff, #cfd7df);
  box-shadow: 0 3px 0 #8b97a6, 0 5px 8px rgba(0, 0, 0, .3);
}
.qte-key small { font-size: 14px; color: #4a5a6a; }
.qte-key { animation: qte-pop .12s ease; }
@keyframes qte-pop { 0% { transform: translateY(3px) scale(.92); } 100% { transform: translateY(0) scale(1); } }
.qte-bar { width: 120px; height: 8px; background: #36404c; border-radius: 4px; overflow: hidden; }
.qte-bar span { display: block; height: 100%; background: linear-gradient(90deg, #4fd0ff, #1d8fff); transition: width .08s ease; }
.qte-count { font-size: 12px; color: #fff; font-variant-numeric: tabular-nums; }
.actor { position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; }
.headtext {
  position: absolute; left: 0; top: calc(var(--ch, 80px) * -1.25);
  transform: translateX(-50%); white-space: nowrap; pointer-events: none; z-index: 9;
  font-size: 26px; font-weight: 900; animation: head-float 1.15s ease-out forwards;
}
.moveslots {
  position: absolute; left: 0; top: calc(var(--ch, 80px) * -0.78); transform: translateX(-50%);
  display: flex; gap: 2px; z-index: 7; padding: 2px 3px; border-radius: 5px;
  background: rgba(17, 22, 29, .55);
}
.mslot {
  width: 8px; height: 11px; border-radius: 2px; overflow: hidden;
  background: rgba(255, 255, 255, .22);
}
.mfill { display: block; width: 100%; height: 100%; transform-origin: left; background: #46d27a; }
.henergy {
  position: absolute; left: 0; top: calc(var(--ch, 80px) * -1.02); transform: translateX(-50%); z-index: 7;
  width: 30px; height: 6px; border-radius: 3px; overflow: hidden;
  background: rgba(17, 22, 29, .6); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .25);
}
.ebar2-fill { display: block; height: 100%; }
.hbuff-pie {
  position: absolute; left: 0; top: calc(var(--ch, 80px) * -1.45); transform: translateX(-50%); z-index: 7;
  width: 18px; height: 18px; border-radius: 50%;
  background: conic-gradient(#38c6ff var(--pct, 0%), rgba(17, 22, 29, .5) var(--pct, 0%) 100%);
  border: 1.5px solid rgba(255, 255, 255, .65); box-shadow: 0 1px 3px rgba(0, 0, 0, .35);
}
/* 能量行星軌道（位置由 JS 每幀算，前後 z-index 穿插角色） */
.orbit {
  position: absolute; left: 0; top: calc(var(--ch, 80px) * -0.5);
  width: 0; height: 0; pointer-events: none;
}
.planet { position: absolute; left: 0; top: 0; will-change: transform; }
.planet svg { display: block; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .45)); }
.headtext.deny { color: #ff5a5a; text-shadow: 0 2px 6px rgba(0, 0, 0, .45); }
.headtext.buff { color: #38c6ff; text-shadow: 0 2px 6px rgba(0, 0, 0, .45); }
@keyframes head-float {
  0%   { opacity: 0; transform: translate(-50%, 12px) scale(.7); }
  20%  { opacity: 1; transform: translate(-50%, 0) scale(1.12); }
  100% { opacity: 0; transform: translate(-50%, -42px) scale(1); }
}
.ashadow {
  position: absolute; left: 0; top: 0;
  width: calc(var(--cell, 48px) * 0.66); height: calc(var(--cell, 48px) * 0.3);
  margin: 0 0 0 calc(var(--cell, 48px) * -0.33);
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, .5), rgba(0, 0, 0, 0) 70%);
  border-radius: 50%;
}
.cring {
  position: absolute; left: 50%; top: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px;
  border: 2px solid #4fd0ff; border-radius: 50%; animation: ring-out .5s ease-out forwards;
}
@keyframes ring-out {
  0% { transform: scale(.4); opacity: .9; }
  100% { transform: scale(3.4); opacity: 0; }
}
.char {
  position: absolute; left: 0; top: 0; transform-origin: center bottom; z-index: 5;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, .3)); will-change: transform;
}
.char svg { display: block; }
.char.buffed { filter: drop-shadow(0 0 6px #4fd0ff) drop-shadow(0 2px 2px rgba(0, 0, 0, .3)); }
.char-anim { display: block; transform-origin: center bottom; animation: char-idle 1.8s ease-in-out infinite; }
.char-anim.walk { animation: char-walk .28s ease-in-out infinite; }
@keyframes char-idle {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50%      { transform: translateY(-1.5px) rotate(0deg); }
}
@keyframes char-walk {
  0%   { transform: translateY(0) rotate(-3deg); }
  25%  { transform: translateY(-4px) rotate(0deg); }
  50%  { transform: translateY(0) rotate(3deg); }
  75%  { transform: translateY(-4px) rotate(0deg); }
  100% { transform: translateY(0) rotate(-3deg); }
}
.overlay {
  position: absolute; inset: 0; z-index: 8; pointer-events: none;
  display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .14);
}
.countdown {
  font-size: 92px; font-weight: 900; color: #fff; text-shadow: 0 4px 16px rgba(0, 0, 0, .55);
}
.scoreboard {
  position: absolute; left: 50%; top: 16px; transform: translateX(-50%); z-index: 8;
  text-align: center; padding: 9px 22px; border-radius: 12px; pointer-events: none;
  background: rgba(17, 22, 29, .82); box-shadow: 0 4px 14px rgba(0, 0, 0, .35);
  animation: freeze-in .25s ease;
}
.sb-title { font-size: 17px; font-weight: 800; color: #ffe27a; letter-spacing: 1px; }
.sb-score { font-size: 23px; font-weight: 900; color: #fff; margin-top: 3px; }
.sb-score b { color: #46d27a; }
.sb-time { font-size: 15px; color: #6cf; font-variant-numeric: tabular-nums; margin-top: 2px; }
.sb-loop { font-size: 12px; color: #9fb4c8; margin-top: 3px; }
@keyframes freeze-in { from { transform: translateX(-50%) scale(.8); opacity: 0; } }
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
