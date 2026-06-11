<script setup>
import { state, requestRematch, backToLobby } from './useGame.js';
import Lobby from './components/Lobby.vue';
import Board from './components/Board.vue';
import ScorePanel from './components/ScorePanel.vue';
</script>

<template>
  <div class="window">
    <div class="titlebar">
      <span class="titlebar-icon">💣</span>
      <span>對戰踩地雷 — Minesweeper Flags</span>
    </div>

    <div class="content">
      <Lobby v-if="state.phase === 'lobby'" />

      <div v-else-if="state.phase === 'waiting'" class="waiting">
        <p>房間已建立，把房號告訴對手：</p>
        <div class="room-code">{{ state.code }}</div>
        <p class="hint">等待對手加入中…</p>
      </div>

      <template v-else>
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
