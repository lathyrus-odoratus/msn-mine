<script setup>
// 探雷連線對戰・大廳（配對）：建房 / 輸碼加入 / 公開房列表 → 等待室 → 開始 → 交棒 MineRunner。
// 擁有 ws net；開局後把同一個 net 注入 MineRunner（線上模式）。
import { ref, onMounted, onUnmounted } from 'vue';
import { navigate } from '../router.js';
import { createWsNet } from '../net-ws.js';
import MineRunner from './MineRunner.vue';

const stage = ref('menu');        // 'menu' | 'waiting' | 'playing'
const name = ref(localStorage.getItem('runnerName') || '');
const joinCode = ref(new URLSearchParams(location.search).get('room') || '');
const roomCode = ref('');
const roster = ref([]);
const isHost = ref(false);
const errorMsg = ref('');
const rooms = ref([]);
const copied = ref(false);

const net = createWsNet();
let connectPromise = null;
const ensureConn = () => (connectPromise || (connectPromise = net.connect()));

net.onLobby((m) => {
  if (m.type === 'error') { errorMsg.value = m.message || '發生錯誤'; return; }
  if (m.type === 'rt_created') { roomCode.value = m.code; isHost.value = true; stage.value = 'waiting'; }
  else if (m.type === 'rt_joined') { roomCode.value = m.code; stage.value = 'waiting'; }
  else if (m.type === 'rt_lobby') { roster.value = m.players; }
  else if (m.type === 'rt_started') { roster.value = m.players; errorMsg.value = ''; stage.value = 'playing'; }
  else if (m.type === 'rt_left') { roster.value = roster.value.filter((p) => p.id !== m.id); }
  else if (m.type === 'ws_closed') { if (stage.value !== 'playing') errorMsg.value = '連線中斷了'; }
});

function saveName() {
  if (!name.value.trim()) name.value = '玩家' + Math.floor(Math.random() * 1000);
  localStorage.setItem('runnerName', name.value.trim());
}
async function createRoom() {
  saveName(); errorMsg.value = '';
  try { await ensureConn(); } catch { errorMsg.value = '連不上伺服器'; return; }
  net.create({ name: name.value.trim(), cfg: { W: 12, H: 12, MINES: 30, GOAL: 60, RESET_TRIGGER: 8 } });
}
async function joinRoom(code) {
  saveName(); errorMsg.value = '';
  const c = String(code || joinCode.value).toUpperCase().trim();
  if (c.length !== 4) { errorMsg.value = '房號是 4 碼英數'; return; }
  try { await ensureConn(); } catch { errorMsg.value = '連不上伺服器'; return; }
  net.join({ code: c, name: name.value.trim() });
}
function startGame() { net.start(); }
function leaveRoom() { net.close(); connectPromise = null; roster.value = []; isHost.value = false; stage.value = 'menu'; }

const shareLink = () => `${location.origin}/runner-vs?room=${roomCode.value}`;
async function copyLink() {
  try { await navigator.clipboard.writeText(shareLink()); copied.value = true; setTimeout(() => (copied.value = false), 1500); } catch { copied.value = false; }
}
async function refreshRooms() {
  try { rooms.value = (await (await fetch('/api/rt-rooms')).json()).filter((r) => !r.started); } catch { rooms.value = []; }
}
onMounted(refreshRooms);
onUnmounted(() => net.close());
</script>

