<script setup>
defineEmits(['close']);
</script>

<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <span>📖 玩法說明</span>
        <button class="modal-x" @click="$emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <p class="help-key">
          ⚠️ 跟一般踩地雷<strong>相反</strong>——這裡是「<strong>搶雷</strong>」，
          <strong>點到地雷反而得分</strong>，踩到不會死！
        </p>

        <ul class="help-rules">
          <li>兩人輪流點格子。</li>
          <li>點到 <strong>地雷</strong> → 得 1 分，<strong>而且可以繼續點</strong>（連到雷就一直賺）。</li>
          <li>點到 <strong>空格 / 數字</strong> → 沒分，換對手。</li>
          <li>數字 = 周圍 8 格的地雷數，是<strong>雙方共享的情報</strong>，用來推哪裡有雷。</li>
          <li>先搶到<strong>過半地雷</strong>者獲勝（標準場 26 顆、小場 15 顆）。</li>
        </ul>

        <p class="help-tip">
          💡 開房後把連結傳給朋友：有空位就加入對戰，滿了就自動進觀戰。
        </p>
      </div>

      <button class="modal-ok" @click="$emit('close')">開始玩！</button>
    </div>
  </div>
</template>
