<script setup>
import { computed } from 'vue';
import { state } from '../useGame.js';

const myTurn = computed(() => state.phase === 'playing' && state.turn === state.you);
</script>

<template>
  <div class="score-panel">
    <div
      v-for="p in [0, 1]"
      :key="p"
      class="player-card"
      :class="[`player-${p}`, { active: state.phase === 'playing' && state.turn === p }]"
    >
      <span class="flag" :class="`flag-${p}`">⚑</span>
      <span class="player-name">
        {{ state.names[p] }}<small v-if="state.you === p">（你）</small>
      </span>
      <span class="player-score">{{ state.scores[p] }}</span>
    </div>
    <div class="turn-hint" v-if="state.phase === 'playing'">
      {{ myTurn ? '輪到你了！' : '對手思考中…' }}
    </div>
  </div>
</template>