<template>
  <div class="rlobby">
    <div class="runner-bar">
      <button class="link-btn" @click="navigate('/')">← 回大廳</button>
      <strong>💣 探雷・連線對戰</strong>
      <span></span>
    </div>

    <p v-if="errorMsg" class="rl-error">⚠ {{ errorMsg }}</p>

    <!-- 選單：建房 / 加入 / 公開房 -->
    <template v-if="stage === 'menu'">
      <label class="rl-name">
        暱稱 <input v-model="name" maxlength="12" placeholder="你的名字" @keyup.enter="createRoom" />
      </label>

      <div class="rl-actions">
        <button class="rl-primary" @click="createRoom">➕ 建立房間</button>
        <div class="rl-join">
          <input v-model="joinCode" maxlength="4" placeholder="房號" class="rl-code-input" @keyup.enter="joinRoom()" />
          <button class="rl-secondary" @click="joinRoom()">🔑 加入</button>
        </div>
      </div>

      <div class="rl-rooms">
        <div class="rl-rooms-head">
          <span>公開房間</span>
          <button class="link-btn" @click="refreshRooms">🔄 刷新</button>
        </div>
        <div v-if="!rooms.length" class="rl-empty">目前沒有等待中的房間——建一間吧</div>
        <div v-for="r in rooms" :key="r.code" class="rl-room-row">
          <b class="rl-room-code">{{ r.code }}</b>
          <span class="rl-room-players">{{ r.players.join('、') || '（空）' }}</span>
          <button class="rl-secondary" @click="joinRoom(r.code)">加入</button>
        </div>
      </div>
    </template>

    <!-- 等待室 -->
    <template v-else-if="stage === 'waiting'">
      <div class="rl-waiting">
        <div class="rl-code-box">
          房號 <b>{{ roomCode }}</b>
          <button class="link-btn" @click="copyLink">{{ copied ? '✅ 已複製連結' : '🔗 複製邀請連結' }}</button>
        </div>
        <div class="rl-roster">
          <div v-for="p in roster" :key="p.id" class="rl-player" :style="{ '--pc': ['#1d5fd6','#e5533c','#2ca02c','#9467bd','#e6a817','#17becf'][p.id % 6] }">
            <span class="rl-dot"></span>{{ p.name }}<span v-if="p.id === net.localId" class="rl-you">（你）</span>
          </div>
        </div>
        <div class="rl-waiting-actions">
          <button v-if="isHost" class="rl-primary" @click="startGame">▶ 開始（{{ roster.length }} 人）</button>
          <span v-else class="rl-hint">等房主開始…</span>
          <button class="rl-secondary" @click="leaveRoom">離開</button>
        </div>
        <p class="rl-tip">把房號或連結傳給朋友，人到齊房主按開始。同盤搶雷、先到 GOAL 勝。</p>
      </div>
    </template>

    <!-- 開打：交棒給 MineRunner（線上模式，注入同一個 net） -->
    <MineRunner v-else :net="net" :roster="roster" :online="true" />
  </div>
</template>

<style scoped>
.rlobby { display: flex; flex-direction: column; gap: 14px; align-items: center; padding: 8px 4px 16px; max-width: 560px; margin: 0 auto; }
.runner-bar { display: flex; align-items: center; gap: 14px; width: 100%; justify-content: space-between; }
.rl-error { color: #c2185b; font-size: 14px; background: #fff0f5; padding: 6px 12px; border-radius: 6px; }
.rl-name { font-size: 14px; display: flex; align-items: center; gap: 8px; width: 100%; }
.rl-name input { flex: 1; padding: 6px 10px; border: 1px solid #cdd7e2; border-radius: 6px; font-size: 15px; }
.rl-actions { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.rl-join { display: flex; gap: 8px; }
.rl-code-input { flex: 1; padding: 8px 10px; border: 1px solid #cdd7e2; border-radius: 8px; font-size: 18px; text-transform: uppercase; letter-spacing: 3px; text-align: center; }
.rl-primary { padding: 10px 16px; font-size: 16px; font-weight: 800; background: #2a6fd6; color: #fff; border-radius: 8px; }
.rl-secondary { padding: 8px 14px; font-weight: 700; background: #eef2f7; border: 1px solid #cdd7e2; border-radius: 8px; }
.rl-rooms { width: 100%; border-top: 1px solid #e5e9ee; padding-top: 10px; }
.rl-rooms-head { display: flex; justify-content: space-between; align-items: center; font-weight: 700; color: #556; margin-bottom: 6px; }
.rl-empty { color: #99a; font-size: 13px; padding: 10px; text-align: center; }
.rl-room-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 8px; }
.rl-room-row:hover { background: #f5f7fa; }
.rl-room-code { font-size: 18px; letter-spacing: 2px; font-variant-numeric: tabular-nums; }
.rl-room-players { flex: 1; color: #667; font-size: 13px; }
.rl-waiting { display: flex; flex-direction: column; gap: 14px; align-items: center; width: 100%; }
.rl-code-box { font-size: 16px; display: flex; align-items: center; gap: 12px; }
.rl-code-box b { font-size: 30px; letter-spacing: 5px; color: #2a6fd6; font-variant-numeric: tabular-nums; }
.rl-roster { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 320px; }
.rl-player { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: #f5f7fa; border: 1px solid #e0e6ee; font-weight: 700; }
.rl-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--pc); }
.rl-you { color: #2a6fd6; font-size: 13px; }
.rl-waiting-actions { display: flex; gap: 12px; align-items: center; }
.rl-hint { color: #778; }
.rl-tip { font-size: 12px; color: #889; text-align: center; max-width: 400px; }
</style>
