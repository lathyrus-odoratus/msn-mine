<script setup>
import { onMounted, ref } from 'vue';
import { state, requestRematch, backToLobby, resumeIfPossible, roomLink } from './useGame.js';
import Lobby from './components/Lobby.vue';
import Board from './components/Board.vue';
import ScorePanel from './components/ScorePanel.vue';

onMounted(resumeIfPossible);

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
      <span>對戰踩地雷 — Minesweeper Flags</span>
    </div>

    <div class="content">
      <div v-if="state.reconnecting" class="banner">🔌 連線中斷，重新連線中…</div>
      <div v-else-if="state.opponentOffline" class="banner">⏳ 對手斷線了，等待重連…</div>
      <div v-if="state.isSpectator && state.phase !== 'lobby'" class="spectator-bar">
        👁 觀戰中（唯讀）<span v-if="state.spectatorCount">・共 {{ state.spectatorCount }} 人觀戰</span>
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
        <div v-if="!state.isSpectator && state.spectatorCount" class="watchers">
          👁 {{ state.spectatorCount }} 人觀戰中
        </div>
        <ScorePanel />
        <Board />

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
  </div>
</template>
