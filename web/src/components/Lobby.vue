<script setup>
import { ref } from 'vue';
import { state, createRoom, joinRoom } from '../useGame.js';

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
</script>

<template>
  <div class="lobby">
    <p v-if="state.inviteCode" class="invite-banner">
      🎮 你被邀請加入房間 <strong>{{ state.inviteCode }}</strong>，輸入暱稱即可開打！
    </p>
    <p class="lobby-intro">點到地雷得 1 分並可繼續點；點到空格換對手。先搶到 26 顆地雷獲勝！</p>

    <label>
      你的暱稱
      <input v-model="name" maxlength="12" placeholder="輸入暱稱" />
    </label>

    <div class="lobby-actions">
      <button @click="onCreate">建立房間</button>
      <div class="join-row">
        <input v-model="code" maxlength="4" placeholder="房號" class="code-input" @keyup.enter="onJoin" />
        <button class="secondary" @click="onJoin">加入房間</button>
      </div>
    </div>
  </div>
</template>
