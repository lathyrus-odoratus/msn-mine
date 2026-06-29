<script setup>
import { computed } from 'vue';
import { identiconUri } from '../identicon.js';

// 純呈現的棋盤：live 對局與 replay 共用。不碰全域 state，一切走 props。
const props = defineProps({
  board: { type: Array, required: true }, // board[y][x] = null | {mine,owner} | {mine:false,adj}
  width: { type: Number, required: true },
  styles: { type: Array, required: true }, // [{color,seed},{color,seed}]
  lastMove: { type: Object, default: null },
  clickable: { type: Boolean, default: false }, // 是否可點（live 輪到自己時）
});
defineEmits(['cell']);

const flagBg = computed(() => props.styles.map((s) => identiconUri(s.seed, s.color)));

function cellClass(cell, x, y) {
  const cls = [];
  if (cell === null) {
    cls.push('hidden');
    if (props.clickable) cls.push('clickable');
  } else if (cell.mine) {
    cls.push('revealed', cell.owner === null ? 'mine-unclaimed' : 'mine-owned');
  } else {
    cls.push('revealed', `n${cell.adj}`);
  }
  if (props.lastMove && props.lastMove.x === x && props.lastMove.y === y) cls.push('last-move');
  return cls;
}

function cellStyle(cell) {
  if (cell && cell.mine && cell.owner !== null) {
    return { backgroundImage: flagBg.value[cell.owner], backgroundSize: '100% 100%' };
  }
  return null;
}

function cellText(cell) {
  if (cell === null) return '';
  if (cell.mine) return cell.owner === null ? '💣' : '';
  return cell.adj > 0 ? String(cell.adj) : '';
}
</script>

<template>
  <div
    class="board"
    :style="{ gridTemplateColumns: `repeat(${width}, 1fr)` }"
    :class="{ 'not-my-turn': !clickable }"
  >
    <template v-for="(row, y) in board" :key="y">
      <div
        v-for="(cell, x) in row"
        :key="`${x},${y}`"
        class="cell"
        :class="cellClass(cell, x, y)"
        :style="cellStyle(cell)"
        @click="$emit('cell', x, y)"
      >{{ cellText(cell) }}</div>
    </template>
  </div>
</template>
