<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { spectateRoom } from '../useGame.js';

defineEmits(['back']);

const list = ref([]);
const loading = ref(true);
let timer = null;

async function refresh() {
  try { list.value = await (await fetch('/api/rooms')).json(); } catch { list.value = []; }
  loading.value = false;
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 4000); // 進行中房間會變動，定時刷新
});
onUnmounted(() => { if (timer) clearInterval(timer); });

const presetLabel = (p) => (p === 'small' ? '小場' : '標準');
</script>

<template>
  <div class="replays">
    <div class="replays-head">
      <strong>🟢 進行中的房間</strong>
      <button class="link-btn" @click="$emit('back')">← 上一步</button>
    </div>

    <p v-if="loading" class="hint">載入中…</p>
    <p v-else-if="!list.length" class="hint">目前沒有進行中的對局，回大廳開一局吧。</p>
    <div v-else class="replay-list">
      <button v-for="r in list" :key="r.code" class="replay-row" @click="spectateRoom(r.code)">
        <span class="rr-players">
          {{ r.names[0] }}
          <b>{{ r.scores[0] }}</b> : <b>{{ r.scores[1] }}</b>
          {{ r.names[1] }}
        </span>
        <span class="rr-meta">
          {{ r.vsBot ? '🤖 ' : '' }}{{ presetLabel(r.preset) }}・先搶 {{ r.winTarget }}・房號 {{ r.code }}
          <template v-if="r.spectators"> ・👁 {{ r.spectators }}</template>
        </span>
      </button>
    </div>
  </div>
</template>
