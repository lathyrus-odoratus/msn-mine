<script setup>
// 探雷模式（Mine Runner）原型 — 即時制・roguelite loop（純前端）。
// 連續移動（按住 WASD，有速度）；站定翻開腳下格（耗能量），即時掀牌：
//   中雷得分＋漸補能量；中數字補 X/10 能量；中 0 → 補滿能量＋移動加速 buff。
// 已翻開的雷＝障礙擋路，朝它蓄力可「跳過」：按 max(4,2n-3) 次起跳、飛 max(1,n/5) 秒。
// 每張圖掃到剩最後幾顆時隨機一顆＝重置雷，翻到換新圖、分數累積，多 loop 過關。
//
// 雙人/多人：所有「人身上」的狀態放進 players 陣列（攝影機/輸入永遠綁 players[0]＝自己），
// 盤面 cells 單一共享；模擬迴圈對每個 player 對稱跑（bot 由 botThink 驅動）。
// 翻牌與盤面走 net 層（單機＝loopback 自仲裁；線上＝ws net，server 權威）：送 reveal_req、
// 收 board/reveal/position 事件才套用。props.online 時吃注入的 net＋roster，翻牌/位置依 server id 找人。
import { reactive, ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { navigate, route } from '../router.js';
import { playStep, playClaimSelf, playReveal, playWin, playStart, playDeny, playBuff, startBuffLoop, stopBuffLoop } from '../sound.js';
import RunnerActor from './RunnerActor.vue';
import { pickMove } from '../../../lib/bot.js';
import { createBoard } from '../../../lib/runner-board.js';
import { createLoopbackNet } from '../net-loopback.js';

const CONFIG = reactive({
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
  JUMP_ARM_SEC: 0.7,             // 撞障礙後，再按同方向觸發跳躍的緩衝窗（第二次才進 QTE）
  // 能量
  ENERGY_CAP: 3,
  ENERGY_START: 3,
  REVEAL_COST: 1,
  REGEN_PER_SEC: 0.5,
  MINE_REFUND: 1,
  MINE_REFUND_SEC: 1,
  NUM_REFUND_DIV: 10,
  // 後追（雙人才生效，單人預留）
  CATCHUP_GAP: 3,                 // 落後幾顆雷以上觸發後追（達門檻起、再落後 GAP 顆到滿強度）
  CATCHUP_MOVE_MULT: 1.35,        // 滿強度時：落後者移動（＝slot 回復）倍率
  CATCHUP_REGEN_MULT: 1.6,        // 滿強度時：落後者能量回復倍率
  // 視覺
  CELL_MIN: 40, CELL_MAX: 96,
  VIEW_MAX: 1024, VIEW_RATIO: 0.66, VIEW_MARGIN: 48,
});
const CONFIG_DEFAULTS = { ...CONFIG };   // 調校面板「↺ 預設」用
const NUM_COLORS = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];
const WIDTHS = [480, 720, 1024, 1280];
// 依 server 玩家 id 上色（跨 client 一致）；夠 N 人用
const PLAYER_COLORS = ['#1d5fd6', '#e5533c', '#2ca02c', '#9467bd', '#e6a817', '#17becf', '#d6297a', '#7f7f7f'];
const COLOR = PLAYER_COLORS[0];
// bot 三種強度：pickMove 智慧 + 到點翻牌的反應延遲（弱＝挑得爛、翻得慢）
const BOT_LEVELS = reactive({
  random: { botId: 'random', revealDelay: 0.5, label: '🤖 隨機' },
  greedy: { botId: 'greedy', revealDelay: 0.3, label: '🤖 貪婪' },
  smart: { botId: 'smart', revealDelay: 0.16, label: '🤖 推理' },
});
const BOT_ORDER = ['random', 'greedy', 'smart'];
// 調校面板參數（即時生效組）：每幀讀 CONFIG，拉滑桿下一幀就套用
const TUNE_GROUPS = [
  { title: '移動 / 節奏', items: [
    { key: 'MOVE_REGEN_PER_SEC', label: '基礎走速(格/s)', min: 0.5, max: 4, step: 0.1 },
    { key: 'MAP_SPEED_GAIN', label: '每換圖走速 +', min: 0, max: 1.5, step: 0.1 },
    { key: 'MOVE_STEP_MIN', label: '爆發最小間隔(s)', min: 0.05, max: 0.3, step: 0.01 },
    { key: 'BUFF_MOVE_MULT', label: '翻0加速倍率', min: 1, max: 4, step: 0.25 },
    { key: 'BUFF_SEC', label: '加速持續(s)', min: 1, max: 12, step: 1 },
  ] },
  { title: '能量', items: [
    { key: 'REGEN_PER_SEC', label: '能量回復/s', min: 0, max: 2, step: 0.1 },
    { key: 'REVEAL_COST', label: '翻牌耗能', min: 0, max: 3, step: 0.5 },
    { key: 'NUM_REFUND_DIV', label: '數字退能 /N', min: 4, max: 20, step: 1 },
    { key: 'MINE_REFUND', label: '中雷退能', min: 0, max: 3, step: 0.25 },
  ] },
  { title: '後追（雪球防制）', items: [
    { key: 'CATCHUP_GAP', label: '觸發落後量', min: 1, max: 10, step: 1 },
    { key: 'CATCHUP_MOVE_MULT', label: '移動倍率(滿)', min: 1, max: 2.5, step: 0.05 },
    { key: 'CATCHUP_REGEN_MULT', label: '能量倍率(滿)', min: 1, max: 3, step: 0.1 },
  ] },
  { title: '目標 / 過場', items: [
    { key: 'GOAL', label: '過關雷數', min: 10, max: 120, step: 5 },
    { key: 'RESET_TRIGGER', label: '重置雷門檻', min: 2, max: 20, step: 1 },
    { key: 'RESET_FREEZE_SEC', label: '換圖定格(s)', min: 2, max: 15, step: 1 },
    { key: 'RESET_COUNTDOWN_SEC', label: '倒數(s)', min: 1, max: 5, step: 1 },
  ] },
  { title: '跳躍', items: [
    { key: 'JUMP_BASE_PRESSES', label: '蓄力下限', min: 1, max: 10, step: 1 },
    { key: 'JUMP_FLIGHT_MIN_SEC', label: '飛行下限(s)', min: 0.2, max: 1.5, step: 0.05 },
    { key: 'JUMP_ARC_RATIO', label: '弧高(×格)', min: 0.5, max: 2.5, step: 0.1 },
  ] },
];
// 結構性參數：開局烙進 player / 建盤才用 → 需「套用並重開」或下一張圖才生效
const TUNE_STRUCT = [
  { key: 'W', label: '盤寬', min: 6, max: 20, step: 1 },
  { key: 'H', label: '盤高', min: 6, max: 20, step: 1 },
  { key: 'MINES', label: '每圖雷數', min: 10, max: 80, step: 1 },
  { key: 'ENERGY_CAP', label: '能量上限', min: 1, max: 8, step: 1 },
  { key: 'ENERGY_START', label: '初始能量', min: 0, max: 8, step: 1 },
  { key: 'MOVE_SLOTS', label: '移動 slot 上限', min: 1, max: 10, step: 1 },
];
function resetConfig() { Object.assign(CONFIG, CONFIG_DEFAULTS); }
// 匯出目前調好的數值成可貼回的文字（並複製到剪貼簿）
function exportConfig() {
  const lines = Object.entries(CONFIG).map(([k, v]) => `  ${k}: ${v},`);
  const bots = BOT_ORDER.map((id) => `${id} ${BOT_LEVELS[id].revealDelay}`).join(' / ');
  exportText.value = `// 探雷 CONFIG（調校匯出）\n${lines.join('\n')}\n// bot revealDelay：${bots}`;
  exportCopied.value = false;
  try { navigator.clipboard.writeText(exportText.value).then(() => { exportCopied.value = true; }); } catch { /* 剪貼簿不可用就只顯示文字 */ }
}

