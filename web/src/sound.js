import { reactive } from 'vue';

// 用 Web Audio API 即時合成音效，不打包任何音檔——維持 POC 輕量與復古 MSN 風格。
// 偏好用 localStorage 記住，刷新分頁也保留。
const MUTE_KEY = 'mine-muted';
export const sound = reactive({
  muted: localStorage.getItem(MUTE_KEY) === '1',
});

export function toggleMuted() {
  sound.muted = !sound.muted;
  localStorage.setItem(MUTE_KEY, sound.muted ? '1' : '0');
  if (!sound.muted) ensureCtx()?.resume(); // 解除靜音時順手喚醒（首次互動後才有 ctx）
}

let ctx = null;
function ensureCtx() {
  if (sound.muted) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume(); // 瀏覽器要使用者互動後才放行
  return ctx;
}

// 單一音符：頻率隨時間做指數滑音，音量做 ADSR 包絡淡出
function tone(freq, { from = freq, dur = 0.18, type = 'sine', gain = 0.18, delay = 0 } = {}) {
  const ac = ensureCtx();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (from !== freq) osc.frequency.exponentialRampToValueAtTime(freq, t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// 連續音符組成的小旋律
function sequence(notes, opts = {}) {
  let t = 0;
  for (const n of notes) {
    const [freq, step = 0.1] = Array.isArray(n) ? n : [n];
    tone(freq, { ...opts, delay: t });
    t += step;
  }
}

// === 各事件音效 ===

// 自己搶到雷：明亮上揚雙音
export const playClaimSelf = () => sequence([[660, 0.07], [990]], { type: 'triangle', dur: 0.16, gain: 0.2 });

// 對手搶到雷：低沉下行雙音
export const playClaimOpp = () => sequence([[392, 0.07], [294]], { type: 'sine', dur: 0.18, gain: 0.16 });

// 翻到空格（換手）：柔和短彈
export const playReveal = () => tone(520, { from: 760, type: 'sine', dur: 0.1, gain: 0.12 });

// 對局開始：清脆三音上行
export const playStart = () => sequence([[523, 0.09], [659, 0.09], [784]], { type: 'triangle', dur: 0.16, gain: 0.16 });

// 你贏了：歡快琶音
export const playWin = () => sequence([[523, 0.1], [659, 0.1], [784, 0.1], [1047]], { type: 'triangle', dur: 0.24, gain: 0.2 });

// 你輸了：下行悶音
export const playLose = () => sequence([[392, 0.13], [330, 0.13], [262]], { type: 'sawtooth', dur: 0.26, gain: 0.13 });

// 觀戰局結束：中性收尾
export const playEnd = () => sequence([[659, 0.1], [523]], { type: 'sine', dur: 0.2, gain: 0.12 });

// 收到嗆聲：俏皮小泡泡
export const playTaunt = () => tone(880, { from: 1320, type: 'square', dur: 0.08, gain: 0.07 });

// 探雷模式：逐格腳步（短促低沉）
export const playStep = () => tone(150, { from: 190, type: 'sine', dur: 0.05, gain: 0.05 });

// 探雷模式：插旗（短促清脆）
export const playMark = () => tone(620, { from: 460, type: 'square', dur: 0.05, gain: 0.05 });
