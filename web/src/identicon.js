// 程式化旗子花紋：由 seed 生成 5×5 水平對稱的 identicon（GitHub 風），
// 用玩家選的顏色當底、深一階當花紋。在 30px 的格子上仍讀得出紋理、能區分敵我。

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 把顏色壓暗 factor 倍（花紋用）
export function darken(hex, f = 0.5) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// 5×5 水平對稱格：只擲左三欄、鏡射到右兩欄
function patternGrid(seed) {
  const rnd = mulberry32(seed >>> 0);
  const g = Array.from({ length: 5 }, () => Array(5).fill(false));
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const on = rnd() > 0.5;
      g[y][x] = on;
      g[y][4 - x] = on;
    }
  }
  return g;
}

// 回傳可直接當 background-image 用的 CSS url(data:svg)
export function identiconUri(seed, color) {
  const grid = patternGrid(seed);
  const dark = darken(color, 0.5);
  let rects = '';
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      if (grid[y][x]) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" preserveAspectRatio="none">` +
    `<rect width="5" height="5" fill="${color}"/><g fill="${dark}">${rects}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export const randomSeed = () => Math.floor(Math.random() * 1e9);