// ---- 雙人狀態模型 ----
// 每個 player 自帶位置/分數/能量/移動 buffer/buff/面向/模式/蓄力/飛行/軌道/基礎回復/成長上限，
// 以及移動與翻牌時序、頭上 HUD 的飄字。盤面 cells 是兩人共享、不放在 player 裡。
function makePlayer(isBot, id, name = '') {
  return {
    isBot, id, name, color: PLAYER_COLORS[id % PLAYER_COLORS.length], level: isBot ? 'greedy' : null,
    x: 6, y: 6, score: 0,
    energy: CONFIG.ENERGY_START,
    energyCap: CONFIG.ENERGY_CAP,         // 能量上限（閃電數），每換圖 +1
    moveSlots: CONFIG.MOVE_SLOTS,         // 移動 buffer 當前槽數（浮點）
    maxSlots: CONFIG.MOVE_SLOTS,          // 移動 buffer 上限，每換圖 +1
    buffUntil: 0,                         // 加速 buff 結束時間（對 elapsed）
    mode: 'normal',                       // 'normal' | 'charging' | 'flying'
    charge: { dir: [0, 0], n: 0, need: 0, count: 0, landX: 0, landY: 0 },
    flight: { active: false, fromX: 0, fromY: 0, toX: 0, toY: 0, n: 0, dur: 1, t: 0 },
    squat: false,
    faceDir: 1,                           // 角色面向：1 右、-1 左
    isMoving: false,
    orbitAngle: 0,                        // 能量行星軌道目前角度
    boosts: [],                           // 中雷後的能量漸補佇列
    heldDirs: [],                         // 目前按住/欲走的方向佇列
    jumpArm: null,                        // { dir, until } 撞障礙緩衝
    lastMoveT: -1, lastStepT: -1, lastStepSound: 0,
    armHint: '',                          // 撞障礙緩衝提示（顯示方向箭頭）
    headText: '', headType: '', headKey: 0, // 頭上飄字（'deny' | 'buff'）
    ringKey: 0,                           // 蓄力 QTE 重播動畫用
  };
}

// props：net 注入（連線＝ws net；null＝自建 loopback 單機）；roster＝線上玩家名單；online 旗標
const props = defineProps({
  net: { type: Object, default: null },
  roster: { type: Array, default: null },
  online: { type: Boolean, default: false },
});

const cells = reactive([]);               // { mine, adj, revealed }
// 線上：自己永遠放 players[0]（攝影機/輸入照舊綁 [0]），其他人接在後面；id 帶 server 座號。
// 單機：[自己, bot]。
function buildPlayers() {
  if (props.online && props.roster) {
    const myId = props.net.localId;
    const mine = props.roster.find((r) => r.id === myId) || { id: myId, name: '你' };
    const others = props.roster.filter((r) => r.id !== myId);
    return [makePlayer(false, mine.id, mine.name), ...others.map((r) => makePlayer(false, r.id, r.name))];
  }
  return [makePlayer(false, 0), makePlayer(true, 1)];
}
const players = reactive(buildPlayers());
const me = computed(() => players[0]);     // 玩家本人＝攝影機/輸入綁定對象（線上也放 [0]）
const myId = props.online ? props.net.localId : 0;
const playerById = (id) => players.find((p) => p.id === id);
const elapsed = ref(0);
const loops = ref(1);
const running = ref(false);
const message = ref('');
const flash = ref(0);
const winner = ref(false);
const winnerId = ref(-1);          // 哪個 player 先搶滿 GOAL（-1 = 未分勝負）
const botLevel = ref('greedy');    // 目前 bot 強度（#9 大廳可選）
const showRulers = ref(false);
const showPanel = ref(false);      // 調校面板開關（#10 邊玩邊調）
const exportText = ref('');        // 匯出的 CONFIG 文字
const exportCopied = ref(false);   // 是否已複製到剪貼簿
const winW = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);

const camX = ref(6), camY = ref(6);
const phase = ref('play');                // 'play' | 'freeze' | 'countdown'
const countNum = ref(0);                  // 倒數顯示數字
const boardCanvas = ref(null);            // 盤面用單一 canvas 畫（根治 3D grid 接縫）

const boardSeed = ref(0);                  // 本張盤的 seed（authority 給，client 建同盤鏡像）
// net 層：單機用 loopback（同進程權威）；連線時換成 ws net，元件不用改
const net = props.net || createLoopbackNet({ getCfg: () => CONFIG });
let botAI = {};                            // bot 尋路/翻牌狀態：{ [id]: { target, path, arrived, wait, repick } }
let buffLooping = false;                   // buff 律動音樂是否正在播（綁 players[0]）
let phaseT = 0;                            // 過場剩餘秒數
let raf = 0, lastT = 0;

const idx = (x, y) => y * CONFIG.W + x;
const inBoard = (x, y) => x >= 0 && x < CONFIG.W && y >= 0 && y < CONFIG.H;
const sgn = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const sameDir = (a, b) => a[0] === b[0] && a[1] === b[1];
const isObstacle = (x, y) => { const c = cells[idx(x, y)]; return c && c.revealed && c.mine; };
const isBuffActive = (p) => elapsed.value < p.buffUntil;

// 玩家本人（players[0]）的衍生顯示量
const minesLeft = computed(() => cells.reduce((n, c) => n + (c.mine && !c.revealed ? 1 : 0), 0));
const maxScore = computed(() => Math.max(...players.map((p) => p.score)));
// 基礎移動 slot 回復（＝穩態走速）：隨換圖成長，兩人對等；改成 computed 讓調校面板即時生效
const moveRegen = computed(() => CONFIG.MOVE_REGEN_PER_SEC + (loops.value - 1) * CONFIG.MAP_SPEED_GAIN);

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
// 對手畫在盤面座標上：定位到格中心，並反轉 board 的 46° 傾斜讓角色/HUD 螢幕朝向
function boardActorStyle(p) {
  const cp = cellPx.value;
  return {
    left: (p.x + 0.5) * cp + 'px', top: (p.y + 0.5) * cp + 'px',
    transform: 'rotateX(-46deg)',
    transition: 'left .12s linear, top .12s linear',
  };
}
const timeStr = computed(() => {
  const t = elapsed.value, m = Math.floor(t / 60), s = (t % 60);
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
});

