import { reactive } from 'vue';

// 輕量前端路由：只解析 pathname，決定大廳要顯示哪個子畫面。
// 對局中（state.phase !== 'lobby'）由遊戲流程主導畫面，route 僅作輔助。
//   /            → home（大廳）
//   /rooms       → 進行中房間列表
//   /replays     → 回放列表
//   /replays/:id → 指定回放
//   /room/:code  → 對局／觀戰（由 useGame 的遊戲流程處理）
export const route = reactive({ name: 'home', param: '' });

function set(name, param = '') { route.name = name; route.param = param; }

export function parseRoute() {
  const p = location.pathname;
  let m;
  if (p === '/' || p === '') return set('home');
  if (p === '/rooms') return set('rooms');
  if ((m = p.match(/^\/replays\/(\d+)$/))) return set('replay', m[1]);
  if (p === '/replays') return set('replays');
  if ((m = p.match(/^\/room\/([A-Za-z0-9]{4})$/i))) return set('room', m[1].toUpperCase());
  set('home');
}

// 程式化導頁：寫入 history 後重新解析（瀏覽器上一步靠 popstate）
export function navigate(path) {
  if (location.pathname !== path) history.pushState(null, '', path);
  parseRoute();
}

window.addEventListener('popstate', parseRoute);
parseRoute();
