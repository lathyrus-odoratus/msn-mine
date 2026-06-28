<script setup>
import { onMounted, ref } from 'vue';
import { state, requestRematch, backToLobby, resumeIfPossible, roomLink, renameSelf } from './useGame.js';
import Lobby from './components/Lobby.vue';
import Board from './components/Board.vue';
import ScorePanel from './components/ScorePanel.vue';
import Taunts from './components/Taunts.vue';
import Help from './components/Help.vue';

onMounted(resumeIfPossible);

const showHelp = ref(false);

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

      <Lobby v-if="state.phase === 'lobby'" />

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
            <strong v-if="state.winner === state.you" class="win">🎉 你贏了！</strong>
            <strong v-else class="lose">😵 你輸了…</strong>
          </template>
          <span v-if="state.notice" class="notice">{{ state.notice }}</span>

          <template v-if="!state.opponentLeft">
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
