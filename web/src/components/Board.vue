<script setup>
import { computed } from 'vue';
import { state, clickCell } from '../useGame.js';
import { identiconUri } from '../identicon.js';

const myTurn = computed(() => state.phase === 'playing' && state.turn === state.you);

// 兩位玩家的旗子方塊背景（顏色 + 花紋），styles 變動時重算
const flagBg = computed(() => state.styles.map((s) => identiconUri(s.seed, s.color)));

function cellClass(cell, x, y) {
  const cls = [];
  if (cell === null) {
    cls.push('hidden');
    if (myTurn.value) cls.push('clickable');
  } else if (cell.mine) {
    cls.push('revealed', cell.owner === null ? 'mine-unclaimed' : 'mine-owned');
  } else {
    cls.push('revealed', `n${cell.adj}`);
  }
  if (state.lastMove && state.lastMove.x === x && state.lastMove.y === y) cls.push('last-move');
  return cls;
}

// 搶到的雷：以該玩家的滿版旗子方塊呈現
function cellStyle(cell) {
  if (cell && cell.mine && cell.owner !== null) {
    return { backgroundImage: flagBg.value[cell.owner], backgroundSize: '100% 100%' };
  }
  return null;
}

function cellText(cell) {
  if (cell === null) return '';
  if (cell.mine) return cell.owner === null ? '💣' : ''; // 搶到的雷用方塊，不放字
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
        :style="cellStyle(cell)"
        @click="clickCell(x, y)"
      >{{ cellText(cell) }}</div>
    </template>
  </div>
</template>