const DIR_LABEL = { '0,-1': { k: 'W', a: '↑' }, '0,1': { k: 'S', a: '↓' }, '-1,0': { k: 'A', a: '←' }, '1,0': { k: 'D', a: '→' } };
const chargeKey = computed(() => DIR_LABEL[players[0].charge.dir.join(',')] || { k: '', a: '' });
const chargePct = computed(() => (players[0].charge.need ? Math.min(100, (players[0].charge.count / players[0].charge.need) * 100) : 0));
const bigMines = computed(() => Math.floor(players[0].score / 10));   // 大圖＝10
const smallMines = computed(() => players[0].score % 10);             // 小圖＝1

// ---- 盤面 ----
// 收到權威 'board' 事件 → 用同 seed 建 client 鏡像盤（cells 仍 reactive 供 canvas 重繪）
function applyBoard(seed) {
  boardSeed.value = seed;
  const fresh = createBoard({ W: CONFIG.W, H: CONFIG.H, MINES: CONFIG.MINES, seed });
  cells.length = 0;
  for (const c of fresh.cells) cells.push(c);
}
// 換圖/開局時清掉 player 的位置與暫態（保留成長量看呼叫端決定）
function resetPlayerForBoard(p, x, y) {
  p.x = x; p.y = y;
  p.boosts = []; p.heldDirs = []; p.jumpArm = null; p.lastStepT = -1; p.lastMoveT = -1;
  p.mode = 'normal'; p.flight.active = false; p.squat = false; p.armHint = '';
}
function startCountdown() {
  phase.value = 'countdown'; phaseT = CONFIG.RESET_COUNTDOWN_SEC;
  countNum.value = CONFIG.RESET_COUNTDOWN_SEC;
}
// 要一張新盤：單機向 loopback 要（同步回 'board'）；線上由 server 驅動（忽略此送出）
let pendingGrowth = false;
function requestBoard(growth) { pendingGrowth = growth; net.send({ t: 'new_board' }); }
// 把玩家擺到盤面（自己 [0] 置中、其他人左右錯開），攝影機跟自己
function spawnPlayers() {
  botAI = {};
  const cx = Math.floor(CONFIG.W / 2), cy = Math.floor(CONFIG.H / 2), n = players.length;
  players.forEach((p, i) => {
    const sx = Math.max(0, Math.min(CONFIG.W - 1, cx + (i - Math.floor(n / 2)) * 2));
    resetPlayerForBoard(p, sx, cy);
  });
  camX.value = players[0].x; camY.value = players[0].y;
}
// 換圖成長：能量上限/slot +1 並補滿，兩人對等
function applyGrowth() {
  for (const p of players) {
    p.energyCap += 1; p.maxSlots += 1;
    p.energy = p.energyCap; p.moveSlots = p.maxSlots;
  }
  loops.value++;                          // moveRegen 是 loops 的 computed，成長自動生效
}
// 收到權威盤面事件 → 建鏡像盤、（換圖時）成長、擺放玩家、倒數開打
function startRound(seed, growth) {
  applyBoard(seed);
  if (growth) applyGrowth();
  spawnPlayers();
  message.value = '';
  playStart();
  startCountdown();
}
function newGame() {
  for (const p of players) {
    p.score = 0; p.energy = CONFIG.ENERGY_START; p.buffUntil = 0;
    p.maxSlots = CONFIG.MOVE_SLOTS; p.moveSlots = CONFIG.MOVE_SLOTS;
    p.energyCap = CONFIG.ENERGY_CAP;
  }
  if (!props.online && players[1]) players[1].level = botLevel.value;
  elapsed.value = 0; loops.value = 1;
  message.value = ''; winner.value = false; winnerId.value = -1; running.value = true;
  if (!props.online) requestBoard(false);   // 單機：要盤 → 'board' 事件 → startRound；線上等 server
}
function doRefresh() { requestBoard(true); }   // 單機換圖（線上走 server map_reset）

// ---- 迴圈 ----
function regenRate() { return CONFIG.REGEN_PER_SEC; }
// 後追強度 0→1：落後 < GAP 顆 → 0（不觸發）；達門檻起隨落後量爬升，再落後 GAP 顆到滿。
// 用「所有玩家最高分 − 自己」算落後量 → 對稱套用、N 人也對。
function catchupT(p) {
  const lead = Math.max(...players.map((q) => q.score));
  const gap = lead - p.score;
  if (gap < CONFIG.CATCHUP_GAP) return 0;
  return Math.min(1, (gap - CONFIG.CATCHUP_GAP + 1) / CONFIG.CATCHUP_GAP);
}
function catchupMult(p) { return 1 + (CONFIG.CATCHUP_MOVE_MULT - 1) * catchupT(p); }   // 移動/slot 回復
function catchupEnergyMult(p) { return 1 + (CONFIG.CATCHUP_REGEN_MULT - 1) * catchupT(p); } // 能量回復
function showHead(p, text, type) { p.headText = text; p.headType = type; p.headKey++; }
// 比分/結算的玩家標籤：單機「你/電腦」；線上顯示名字並標「（你）」
function playerLabel(p) {
  if (props.online) return (p.id === myId ? '🧍 ' : '👤 ') + (p.name || `P${p.id}`) + (p.id === myId ? '（你）' : '');
  return p.isBot ? '🤖 電腦' : '🧍 你';
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
      if (c.owner >= 0) {   // 歸屬：搶到的一方色內框（reset 雷 owner=-1 不上色）
        ctx.strokeStyle = PLAYER_COLORS[c.owner]; ctx.lineWidth = 3;
        ctx.strokeRect(x + 2.5, y + 2.5, cp - 5, cp - 5);
      }
    } else if (c.revealed) {
      ctx.fillStyle = '#c4cdd6'; ctx.fillRect(x, y, cp, cp);
      if (c.adj) {
        ctx.fillStyle = NUM_COLORS[c.adj]; ctx.fillText(String(c.adj), x + cp / 2, y + cp / 2 + 1);
      } else {
        // 0 格：淡斜條紋 texture，跟未翻開蓋子區分
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, cp, cp); ctx.clip();
        ctx.strokeStyle = 'rgba(138, 153, 170, .4)'; ctx.lineWidth = 1.5;
        for (let d = -cp; d < cp; d += 7) {
          ctx.beginPath(); ctx.moveTo(x + d, y + cp); ctx.lineTo(x + d + cp, y); ctx.stroke();
        }
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#cdd7e2'; ctx.fillRect(x, y, cp, cp);
    }
  }
}
watch(() => cellPx.value, () => nextTick(drawBoard));
watch(cells, () => drawBoard(), { deep: true });

