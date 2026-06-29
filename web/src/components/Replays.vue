<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { replayBoard } from '../replay.js';
import { identiconUri } from '../identicon.js';
import BoardView from './BoardView.vue';

defineEmits(['close']);

const list = ref([]);
const loading = ref(true);
const record = ref(null);
const step = ref(0);
const playing = ref(false);
let timer = null;

onMounted(async () => {
  try { list.value = await (await fetch('/api/games')).json(); } catch { list.value = []; }
  loading.value = false;
});
onUnmounted(stop);

async function open(id) {
  stop();
  try {
    record.value = await (await fetch('/api/games/' + id)).json();
    step.value = 0;
  } catch { record.value = null; }
}
function backToList() { stop(); record.value = null; }

const total = computed(() => (record.value ? record.value.moves.length : 0));
const view = computed(() => (record.value ? replayBoard(record.value, step.value) : null));
const playerStyles = computed(() => (record.value ? record.value.players.map((p) => p.style) : []));
const lastMove = computed(() =>
  step.value > 0 && record.value ? record.value.moves[step.value - 1] : null,
);

function stepTo(n) { stop(); step.value = Math.max(0, Math.min(total.value, n)); }
function play() {
  if (playing.value) return stop();
  if (step.value >= total.value) step.value = 0;
  playing.value = true;
  timer = setInterval(() => {
    if (step.value >= total.value) return stop();
    step.value++;
  }, 500);
}
function stop() { playing.value = false; if (timer) { clearInterval(timer); timer = null; } }

const swatch = (s) => ({ backgroundImage: identiconUri(s.seed, s.color) });
const presetLabel = (p) => (p === 'small' ? '小場' : '標準');
function winnerLabel(g) {
  if (g.winner === null || g.winner === undefined) return '未完';
  return `${g[`player${g.winner}_name`]} 勝`;
}
</script>

<template>
  <div class="replays">
    <div class="replays-head">
      <strong>📜 最近對局回放</strong>
      <button class="link-btn" @click="$emit('close')">← 回大廳</button>
    </div>

    <!-- 清單 -->
    <template v-if="!record">
      <p v-if="loading" class="hint">載入中…</p>
      <p v-else-if="!list.length" class="hint">還沒有對局紀錄，打一局就有了。</p>
      <div v-else class="replay-list">
        <button v-for="g in list" :key="g.id" class="replay-row" @click="open(g.id)">
          <span class="rr-players">
            {{ g.player0_name }}
            <b>{{ g.final_scores[0] }}</b> : <b>{{ g.final_scores[1] }}</b>
            {{ g.player1_name }}
          </span>
          <span class="rr-meta">{{ g.vs_bot ? '🤖 ' : '' }}{{ presetLabel(g.preset) }}・{{ g.move_count }} 手・{{ winnerLabel(g) }}</span>
        </button>
      </div>
    </template>

    <!-- 播放 -->
    <template v-else>
      <div class="replay-scores">
        <span class="flag-swatch" :style="swatch(record.players[0].style)" />
        <span :style="{ color: record.players[0].style.color, fontWeight: 700 }">{{ record.players[0].name }}</span>
        <span class="rr-score">{{ view.scores[0] }} : {{ view.scores[1] }}</span>
        <span :style="{ color: record.players[1].style.color, fontWeight: 700 }">{{ record.players[1].name }}</span>
        <span class="flag-swatch" :style="swatch(record.players[1].style)" />
      </div>

      <BoardView
        :board="view.board"
        :width="record.width"
        :styles="playerStyles"
        :lastMove="lastMove"
        :clickable="false"
      />

      <input type="range" min="0" :max="total" v-model.number="step" @input="stop" class="replay-slider" />

      <div class="replay-controls">
        <button class="secondary" @click="stepTo(0)" title="回到開頭">⏮</button>
        <button class="secondary" @click="stepTo(step - 1)" title="上一手">◀</button>
        <button @click="play">{{ playing ? '⏸ 暫停' : '▶ 播放' }}</button>
        <button class="secondary" @click="stepTo(step + 1)" title="下一手">▶</button>
        <span class="replay-progress">{{ step }} / {{ total }} 手</span>
      </div>

      <button class="secondary" @click="backToList">← 回清單</button>
    </template>
  </div>
</template>
