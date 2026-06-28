<script setup>
import { computed } from 'vue';
import { state } from '../useGame.js';
import { identiconUri } from '../identicon.js';

const myTurn = computed(() => state.phase === 'playing' && state.turn === state.you);
const flagBg = computed(() => state.styles.map((s) => identiconUri(s.seed, s.color)));
</script>

<template>
  <div class="score-panel">
    <div
      v-for="p in [0, 1]"
      :key="p"
      class="player-card"
      :class="{ active: state.phase === 'playing' && state.turn === p }"
      :style="{ color: state.styles[p].color }"
    >
      <span class="flag-swatch" :style="{ backgroundImage: flagBg[p] }" />
      <span class="player-name">
        {{ state.names[p] }}<small v-if="state.you === p">（你）</small>
      </span>
      <span class="player-score">{{ state.scores[p] }}</span>
    </div>
    <div class="turn-hint" v-if="state.phase === 'playing'">
      <template v-if="state.isSpectator">輪到 {{ state.names[state.turn] }}</template>
      <template v-else>{{ myTurn ? '輪到你了！' : '對手思考中…' }}</template>
    </div>
  </div>
</template>