function stepOnce(p) {
  if (p.mode !== 'normal' || !p.heldDirs.length) return false;
  const d = p.heldDirs[p.heldDirs.length - 1];   // 後按的方向優先，一次只一軸 → 不斜走
  const dx = d[0], dy = d[1];
  const nx = p.x + dx, ny = p.y + dy;
  if (!inBoard(nx, ny) || isObstacle(nx, ny)) return false;
  p.x = nx; p.y = ny;
  if (dx) p.faceDir = dx > 0 ? 1 : -1;
  p.lastMoveT = elapsed.value;
  if (!p.isBot && elapsed.value - p.lastStepSound > 0.09) { playStep(); p.lastStepSound = elapsed.value; }
  return true;
}
// 單一 player 的逐幀模擬（能量/boost/移動/飛行/buff/軌道/緩衝過期/走路動畫）
function simPlayer(p, dt) {
  p.orbitAngle = (p.orbitAngle + dt * 2.0) % (Math.PI * 2);
  p.energy = Math.min(p.energyCap, p.energy + regenRate() * catchupEnergyMult(p) * dt);
  if (p.boosts.length) {
    const per = CONFIG.MINE_REFUND / CONFIG.MINE_REFUND_SEC;
    for (const b of p.boosts) {
      const add = Math.min(b.remain, per * dt);
      p.energy = Math.min(p.energyCap, p.energy + add);
      b.remain -= add;
    }
    p.boosts = p.boosts.filter((b) => b.remain > 1e-4);
  }
  // 移動：buffer 填充式——走一步耗 1 slot，slot 以 regen 回復；攢滿可爆發連走
  if (p.mode === 'normal') {
    const regen = moveRegen.value * (isBuffActive(p) ? CONFIG.BUFF_MOVE_MULT : 1) * catchupMult(p);
    p.moveSlots = Math.min(p.maxSlots, p.moveSlots + regen * dt);
    if (p.heldDirs.length && p.moveSlots >= 1 && elapsed.value - p.lastStepT >= CONFIG.MOVE_STEP_MIN) {
      if (stepOnce(p)) { p.moveSlots -= 1; p.lastStepT = elapsed.value; }
    }
  }
  // 飛行
  if (p.mode === 'flying' && p.flight.active) {
    p.flight.t += dt / p.flight.dur;
    if (p.flight.t >= 1) {
      p.x = p.flight.toX; p.y = p.flight.toY;
      p.flight.active = false; p.mode = 'normal'; p.lastStepT = elapsed.value;
      if (!p.isBot) playStep();
    }
  }
  // 跳躍緩衝過期
  if (p.jumpArm && elapsed.value >= p.jumpArm.until) { p.jumpArm = null; p.armHint = ''; }
  // 走路動畫：剛踏過步、或飛行中（攝影機追隨另外併進玩家本人判斷）
  p.isMoving = p.mode === 'flying' || elapsed.value - p.lastMoveT < 0.18;
}

// ---- bot 即時 AI ----
// 把 runner 的 cells 包成 lib/bot.js 的 game 介面，直接復用 pickMove 選「最可能是雷」的格。
function botGame() { return { width: CONFIG.W, height: CONFIG.H, mineCount: CONFIG.MINES, cells }; }
const BFS_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// 從 (sx,sy) BFS 整片可達區（障礙＝已翻開的雷擋路）；回傳 prev 陣列與 BFS 造訪順序（距離遞增）
function bfsFrom(sx, sy) {
  const W = CONFIG.W, N = W * CONFIG.H;
  const prev = new Array(N).fill(-2);      // -2 未訪、-1 起點
  const si = idx(sx, sy); prev[si] = -1;
  const order = [si]; let head = 0;
  while (head < order.length) {
    const ci = order[head++], cx = ci % W, cy = (ci - cx) / W;
    for (const [dx, dy] of BFS_DIRS) {
      let nx = cx + dx, ny = cy + dy;
      if (!inBoard(nx, ny)) continue;
      if (isObstacle(nx, ny)) {
        // 跳躍邊：越過連續障礙，落在直線上第一個可站的格（＝human 蓄力跳的落點）
        while (inBoard(nx, ny) && isObstacle(nx, ny)) { nx += dx; ny += dy; }
        if (!inBoard(nx, ny) || isObstacle(nx, ny)) continue;   // 落地不可站 → 這方向不通
      }
      const ni = idx(nx, ny);
      if (prev[ni] !== -2) continue;
      prev[ni] = ci; order.push(ni);
    }
  }
  return { prev, order };
}
// 從 prev 回溯出 起點→goal 的路徑（去掉起點）；不可達回 null
function pathFromPrev(prev, gx, gy) {
  const W = CONFIG.W; let gi = idx(gx, gy);
  if (prev[gi] === -2) return null;
  const path = [];
  while (gi !== -1) { path.push({ x: gi % W, y: Math.floor(gi / W) }); gi = prev[gi]; }
  path.reverse(); path.shift();
  return path;
}
// 重新挑目標：pickMove 選最想翻的格；不可達 → 退而求最近可達的未翻開格
function botPickTarget(p, st) {
  const lvl = BOT_LEVELS[p.level] || BOT_LEVELS.greedy;
  const { prev, order } = bfsFrom(p.x, p.y);
  const t = pickMove(botGame(), lvl.botId);
  let target = t, path = t ? pathFromPrev(prev, t.x, t.y) : null;
  if (!path) {
    const W = CONFIG.W;
    const nearIdx = order.find((ci) => !cells[ci].revealed);   // 距離遞增，第一個未翻開＝最近
    target = nearIdx === undefined ? null : { x: nearIdx % W, y: Math.floor(nearIdx / W) };
    path = target ? pathFromPrev(prev, target.x, target.y) : null;
  }
  st.target = path ? target : null;
  st.path = path || [];
  st.arrived = false;
}
function botThink(p, dt) {
  if (p.mode !== 'normal') return;   // 飛行/蓄力交給 simPlayer，別插手
  const st = botAI[p.id] || (botAI[p.id] = { target: null, path: [], arrived: false, wait: 0, repick: 0 });
  const lvl = BOT_LEVELS[p.level] || BOT_LEVELS.greedy;

  // 已站上目標格：站定、等反應延遲、能量夠就翻
  if (st.target && p.x === st.target.x && p.y === st.target.y) {
    p.heldDirs = [];
    if (cells[idx(p.x, p.y)].revealed) { st.target = null; return; }  // 被搶走/已翻 → 重挑
    if (!st.arrived) { st.arrived = true; st.wait = lvl.revealDelay; }
    st.wait -= dt;
    if (st.wait <= 0 && p.energy >= CONFIG.REVEAL_COST) { requestReveal(p); st.target = null; }
    return;
  }

  // 目標策略：撿到就走到、走到才翻。只有「無目標／被搶走／不可達」才重挑目標——
  // 否則定期只重算路徑（障礙可能被翻出）。若每 tick 亂換目標，random/貪婪會一直挑遠處
  // 隨機格→永遠走不到→永遠不翻（smart 因收斂到穩定高機率格才看似正常）。
  st.repick -= dt;
  const stale = st.target && cells[idx(st.target.x, st.target.y)].revealed;
  if (!st.target || stale) {
    botPickTarget(p, st); st.repick = 0.5;
  } else if (st.repick <= 0) {
    const { prev } = bfsFrom(p.x, p.y);
    const path = pathFromPrev(prev, st.target.x, st.target.y);
    if (path) st.path = path; else botPickTarget(p, st);   // 仍有效就只重算路徑，真的不可達才換
    st.repick = 0.5;
  }
  if (!st.target) { p.heldDirs = []; return; }

  // 沿路徑走：吃掉已抵達的節點，朝下一格設 heldDirs（交給 simPlayer 依 bot 自己的 slot/節奏走）
  while (st.path.length && st.path[0].x === p.x && st.path[0].y === p.y) st.path.shift();
  if (!st.path.length) { p.heldDirs = []; return; }
  const next = st.path[0];
  const dx = next.x - p.x, dy = next.y - p.y, dir = [sgn(dx), sgn(dy)];
  if (Math.abs(dx) + Math.abs(dy) > 1) {
    // 路徑上的跳躍段（中間是障礙）→ bot 自動蓄力跳越，略過 QTE
    p.heldDirs = [];
    const j = scanJump(p, dir);
    if (!j || j.landX !== next.x || j.landY !== next.y) { st.target = null; return; } // 盤面變了，重挑
    startCharge(p, dir, j); startFlight(p);
    return;
  }
  if (isObstacle(p.x + dir[0], p.y + dir[1])) { st.target = null; p.heldDirs = []; return; } // 路被堵，重挑
  p.heldDirs = [dir];
}
function cycleBot() {
  const i = BOT_ORDER.indexOf(botLevel.value);
  botLevel.value = BOT_ORDER[(i + 1) % BOT_ORDER.length];
  players[1].level = botLevel.value;
  botAI[players[1].id] = { target: null, path: [], arrived: false, wait: 0, repick: 0 };
}

