<script setup>
import { state, TAUNTS, sendTaunt } from '../useGame.js';
</script>

<template>
  <div class="taunts">
    <!-- 嗆聲泡泡：收到後幾秒自動消失 -->
    <transition-group name="taunt" tag="div" class="taunt-feed">
      <div
        v-for="t in state.taunts"
        :key="t.id"
        class="taunt-bubble"
        :class="{ spectator: t.spectator }"
      >
        <span class="taunt-name">{{ t.spectator ? '👁 ' : '' }}{{ t.name }}</span>：{{ t.text }}
      </div>
    </transition-group>

    <!-- 預設嗆聲按鈕：玩家與觀戰者皆可發 -->
    <div class="taunt-buttons">
      <button
        v-for="(txt, i) in TAUNTS"
        :key="i"
        class="taunt-btn"
        @click="sendTaunt(i)"
      >{{ txt }}</button>
    </div>
  </div>
</template>
