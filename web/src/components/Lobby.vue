<script setup>
import { ref, computed } from 'vue';
import { state, createRoom, createBotRoom, joinRoom, spectateRoom } from '../useGame.js';
import { identiconUri, randomSeed } from '../identicon.js';

// 場地大小選項（建房時決定；label 須與 server.js 的 PRESETS 對應）
const SIZE_OPTIONS = [
  { key: 'standard', label: '標準', desc: '16×16・51 雷・先搶 26' },
  { key: 'small', label: '小場', desc: '12×12・29 雷・先搶 15' },
];

// 電腦對手類型（key 須與 lib/bot.js 的 BOTS 對應）；desc 是給玩家看的邏輯說明
const BOT_OPTIONS = [
  { key: 'smart', label: '🧠 推理', desc: '估算每一格是地雷的機率，每手都挑最可能是雷的格；會結合多個數字線索推出哪裡安全、哪裡必有雷。最強。' },
  { key: 'greedy', label: '💰 貪婪', desc: '只在能 100% 確定某格是地雷時才搶（搶到得分又能續手），否則隨機亂猜。中等。' },
  { key: 'random', label: '🎲 隨機', desc: '完全隨機亂點還沒翻開的格子，不做任何推理。最弱，適合輕鬆玩。' },
];

const name = ref(localStorage.getItem('mine-name') || '');
const code = ref(state.inviteCode || ''); // 被邀請進站時預填房號
const preset = ref('standard');
const botId = ref(localStorage.getItem('mine-bot') || 'smart');
const openInfo = ref(''); // 目前展開說明的 bot key（再點一次收合）
function toggleInfo(key) { openInfo.value = openInfo.value === key ? '' : key; }

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

function onVsBot() {
  remember();
  localStorage.setItem('mine-bot', botId.value); // 記住上次選的對手
  createBotRoom(name.value || '玩家', preset.value, myStyle(), botId.value);
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

      <!-- 電腦對手：選類型，每個選項旁可點 ⓘ 看它的邏輯說明 -->
      <div class="bot-picker">
        <span class="size-title">電腦對手</span>
        <div v-for="b in BOT_OPTIONS" :key="b.key" class="bot-opt-row">
          <label class="size-opt bot-opt">
            <input type="radio" name="botId" :value="b.key" v-model="botId" />
            <span>{{ b.label }}</span>
          </label>
          <button
            type="button"
            class="info-btn"
            :class="{ active: openInfo === b.key }"
            @click="toggleInfo(b.key)"
            :title="'說明「' + b.label + '」的邏輯'"
          >ⓘ</button>
        </div>
        <p v-if="openInfo" class="bot-info">
          {{ BOT_OPTIONS.find((b) => b.key === openInfo).desc }}
        </p>
      </div>
      <button class="secondary" @click="onVsBot">🤖 對電腦</button>
      <div class="join-row">
        <input v-model="code" maxlength="4" placeholder="房號" class="code-input" @keyup.enter="onJoin" />
        <button class="secondary" @click="onJoin">加入</button>
        <button class="secondary" @click="onSpectate">👁 觀戰</button>
      </div>
    </div>
  </div>
</template>