function tick(dt) {
  if (!running.value || winner.value) {
    if (buffLooping) { buffLooping = false; stopBuffLoop(); }
    return;
  }
  // 換圖過場：定格 → 刷新 → 倒數（計時暫停、輸入鎖定）
  if (phase.value !== 'play') {
    if (buffLooping) { buffLooping = false; stopBuffLoop(); }
    for (const p of players) p.isMoving = false;
    phaseT -= dt;
    if (phase.value === 'freeze') {
      if (phaseT <= 0 && !props.online) doRefresh();   // 線上換圖由 server 的 map_reset 驅動
    } else { // countdown
      countNum.value = Math.max(1, Math.ceil(phaseT));
      if (phaseT <= 0) phase.value = 'play';
    }
    return;
  }
  elapsed.value += dt;
  for (const p of players) {
    if (p.isBot) botThink(p, dt);   // bot 先決定要往哪走/翻哪 → simPlayer 再依其 slot/節奏執行
    simPlayer(p, dt);
  }

  // 攝影機跟玩家本人（飛行中跟飛行軌跡，否則 lerp 跟腳下格）
  const p0 = players[0];
  if (p0.mode === 'flying' && p0.flight.active) {
    const t = Math.min(1, p0.flight.t);
    camX.value = p0.flight.fromX + (p0.flight.toX - p0.flight.fromX) * t;
    camY.value = p0.flight.fromY + (p0.flight.toY - p0.flight.fromY) * t;
  } else {
    const k = Math.min(1, dt * CONFIG.CAM_LERP);
    camX.value += (p0.x - camX.value) * k;
    camY.value += (p0.y - camY.value) * k;
  }
  const camMoving = Math.abs(camX.value - p0.x) > 0.05 || Math.abs(camY.value - p0.y) > 0.05;
  p0.isMoving = p0.isMoving || camMoving;

  // buff 律動音樂：跟著玩家本人的 buff 起訖
  if (isBuffActive(p0) && !buffLooping) { buffLooping = true; startBuffLoop(); }
  else if (!isBuffActive(p0) && buffLooping) { buffLooping = false; stopBuffLoop(); }

  if (props.online) sendMyPosition();   // 降頻送自己位置（走一格才送）
}
let lastSentX = -999, lastSentY = -999;
function sendMyPosition() {
  const m = players[0];
  if (m.x === lastSentX && m.y === lastSentY) return;
  lastSentX = m.x; lastSentY = m.y;
  net.send({ t: 'move', x: m.x, y: m.y });
}
function loop(t) {
  if (!lastT) lastT = t;
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  tick(dt);
  raf = requestAnimationFrame(loop);
}

