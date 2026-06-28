<script setup>
import { ref } from 'vue';
import { state, createRoom, joinRoom, spectateRoom } from '../useGame.js';

const name = ref(localStorage.getItem('mine-name') || '');
const code = ref(state.inviteCode || ''); // 被邀請進站時預填房號

function remember() {
  localStorage.setItem('mine-name', name.value);
}

function onCreate() {
  remember();
  createRoom(name.value || '玩家');
}

function onJoin() {
  remember();
  if (!code.value.trim()) return;
  joinRoom(code.value, name.value || '玩家');
}

function onSpectate() {
  remember();
  if (!code.value.trim()) return;
  spectateRoom(code.value);
}
</script>

<template>
  <div class="lobby">
    <p v-if="state.inviteCode" class="invite-banner">
      🎮 你被邀請到房間 <strong>{{ state.inviteCode }}</strong>：選「加入對戰」開打，或「觀戰」只看不玩。
    </p>
    <p class="lobby-intro">點到地雷得 1 分並可繼續點；點到空格換對手。先搶到 26 顆地雷獲勝！</p>

    <label>
      你的暱稱
      <input v-model="name" maxlength="12" placeholder="輸入暱稱" />
    </label>

    <!-- 被邀請進站：直接針對該房號選擇加入或觀戰 -->
    <div v-if="state.inviteCode" class="lobby-actions">
      <button @click="onJoin">加入對戰</button>
      <button class="secondary" @click="onSpectate">👁 觀戰</button>
    </div>

    <!-- 一般大廳：建房 / 用房號加入或觀戰 -->
    <div v-else class="lobby-actions">
      <button @click="onCreate">建立房間</button>
      <div class="join-row">
        <input v-model="code" maxlength="4" placeholder="房號" class="code-input" @keyup.enter="onJoin" />
        <button class="secondary" @click="onJoin">加入</button>
        <button class="secondary" @click="onSpectate">👁 觀戰</button>
      </div>
    </div>
  </div>
</template>
