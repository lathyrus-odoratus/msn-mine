<script setup>
import { onMounted, ref, watch } from 'vue';
import { state, requestRematch, backToLobby, resumeIfPossible, roomLink, renameSelf } from './useGame.js';
import { route, navigate } from './router.js';
import Lobby from './components/Lobby.vue';
import Board from './components/Board.vue';
import ScorePanel from './components/ScorePanel.vue';
import Taunts from './components/Taunts.vue';
import Help from './components/Help.vue';
import Replays from './components/Replays.vue';
import RoomList from './components/RoomList.vue';
import MineRunner from './components/MineRunner.vue';
import { sound, toggleMuted } from './sound.js';

onMounted(resumeIfPossible);

const showHelp = ref(false);

// 首頁「進行中(n)」的房間數：載入大廳時抓一次
const roomCount = ref(0);
async function refreshRoomCount() {
  try { roomCount.value = (await (await fetch('/api/rooms')).json()).length; } catch { roomCount.value = 0; }
}
onMounted(refreshRoomCount);
watch(() => route.name, (n) => { if (n === 'home') refreshRoomCount(); });

const editingName = ref(false);
const nameDraft = ref('');
function startEditName() {
  nameDraft.value = state.myName;
  editingName.value = true;
}
function commitName() {
  renameSelf(nameDraft.value);
  editingName.value = false;
}

const copied = ref(false);
async function copyLink() {
  try {
    await navigator.clipboard.writeText(roomLink(state.code));
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <div class="window">
    <div class="titlebar">
      <span class="titlebar-icon">💣</span>
      <span class="titlebar-name">對戰踩地雷 — Minesweeper Flags</span>
      <button class="titlebar-help" @click="toggleMuted" :title="sound.muted ? '開啟音效' : '關閉音效'">
        {{ sound.muted ? '🔇' : '🔊' }}
      </button>
      <button class="titlebar-help" @click="showHelp = true">❔ 玩法</button>
    </div>

    <div class="content">
      <div v-if="state.reconnecting" class="banner">🔌 連線中斷，重新連線中…</div>
      <div v-else-if="state.opponentOffline" class="banner">⏳ 對手斷線了，等待重連…</div>

      <!-- 自己的暱稱（玩家＋觀戰者皆可隨時改名） -->
      <div v-if="state.phase !== 'lobby' && state.myName" class="self-name">
        <span class="role-tag">{{ state.isSpectator ? '👁 觀戰中' : '你' }}</span>
        <template v-if="!editingName">
          <strong>{{ state.myName }}</strong>
          <button class="link-btn" @click="startEditName">✏️ 改名</button>
        </template>
        <template v-else>
          <input
            v-model="nameDraft"
            maxlength="12"
            class="name-edit"
            @keyup.enter="commitName"
            @keyup.esc="editingName = false"
          />
          <button class="link-btn" @click="commitName">確定</button>
          <button class="link-btn" @click="editingName = false">取消</button>
        </template>
      </div>

      <!-- 觀戰名單（全房可見） -->
      <div v-if="state.phase !== 'lobby' && state.spectatorCount" class="watchers">
        👁 {{ state.spectatorCount }} 人觀戰：{{ state.spectatorNames.join('、') }}
      </div>

      <template v-if="state.phase === 'lobby'">
        <MineRunner v-if="route.name === 'runner'" />
        <RoomList v-else-if="route.name === 'rooms'" @back="navigate('/')" />
        <Replays
          v-else-if="route.name === 'replays' || route.name === 'replay'"
          :openId="route.name === 'replay' ? route.param : null"
          @close="navigate('/')"
          @open="(id) => navigate('/replays/' + id)"
          @list="navigate('/replays')"
        />
        <template v-else>
          <Lobby />
          <div class="lobby-links">
            <button class="link-btn" @click="navigate('/rooms')">🟢 進行中（{{ roomCount }}）</button>
            <button class="link-btn" @click="navigate('/replays')">📜 看最近對局回放</button>
            <button class="link-btn" @click="navigate('/runner')">🧪 探雷模式（原型）</button>
          </div>
        </template>
      </template>

      <div v-else-if="state.phase === 'waiting'" class="waiting">
        <p>房間已建立，把連結或房號傳給對手：</p>
        <div class="room-code">{{ state.code }}</div>
        <button class="copy-link" @click="copyLink">
          {{ copied ? '✅ 已複製連結' : '🔗 複製邀請連結' }}
        </button>
        <p class="hint">等待對手加入中…</p>
      </div>

      <template v-else>
        <ScorePanel />
        <Board />
        <Taunts />

        <div v-if="state.phase === 'over'" class="overlay-bar">
          <template v-if="state.winner !== null">
            <!-- 旁觀者只看結果，不顯示「你贏/你輸」 -->
            <strong v-if="state.isSpectator" class="win">🏁 {{ state.names[state.winner] }} 獲勝！</strong>
            <strong v-else-if="state.winner === state.you" class="win">🎉 你贏了！</strong>
            <strong v-else class="lose">😵 你輸了…</strong>
          </template>
          <span v-if="state.notice" class="notice">{{ state.notice }}</span>

          <!-- 旁觀者沒有「再來一局」 -->
          <template v-if="!state.isSpectator && !state.opponentLeft">
            <button v-if="!state.rematchSent" @click="requestRematch">
              再來一局{{ state.opponentWantsRematch ? '（對手已就緒）' : '' }}
            </button>
            <span v-else class="hint">等待對手同意…</span>
          </template>
          <button class="secondary" @click="backToLobby">回大廳</button>
        </div>
      </template>

      <p v-if="state.error" class="error">{{ state.error }}</p>
    </div>

    <Help v-if="showHelp" @close="showHelp = false" />
  </div>
</template>