// ---- 翻牌（走 net：送 reveal_req → 收 reveal 事件才套用）----
// 送出請求前先做本地檢查（已翻開/能量不足）求即時回饋；權威結果由 net 事件套用。
function requestReveal(p = players[0]) {
  if (winner.value || p.mode === 'flying' || phase.value !== 'play') return;
  const c = cells[idx(p.x, p.y)];
  if (!c) return;                        // 盤面還沒到（線上剛進場）
  if (c.revealed) { if (!p.isBot) message.value = '這格已經翻開了'; return; }
  if (p.energy < CONFIG.REVEAL_COST) {
    if (!p.isBot) { message.value = '能量不足，等回復…'; flash.value++; }
    showHead(p, '沒能量！', 'deny'); if (!p.isBot) playDeny();
    return;
  }
  net.send({ t: 'reveal_req', by: p.id, x: p.x, y: p.y });
}
// 權威事件套用
function onNetEvent(ev) {
  if (ev.t === 'board') { startRound(ev.seed, props.online ? false : pendingGrowth); pendingGrowth = false; return; }
  if (ev.t === 'map_reset') { startRound(ev.seed, true); return; }   // 線上換圖（成長）
  if (ev.t === 'reveal') { applyReveal(ev); return; }
  if (ev.t === 'position') { const p = playerById(ev.id); if (p && p.id !== myId) { p.x = ev.x; p.y = ev.y; } return; }
  if (ev.t === 'rt_over') {
    winner.value = true; winnerId.value = ev.winnerId; running.value = false;
    if (ev.scores) for (const p of players) if (ev.scores[p.id] != null) p.score = ev.scores[p.id];
    if (ev.winnerId === myId) playWin();
    return;
  }
}
function applyReveal(ev) {
  const p = playerById(ev.by);
  if (!p || ev.kind === 'blocked') return;
  // 依權威事件更新本地鏡像盤面
  const i = idx(ev.x, ev.y);
  cells[i].revealed = true;
  if (ev.kind === 'mine') cells[i].owner = ev.owner;
  if (ev.kind === 'zero' && ev.flooded) for (const fi of ev.flooded) cells[fi].revealed = true;
  // 個人效果（能量成本＋依 kind）
  p.energy -= CONFIG.REVEAL_COST; if (!p.isBot) message.value = '';
  if (ev.kind === 'reset') {
    message.value = p.id === myId ? '🔄 重置雷！換新圖' : `🔄 ${p.name || '對手'}踩到重置雷！換新圖`;
    for (const q of players) { q.heldDirs = []; q.jumpArm = null; q.armHint = ''; q.isMoving = false; }
    phase.value = 'freeze'; phaseT = CONFIG.RESET_FREEZE_SEC;
    playClaimSelf();
    return;
  }
  if (ev.kind === 'mine') {
    p.score++;
    p.boosts.push({ remain: CONFIG.MINE_REFUND });
    // 勝負：單機本地判、線上交給 server 的 rt_over（避免雙判）
    if (!props.online && p.score >= CONFIG.GOAL) { winner.value = true; winnerId.value = p.id; running.value = false; playWin(); return; }
    playClaimSelf();
    return;
  }
  if (ev.kind === 'zero') {
    p.energy = p.energyCap; p.moveSlots = p.maxSlots;
    p.buffUntil = elapsed.value + CONFIG.BUFF_SEC;
    showHead(p, '加速 ×2！', 'buff'); playBuff();
    return;
  }
  // number
  p.energy = Math.min(p.energyCap, p.energy + ev.adj / CONFIG.NUM_REFUND_DIV);
  if (!p.isBot) playReveal();
}
// 雙人共享 vs 個人（同盤搶雷的核心博弈）：
//   共享（掛在 cells）：翻開狀態、揭出的數字、claim 後的雷＝障礙、換圖（重置雷）。
//   個人（掛在 p）：分數、能量、移動 slot、翻 0 的加速 buff、能量退款。
//   → 翻 0 你補滿能量＋加速（個人），但 flood 揭出的數字兩人都看得到（共享）＝「幫對手看到情報」的取捨。
// ---- 跳躍 ----
function scanJump(p, dir) {
  let n = 0, x = p.x + dir[0], y = p.y + dir[1];
  while (inBoard(x, y) && isObstacle(x, y)) { n++; x += dir[0]; y += dir[1]; }
  if (n === 0) return null;             // 前方不是障礙
  if (!inBoard(x, y) || isObstacle(x, y)) return null; // 落地點不可站
  return { n, landX: x, landY: y };
}
function startCharge(p, dir, j) {
  p.mode = 'charging'; p.heldDirs = [];
  p.charge.dir = dir; p.charge.n = j.n; p.charge.landX = j.landX; p.charge.landY = j.landY;
  p.charge.need = Math.max(CONFIG.JUMP_BASE_PRESSES, 2 * j.n - 3); p.charge.count = 0;
  p.squat = true;
}
function cancelCharge(p) { p.mode = 'normal'; p.squat = false; }
function startFlight(p) {
  p.squat = false;
  const fdx = sgn(p.charge.landX - p.x); if (fdx) p.faceDir = fdx > 0 ? 1 : -1;
  p.flight.active = true; p.flight.fromX = p.x; p.flight.fromY = p.y;
  p.flight.toX = p.charge.landX; p.flight.toY = p.charge.landY; p.flight.n = p.charge.n; p.flight.t = 0;
  p.flight.dur = Math.max(CONFIG.JUMP_FLIGHT_MIN_SEC, p.charge.n / CONFIG.JUMP_FLIGHT_DIV);
  p.mode = 'flying';
  playClaimSelf();
}

