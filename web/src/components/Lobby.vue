<script setup>
import { ref, computed } from 'vue';
import { state, createRoom, joinRoom, spectateRoom } from '../useGame.js';
import { identiconUri, randomSeed } from '../identicon.js';

// 場地大小選項（建房時決定；label 須與 server.js 的 PRESETS 對應）
const SIZE_OPTIONS = [
  { key: 'standard', label: '標準', desc: '16×16・51 雷・先搶 26' },
  { key: 'small', label: '小場', desc: '12×12・29 雷・先搶 15' },
];

const name = ref(localStorage.getItem('mine-name') || '');
const code = ref(state.inviteCode || ''); // 被邀請進站時預填房號
const preset = ref('standard');

// 旗子：自選顏色 + 隨機花紋 seed（搶到的雷會以此滿版方塊呈現）
const flagColor = ref(localStorage.getItem('mine-color') || '#1d5fd6');
const flagSeed = ref(Number(localStorage.getItem('mine-seed')) || randomSeed());
const flagPreview = computed(() => identiconUri(flagSeed.value, flagColor.value));
const myStyle = () => ({ color: flagColor.value, seed: flagSeed.value });

function saveFlag() {
  localStorage.setItem('mine-color', flagColor.value);
  localStorage.setItem('mine-seed', String(flagSeed.value));
}
function rerollFlag() {
  flagSeed.value = randomSeed();
  saveFlag();
}

const targetCode = () => (state.inviteCode || code.value).trim();

function remember() {
  localStorage.setItem('mine-name', name.value);
  saveFlag();
}

function onCreate() {
  remember();
  createRoom(name.value || '玩家', preset.value, myStyle());
}

function onJoin() {
  remember();
  const c = targetCode();
  if (!c) return;
  joinRoom(c, name.value || '玩家', myStyle());
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

    <!-- 旗子：搶到的雷會顯示成這個滿版方塊 -->
    <div class="flag-picker">
      <span class="flag-title">你的旗子</span>
      <span class="flag-preview" :style="{ backgroundImage: flagPreview }" />
      <input type="color" v-model="flagColor" @change="saveFlag" class="flag-color" title="選顏色" />
      <button class="secondary flag-reroll" @click="rerollFlag">🎲 換花紋</button>
    </div>

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
