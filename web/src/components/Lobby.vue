<script setup>
import { ref } from 'vue';
import { state, createRoom, joinRoom, spectateRoom } from '../useGame.js';

// 場地大小選項（建房時決定；label 須與 server.js 的 PRESETS 對應）
const SIZE_OPTIONS = [
  { key: 'standard', label: '標準', desc: '16×16・51 雷・先搶 26' },
  { key: 'small', label: '小場', desc: '12×12・29 雷・先搶 15' },
];

const name = ref(localStorage.getItem('mine-name') || '');
const code = ref(state.inviteCode || ''); // 被邀請進站時預填房號
const preset = ref('standard');

function remember() {
  localStorage.setItem('mine-name', name.value);
}

function onCreate() {
  remember();
  createRoom(name.value || '玩家', preset.value);
}

// 邀請模式用 state.inviteCode（resumeIfPossible 在 onMounted 才設定，會晚於本元件 setup，
// 不能依賴 setup 當下抓的 code ref）；一般模式則用房號輸入框的值
const targetCode = () => (state.inviteCode || code.value).trim();

function onJoin() {
  remember();
  const c = targetCode();
  if (!c) return;
  joinRoom(c, name.value || '玩家');
}

function onSpectate() {
  remember();
  const c = targetCode();
  if (!c) return;
  spectateRoom(c);
}
</script>

<template>
  <div class="lobby">
    <p v-if="state.inviteCode" class="invite-banner">
      🎮 你被邀請到房間 <strong>{{ state.inviteCode }}</strong>：選「加入對戰」開打，或「觀戰」只看不玩。
    </p>
    <p class="lobby-intro">點到地雷得 1 分並可繼續點；點到空格換對手。先搶過半地雷者獲勝！</p>

    <label>
      你的暱稱
      <input v-model="name" maxlength="12" placeholder="輸入暱稱" />
    </label>

    <!-- 被邀請進站：直接針對該房號選擇加入或觀戰 -->
    <div v-if="state.inviteCode" class="lobby-actions">
      <button @click="onJoin">加入對戰</button>
      <button class="secondary" @click="onSpectate">👁 觀戰</button>
    </div>

    <!-- 一般大廳：選場地大小後建房 / 用房號加入或觀戰 -->
    <div v-else class="lobby-actions">
      <div class="size-picker">
        <span class="size-title">場地大小</span>
        <label v-for="o in SIZE_OPTIONS" :key="o.key" class="size-opt">
          <input type="radio" name="preset" :value="o.key" v-model="preset" />
          <span>{{ o.label }}<small>{{ o.desc }}</small></span>
        </label>
      </div>
      <button @click="onCreate">建立房間</button>
      <div class="join-row">
        <input v-model="code" maxlength="4" placeholder="房號" class="code-input" @keyup.enter="onJoin" />
        <button class="secondary" @click="onJoin">加入</button>
        <button class="secondary" @click="onSpectate">👁 觀戰</button>
      </div>
    </div>
  </div>
</template>