const KEYMAP = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const inFormField = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT');
function onKey(e) {
  if (inFormField(e)) return;   // 調校面板輸入中 → 不當成移動/翻牌
  if (phase.value !== 'play') { if (KEYMAP[e.key] || e.key === ' ') e.preventDefault(); return; }
  const p = players[0];
  const dir = KEYMAP[e.key];
  if (dir) {
    e.preventDefault();
    if (p.mode === 'flying') return;
    if (p.mode === 'charging') {
      if (sameDir(dir, p.charge.dir)) { if (!e.repeat) p.squat = true; return; }
      cancelCharge(p); // 換方向 → 取消蓄力，往下走 normal
    }
    if (e.repeat) return;
    const nx = p.x + dir[0], ny = p.y + dir[1];
    if (inBoard(nx, ny) && isObstacle(nx, ny)) {
      const j = scanJump(p, dir);
      if (!j) { p.jumpArm = null; p.armHint = ''; return; } // 不能跳，擋住
      if (p.jumpArm && sameDir(p.jumpArm.dir, dir) && elapsed.value < p.jumpArm.until) {
        p.jumpArm = null; p.armHint = '';
        startCharge(p, dir, j);           // 第二次按同方向 → 進 QTE 蓄力
      } else {
        p.jumpArm = { dir, until: elapsed.value + CONFIG.JUMP_ARM_SEC };
        p.armHint = (DIR_LABEL[dir.join(',')] || {}).a || ''; // 緩衝：再按一次才跳
      }
      return;
    }
    p.jumpArm = null; p.armHint = '';
    p.heldDirs = p.heldDirs.filter((d) => !sameDir(d, dir));
    p.heldDirs.push(dir);                 // 不立即走，交給 rAF 依 interval 限速
    return;
  }
  if (e.key === 'f' || e.key === 'F' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); requestReveal(p); }
}
function onKeyUp(e) {
  if (inFormField(e)) return;
  const p = players[0];
  const dir = KEYMAP[e.key];
  if (!dir) return;
  if (p.mode === 'charging' && sameDir(dir, p.charge.dir)) {
    p.squat = false; p.charge.count++; p.ringKey++; playReveal();
    if (p.charge.count >= p.charge.need) startFlight(p);
    return;
  }
  p.heldDirs = p.heldDirs.filter((d) => !sameDir(d, dir));
}
const onBlur = () => {
  const p = players[0];
  p.heldDirs = []; p.jumpArm = null; p.armHint = '';
  if (p.mode === 'charging') cancelCharge(p);
};
const onResize = () => { winW.value = window.innerWidth; };
onMounted(() => {
  if (BOT_LEVELS[route.param]) botLevel.value = route.param;   // 大廳選的 bot 強度
  net.on(onNetEvent);                                          // 掛權威事件處理（board/reveal）
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
        <button v-if="!online" class="link-btn" @click="cycleBot" :title="'點擊切換 bot 強度'">{{ BOT_LEVELS[botLevel].label }}</button>
        <button class="link-btn" :class="{ on: showPanel }" @click="showPanel = !showPanel">🎛 調校</button>
        <button class="link-btn" :class="{ on: showRulers }" @click="showRulers = !showRulers">📐 尺規</button>
        <button v-if="!online" class="link-btn" @click="newGame">🔄 重開</button>
      </span>
    </div>

    <div class="time-row">
      <span class="time-box">⏱ {{ timeStr }}</span>
    </div>

    <!-- 雙人比分：同盤搶雷，各自累積 -->
    <div class="versus">
      <template v-for="(p, i) in players" :key="p.id">
        <span v-if="i > 0" class="vs-sep">vs</span>
        <span class="vs-chip" :class="{ lead: maxScore > 0 && p.score === maxScore }" :style="{ '--pc': p.color }">
          <span class="vs-dot"></span>
          <b class="vs-name">{{ playerLabel(p) }}</b>
          <b class="vs-score">{{ p.score }}</b>
          <span v-if="catchupT(p) > 0" class="vs-catch" :style="{ opacity: (0.55 + 0.45 * catchupT(p)).toFixed(2) }">🔥後追</span>
        </span>
      </template>
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
      <span class="hud-stat">🏃 <b>{{ moveRegen.toFixed(1) }}</b>/s</span>
      <span class="hud-stat" :class="{ warn: minesLeft <= CONFIG.RESET_TRIGGER }">本圖剩 <b>{{ minesLeft }}</b> 雷</span>
    </div>

    <div v-if="winner" class="runner-over">
      <div class="over-title" :style="{ color: (playerById(winnerId) || {}).color || PLAYER_COLORS[0] }">
        {{ winnerId === myId ? '🏆 你贏了！' : (online ? `😖 ${(playerById(winnerId) || {}).name || '對手'}贏了…` : '😖 電腦贏了…') }}
      </div>
      <div class="over-rows">
        <div v-for="p in players" :key="p.id" class="over-row" :class="{ win: p.id === winnerId }" :style="{ '--pc': p.color }">
          <span class="or-dot"></span>
          <span class="or-name">{{ playerLabel(p) }}</span>
          <b class="or-score">{{ p.score }}</b>
          <span class="or-goal">/ {{ CONFIG.GOAL }}</span>
          <span v-if="p.id === winnerId" class="or-crown">👑</span>
        </div>
      </div>
      <div class="over-meta">{{ loops }} 張圖・用時 {{ timeStr }}</div>
      <button v-if="!online" @click="newGame">再來一輪</button>
      <button v-else @click="navigate('/')">回大廳</button>
    </div>
    <template v-else>
      <div class="runner-turn">
        <span class="msg" v-if="me.mode === 'charging'">🟦 蓄力跳 {{ me.charge.count }}/{{ me.charge.need }}（連按同方向）</span>
        <span class="msg" v-else-if="message">{{ message }}</span>
        <span v-else-if="minesLeft <= CONFIG.RESET_TRIGGER">⚠ 最後幾顆，其中一顆是重置雷——翻到就換新圖</span>
        <span v-else>移動探索，站定翻開腳下格搶雷；翻到 0 補滿能量＋加速</span>
      </div>
      <div class="ctrl-bar">
        <button class="exec-btn" :disabled="me.energy < CONFIG.REVEAL_COST || me.mode !== 'normal'" @click="requestReveal()">🔍 翻開 (F)</button>
      </div>
    </template>

    <div class="viewport" :style="{ width: viewW + 'px', height: viewH + 'px' }">
      <div class="board" :style="boardStyle">
        <canvas ref="boardCanvas" class="bcanvas"></canvas>
        <!-- 對手：畫在盤面座標上，隨鏡頭一起投影（自己另外固定畫面中央） -->
        <template v-for="p in players" :key="p.id">
          <div v-if="p.id !== me.id" class="board-actor" v-show="phase !== 'freeze'" :style="boardActorStyle(p)">
            <RunnerActor :player="p" :elapsed="elapsed" :cellPx="cellPx" :charW="charW" :charH="charH"
              :phase="phase" :buffSec="CONFIG.BUFF_SEC" :arcRatio="CONFIG.JUMP_ARC_RATIO" />
          </div>
        </template>
      </div>
      <!-- 撞障礙緩衝：再按一次才跳 -->
      <div v-if="me.armHint && me.mode === 'normal'" class="arm-hint">再按 <b>{{ me.armHint }}</b> 跳越</div>
      <!-- 蓄力 QTE 提示 -->
      <div v-if="me.mode === 'charging'" class="qte">
        <div class="qte-title">蓄力跳越！狂按</div>
        <div class="qte-key" :key="me.ringKey">{{ chargeKey.k }} <small>{{ chargeKey.a }}</small></div>
        <div class="qte-bar"><span :style="{ width: chargePct + '%' }"></span></div>
        <div class="qte-count">{{ me.charge.count }} / {{ me.charge.need }}</div>
      </div>
      <!-- 自己固定畫面中央，地圖在底下捲動 -->
      <div class="actor" v-show="phase !== 'freeze'">
        <RunnerActor :player="players[0]" :elapsed="elapsed" :cellPx="cellPx" :charW="charW" :charH="charH"
          :phase="phase" :buffSec="CONFIG.BUFF_SEC" :arcRatio="CONFIG.JUMP_ARC_RATIO" />
      </div>
      <!-- 換圖過場 -->
      <div v-if="phase === 'freeze'" class="scoreboard">
        <div class="sb-title">🔄 重置雷・換圖</div>
        <div class="sb-versus">
          <template v-for="(p, i) in players" :key="p.id">
            <span v-if="i > 0" class="sb-colon">:</span>
            <span class="sb-side" :class="{ ahead: maxScore > 0 && p.score === maxScore }" :style="{ '--pc': p.color }">
              <b>{{ p.score }}</b><small>{{ online ? (p.id === myId ? '你' : (p.name || ('P' + p.id))) : (p.isBot ? '電腦' : '你') }}</small>
            </span>
          </template>
        </div>
        <div class="sb-time">{{ CONFIG.GOAL }} 顆過關・用時 {{ timeStr }}</div>
        <div class="sb-loop">第 {{ loops }} 張完成 → 進入下一張</div>
      </div>
      <div v-else-if="phase === 'countdown'" class="overlay countdown">{{ countNum }}</div>
    </div>

    <p class="runner-help">
      <b>移動</b>：按住 <b>WASD</b> 連續走。<b>翻開</b>：站定按 <b>F／空白／Enter</b>，耗 1 ⚡。
      已翻開的雷會<b>擋路</b>，朝它<b>連按同方向蓄力跳</b>越過（後方要有空地）。
      中 <b>0</b> → 補滿 ⚡＋加速 {{ CONFIG.BUFF_SEC }}s；剩最後幾顆出現<b>重置雷</b>翻到換圖，搶滿 {{ CONFIG.GOAL }} 顆過關。
    </p>

    <!-- 調校面板：即時生效（滑桿改 CONFIG，reactive → 下一幀套用），遊戲不暫停 -->
    <div v-if="showPanel" class="tune-panel">
      <div class="tune-head">
        🎛 調校面板
        <span class="tune-actions">
          <button class="link-btn" @click="exportConfig">⧉ 匯出</button>
          <button class="link-btn" @click="resetConfig">↺ 預設</button>
          <button class="link-btn" @click="newGame">套用並重開</button>
          <button class="link-btn" @click="showPanel = false">✕</button>
        </span>
      </div>
      <div class="tune-hint">滑桿即時生效（下一幀）</div>
      <div v-if="exportText" class="tune-export">
        <div class="tune-export-head">{{ exportCopied ? '✅ 已複製到剪貼簿' : '選取複製：' }}</div>
        <textarea class="tune-export-box" readonly rows="6" :value="exportText" @focus="(e) => e.target.select()"></textarea>
      </div>
      <div v-for="g in TUNE_GROUPS" :key="g.title" class="tune-group">
        <div class="tune-gtitle">{{ g.title }}</div>
        <label v-for="it in g.items" :key="it.key" class="tune-row">
          <span class="tune-label">{{ it.label }}</span>
          <input type="range" :min="it.min" :max="it.max" :step="it.step" v-model.number="CONFIG[it.key]" />
          <input type="number" class="tune-num" :min="it.min" :max="it.max" :step="it.step" v-model.number="CONFIG[it.key]" />
        </label>
      </div>
      <div class="tune-group">
        <div class="tune-gtitle">bot（{{ BOT_LEVELS[botLevel].label }}）</div>
        <label class="tune-row">
          <span class="tune-label">翻牌反應(s)</span>
          <input type="range" min="0" max="1" step="0.02" v-model.number="BOT_LEVELS[botLevel].revealDelay" />
          <input type="number" class="tune-num" min="0" max="1" step="0.02" v-model.number="BOT_LEVELS[botLevel].revealDelay" />
        </label>
      </div>
      <div class="tune-group">
        <div class="tune-gtitle">結構（需「套用並重開」或下一張）</div>
        <label v-for="it in TUNE_STRUCT" :key="it.key" class="tune-row struct">
          <span class="tune-label">{{ it.label }}</span>
          <input type="range" :min="it.min" :max="it.max" :step="it.step" v-model.number="CONFIG[it.key]" />
          <input type="number" class="tune-num" :min="it.min" :max="it.max" :step="it.step" v-model.number="CONFIG[it.key]" />
        </label>
      </div>
    </div>

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
.versus { display: flex; align-items: center; gap: 10px; }
.vs-chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px;
  border: 2px solid color-mix(in srgb, var(--pc) 45%, #d3dae2); background: #fff;
  font-variant-numeric: tabular-nums; transition: border-color .2s, box-shadow .2s;
}
.vs-chip.lead { border-color: var(--pc); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pc) 22%, transparent); }
.vs-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--pc); }
.vs-name { font-size: 13px; color: #445; font-weight: 700; }
.vs-score { font-size: 20px; color: var(--pc); font-weight: 900; min-width: 20px; text-align: center; }
.vs-sep { font-size: 12px; font-weight: 700; color: #99a; letter-spacing: 1px; }
.vs-catch {
  font-size: 11px; font-weight: 800; color: #d9480f; padding: 1px 6px; border-radius: 999px;
  background: #fff2e8; border: 1px solid #ffb388; animation: catch-pulse 1s ease-in-out infinite;
}
@keyframes catch-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
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
.runner-over {
  display: flex; flex-direction: column; align-items: center; gap: 9px;
  padding: 16px 26px; border-radius: 14px; background: #fff;
  box-shadow: 0 8px 26px rgba(0, 0, 0, .16); border: 1px solid #e3e8ee;
}
.over-title { font-size: 24px; font-weight: 900; }
.over-rows { display: flex; flex-direction: column; gap: 6px; width: 100%; min-width: 250px; }
.over-row {
  display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 9px;
  background: #f5f7fa; opacity: .68; transition: opacity .2s;
}
.over-row.win { opacity: 1; background: color-mix(in srgb, var(--pc) 12%, #fff); box-shadow: inset 0 0 0 2px var(--pc); }
.or-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--pc); }
.or-name { font-size: 14px; font-weight: 700; color: #445; flex: 1; }
.or-score { font-size: 22px; font-weight: 900; color: var(--pc); font-variant-numeric: tabular-nums; }
.or-goal { font-size: 12px; color: #9aa; }
.or-crown { font-size: 17px; }
.over-meta { font-size: 13px; color: #778; font-variant-numeric: tabular-nums; }
.runner-over button { margin-top: 2px; padding: 6px 20px; font-weight: 700; }
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
  position: absolute; will-change: transform; transform-style: preserve-3d;
}
.bcanvas { display: block; } /* 單一 canvas 畫整片盤面，無 3D grid 接縫 */
/* 對手 anchor：定位到盤面格中心，反轉 board 傾斜（角色/HUD 站直）；0 尺寸 anchor */
.board-actor { position: absolute; width: 0; height: 0; transform-style: preserve-3d; }
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
/* 自己：固定畫面中央的 0 尺寸 anchor（角色視覺在 RunnerActor 元件內） */
.actor { position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; z-index: 6; }
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
.sb-versus { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 6px; }
.sb-side { display: flex; flex-direction: column; align-items: center; line-height: 1; opacity: .72; transition: opacity .2s; }
.sb-side.ahead { opacity: 1; }
.sb-side b { font-size: 32px; font-weight: 900; color: var(--pc); font-variant-numeric: tabular-nums; }
.sb-side small { font-size: 11px; color: #9fb4c8; margin-top: 3px; }
.sb-colon { font-size: 24px; font-weight: 900; color: #6b7d90; }
.sb-time { font-size: 15px; color: #6cf; font-variant-numeric: tabular-nums; margin-top: 4px; }
.sb-loop { font-size: 12px; color: #9fb4c8; margin-top: 3px; }
@keyframes freeze-in { from { transform: translateX(-50%) scale(.8); opacity: 0; } }
.runner-help { font-size: 12px; color: #777; max-width: 560px; text-align: center; line-height: 1.6; }
/* 調校面板：固定右側、可捲動，不擋盤面（遊戲照跑） */
.tune-panel {
  position: fixed; top: 8px; right: 8px; z-index: 60; width: 280px; max-height: calc(100vh - 16px);
  overflow-y: auto; padding: 10px 12px; border-radius: 12px;
  background: rgba(255, 255, 255, .97); box-shadow: 0 8px 30px rgba(0, 0, 0, .22); border: 1px solid #dfe5ec;
  font-size: 12px;
}
.tune-head { display: flex; align-items: center; justify-content: space-between; font-weight: 800; font-size: 14px; }
.tune-actions { display: flex; gap: 6px; }
.tune-actions .link-btn { font-size: 11px; }
.tune-hint { color: #8a94a0; font-size: 11px; margin: 2px 0 6px; }
.tune-export { margin: 4px 0 2px; }
.tune-export-head { font-size: 11px; color: #2a8a4a; font-weight: 700; margin-bottom: 3px; }
.tune-export-box {
  width: 100%; font-family: ui-monospace, Menlo, monospace; font-size: 10px; line-height: 1.4;
  border: 1px solid #cdd7e2; border-radius: 6px; padding: 6px; resize: vertical; color: #334;
}
.tune-group { border-top: 1px solid #eef1f5; padding-top: 6px; margin-top: 6px; }
.tune-gtitle { font-weight: 700; color: #2a6fd6; margin-bottom: 4px; }
.tune-row { display: grid; grid-template-columns: 92px 1fr 46px; align-items: center; gap: 6px; margin: 3px 0; }
.tune-row.struct { opacity: .9; }
.tune-label { color: #556; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tune-row input[type="range"] { width: 100%; accent-color: #2a6fd6; }
.tune-num {
  width: 46px; padding: 2px 4px; font-size: 11px; text-align: right;
  border: 1px solid #cdd7e2; border-radius: 4px; font-variant-numeric: tabular-nums;
}
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
