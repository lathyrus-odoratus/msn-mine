<script setup>
// 單一角色在場上的視覺：頭上 HUD（buff 圓餅／能量小數條／移動 slot／飄字）＋
// 影子＋蓄力光環＋角色本體＋能量行星軌道。位置由外層 wrapper 決定，這裡只畫「一個人」。
// 玩家與對手（bot）共用此元件 → N 人只是多渲染幾個。
import { computed } from 'vue';

const props = defineProps({
  player: { type: Object, required: true },
  elapsed: { type: Number, default: 0 },
  cellPx: { type: Number, required: true },
  charW: { type: Number, required: true },
  charH: { type: Number, required: true },
  phase: { type: String, default: 'play' },
  buffSec: { type: Number, default: 6 },
  arcRatio: { type: Number, default: 1.3 },
});

const isBuffActive = computed(() => props.elapsed < props.player.buffUntil);
const buffPct = computed(() => Math.min(100, (Math.max(0, props.player.buffUntil - props.elapsed) / props.buffSec) * 100));
const energyBolts = computed(() => Math.floor(props.player.energy + 1e-6));
const energyFrac = computed(() => props.player.energy - Math.floor(props.player.energy + 1e-6));
const showEbar = computed(() => props.player.energy < props.player.energyCap - 1e-6);
const actColor = computed(() => (props.player.moveSlots < 1 ? '#ff4d4d' : props.player.moveSlots < 3 ? '#f4b400' : '#46d27a'));
const hopPx = computed(() => (props.player.flight.active ? Math.sin(Math.min(1, props.player.flight.t) * Math.PI) * props.cellPx * props.arcRatio : 0));
const charStyle = computed(() => {
  const p = props.player;
  const squatY = p.squat ? props.cellPx * 0.13 : 0;
  const sy = p.squat ? 0.8 : 1;
  // 腳底（-100%）對齊格中心投影點；hop 往上、squat 下蹲、rotateX(-46) 站直、scaleX 控制面向
  return { transform: `translate(-50%, -100%) translateY(${squatY - hopPx.value}px) rotateX(-46deg) scaleY(${sy}) scaleX(${p.faceDir})` };
});
const shadowStyle = computed(() => {
  const k = props.player.flight.active ? Math.max(0.4, 1 - hopPx.value / (props.cellPx * 2)) : 1;
  return { transform: `scale(${k})`, opacity: k };
});
function planetStyle(i) {
  const n = Math.max(1, energyBolts.value);
  const a = props.player.orbitAngle + ((i - 1) / n) * Math.PI * 2;
  const R = props.cellPx * 0.95;
  const x = Math.cos(a) * R;
  const y = Math.sin(a) * R * 0.4;        // 壓扁成傾斜橢圓（俯視）
  const depth = Math.sin(a);              // >0 在前、<0 在後
  const s = 0.7 + 0.45 * ((depth + 1) / 2);
  return {
    transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(2)})`,
    zIndex: depth > 0 ? 8 : 2,
    opacity: (0.5 + 0.5 * ((depth + 1) / 2)).toFixed(2),
  };
}
</script>

<template>
  <div class="actor-vis" :style="{ '--ch': charH + 'px', '--cell': cellPx + 'px' }">
    <div v-if="player.headText" class="headtext" :class="player.headType" :key="player.headKey">{{ player.headText }}</div>
    <template v-if="phase === 'play'">
      <!-- buff 剩餘：圓餅歸零式 -->
      <div v-if="isBuffActive" class="hbuff-pie" :style="{ '--pct': buffPct + '%' }"></div>
      <!-- 能量小數：正在衝的能量條（整數顆＝下方行星軌道閃電） -->
      <div v-if="showEbar" class="henergy">
        <span class="ebar2-fill" :style="{ width: energyFrac * 100 + '%', background: '#f4b400' }"></span>
      </div>
      <!-- 移動 buffer（貼近頭） -->
      <div v-if="player.mode === 'normal'" class="moveslots">
        <span v-for="i in player.maxSlots" :key="i" class="mslot">
          <span class="mfill" :style="{ transform: `scaleX(${Math.max(0, Math.min(1, player.moveSlots - (i - 1)))})`, background: actColor }"></span>
        </span>
      </div>
    </template>
    <span class="ashadow" :style="shadowStyle"></span>
    <span v-if="player.mode === 'charging'" class="cring" :key="player.ringKey"></span>
    <span class="char" :class="{ buffed: isBuffActive }" :style="[{ color: player.color }, charStyle]">
      <span class="char-anim" :class="{ walk: player.isMoving }">
        <svg viewBox="0 0 24 30" :width="charW" :height="charH">
          <rect x="8.6" y="23.5" width="2.4" height="5.5" rx="1.2" fill="currentColor" />
          <rect x="13" y="23.5" width="2.4" height="5.5" rx="1.2" fill="currentColor" />
          <ellipse cx="12" cy="20" rx="5.6" ry="6" fill="currentColor" />
          <circle cx="12" cy="10.5" r="6" fill="currentColor" />
          <path d="M6 10.5 a6 6 0 0 1 12 0 Z" fill="rgba(0,0,0,.24)" />
          <circle cx="12" cy="6" r="1.15" fill="#ffe27a" />
          <circle cx="9.8" cy="12.1" r="1.5" fill="#fff" />
          <circle cx="14.2" cy="12.1" r="1.5" fill="#fff" />
          <circle cx="10" cy="12.3" r=".7" fill="#243" />
          <circle cx="14" cy="12.3" r=".7" fill="#243" />
        </svg>
      </span>
    </span>
    <!-- 能量行星軌道：整數顆閃電繞角色轉（傾斜橢圓、前後穿插） -->
    <div class="orbit">
      <span v-for="i in energyBolts" :key="i" class="planet" :style="planetStyle(i)">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M13 2 4 13 11 13 9 22 20 10 13 10 Z" fill="#ffd23f" /></svg>
      </span>
    </div>
  </div>
</template>

<style scoped>
.actor-vis { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
.headtext {
  position: absolute; left: 0; top: calc(var(--ch, 80px) * -1.25);
  transform: translateX(-50%); white-space: nowrap; pointer-events: none; z-index: 9;
  font-size: 26px; font-weight: 900; animation: head-float 1.15s ease-out forwards;
}
.headtext.deny { color: #ff5a5a; text-shadow: 0 2px 6px rgba(0, 0, 0, .45); }
.headtext.buff { color: #38c6ff; text-shadow: 0 2px 6px rgba(0, 0, 0, .45); }
@keyframes head-float {
  0%   { opacity: 0; transform: translate(-50%, 12px) scale(.7); }
  20%  { opacity: 1; transform: translate(-50%, 0) scale(1.12); }
  100% { opacity: 0; transform: translate(-50%, -42px) scale(1); }
}
.moveslots {
  position: absolute; left: 0; top: calc(var(--ch, 80px) * -0.78); transform: translateX(-50%);
  display: flex; gap: 2px; z-index: 7; padding: 2px 3px; border-radius: 5px;
  background: rgba(17, 22, 29, .55);
}
.mslot {
  width: 8px; height: 11px; border-radius: 2px; overflow: hidden;
  background: rgba(255, 255, 255, .22);
}
.mfill { display: block; width: 100%; height: 100%; transform-origin: left; background: #46d27a; }
.henergy {
  position: absolute; left: 0; top: calc(var(--ch, 80px) * -1.02); transform: translateX(-50%); z-index: 7;
  width: 30px; height: 6px; border-radius: 3px; overflow: hidden;
  background: rgba(17, 22, 29, .6); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .25);
}
.ebar2-fill { display: block; height: 100%; }
.hbuff-pie {
  position: absolute; left: 0; top: calc(var(--ch, 80px) * -1.45); transform: translateX(-50%); z-index: 7;
  width: 18px; height: 18px; border-radius: 50%;
  background: conic-gradient(#38c6ff var(--pct, 0%), rgba(17, 22, 29, .5) var(--pct, 0%) 100%);
  border: 1.5px solid rgba(255, 255, 255, .65); box-shadow: 0 1px 3px rgba(0, 0, 0, .35);
}
/* 能量行星軌道（位置由 JS 每幀算，前後 z-index 穿插角色） */
.orbit {
  position: absolute; left: 0; top: calc(var(--ch, 80px) * -0.5);
  width: 0; height: 0; pointer-events: none;
}
.planet { position: absolute; left: 0; top: 0; will-change: transform; }
.planet svg { display: block; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .45)); }
.ashadow {
  position: absolute; left: 0; top: 0;
  width: calc(var(--cell, 48px) * 0.66); height: calc(var(--cell, 48px) * 0.3);
  margin: 0 0 0 calc(var(--cell, 48px) * -0.33);
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, .5), rgba(0, 0, 0, 0) 70%);
  border-radius: 50%;
}
.cring {
  position: absolute; left: 50%; top: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px;
  border: 2px solid #4fd0ff; border-radius: 50%; animation: ring-out .5s ease-out forwards;
}
@keyframes ring-out {
  0% { transform: scale(.4); opacity: .9; }
  100% { transform: scale(3.4); opacity: 0; }
}
.char {
  position: absolute; left: 0; top: 0; transform-origin: center bottom; z-index: 5;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, .3)); will-change: transform;
}
.char svg { display: block; }
.char.buffed { filter: drop-shadow(0 0 6px #4fd0ff) drop-shadow(0 2px 2px rgba(0, 0, 0, .3)); }
.char-anim { display: block; transform-origin: center bottom; animation: char-idle 1.8s ease-in-out infinite; }
.char-anim.walk { animation: char-walk .28s ease-in-out infinite; }
@keyframes char-idle {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50%      { transform: translateY(-1.5px) rotate(0deg); }
}
@keyframes char-walk {
  0%   { transform: translateY(0) rotate(-3deg); }
  25%  { transform: translateY(-4px) rotate(0deg); }
  50%  { transform: translateY(0) rotate(3deg); }
  75%  { transform: translateY(-4px) rotate(0deg); }
  100% { transform: translateY(0) rotate(-3deg); }
}
</style>
