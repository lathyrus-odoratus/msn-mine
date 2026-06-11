<script setup>
import { computed } from 'vue';
import { state, clickCell } from '../useGame.js';

const myTurn = computed(() => state.phase === 'playing' && state.turn === state.you);

function cellClass(cell, x, y) {
  const cls = [];
  if (cell === null) {
    cls.push('hidden');
    if (myTurn.value) cls.push('clickable');
  } else if (cell.mine) {
    cls.push('revealed', cell.owner === null ? 'mine-unclaimed' : `mine-${cell.owner}`);
  } else {
    cls.push('revealed', `n${cell.adj}`);
  }
  if (state.lastMove && state.lastMove.x === x && state.lastMove.y === y) cls.push('last-move');
  return cls;
}

function cellText(cell) {
  if (cell === null) return '';
  if (cell.mine) return cell.owner === null ? '💣' : '⚑';
  return cell.adj > 0 ? String(cell.adj) : '';
}
</script>

<template>
  <div
    class="board"
    :style="{ gridTemplateColumns: `repeat(${state.width}, 1fr)` }"
    :class="{ 'not-my-turn': !myTurn }"
  >
    <template v-for="(row, y) in state.board" :key="y">
      <div
        v-for="(cell, x) in row"
        :key="`${x},${y}`"
        class="cell"
        :class="cellClass(cell, x, y)"
        @click="clickCell(x, y)"
      >{{ cellText(cell) }}</div>
    </template>
  </div>
</template>
