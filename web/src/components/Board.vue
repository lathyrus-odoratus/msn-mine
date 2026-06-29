<script setup>
import { computed } from 'vue';
import { state, clickCell } from '../useGame.js';
import BoardView from './BoardView.vue';

const myTurn = computed(() => state.phase === 'playing' && state.turn === state.you);
</script>

<template>
  <BoardView
    :board="state.board"
    :width="state.width"
    :styles="state.styles"
    :lastMove="state.lastMove"
    :clickable="myTurn"
    @cell="clickCell"
  />
</template>
