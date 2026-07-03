// 連線版「網路層」：包 WebSocket，對外提供兩組介面——
//   大廳操作：connect / create / join / start / onLobby（配對用）
//   遊戲介面：localId / send / on（跟 net-loopback 一模一樣 → MineRunner 不分單機/連線）
// 權威在 server（lib/rt-room.js）；這裡只轉譯訊息。
export function createWsNet() {
  let ws = null;
  let localId = -1;
  const gameHandlers = [];   // board / reveal / position / map_reset / rt_over
  const lobbyHandlers = [];  // rt_created / rt_joined / rt_lobby / rt_started / rt_left / error
  const emitGame = (ev) => { for (const h of gameHandlers) h(ev); };
  const emitLobby = (ev) => { for (const h of lobbyHandlers) h(ev); };

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }
  function connect() {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
      ws.onclose = () => emitLobby({ type: 'ws_closed' });
      ws.onmessage = (raw) => {
        let m; try { m = JSON.parse(raw.data); } catch { return; }
        switch (m.type) {
          case 'rt_created': case 'rt_joined': localId = m.id; emitLobby(m); break;
          case 'rt_lobby': case 'rt_started': case 'rt_left': case 'error': emitLobby(m); break;
          case 'board': emitGame({ t: 'board', seed: m.seed }); break;
          case 'map_reset': emitGame({ t: 'map_reset', seed: m.seed }); break;
          case 'reveal': emitGame({ t: 'reveal', by: m.by, x: m.x, y: m.y, kind: m.kind, owner: m.owner, adj: m.adj, flooded: m.flooded }); break;
          case 'position': emitGame({ t: 'position', id: m.id, x: m.x, y: m.y }); break;
          case 'rt_over': emitGame({ t: 'rt_over', winnerId: m.winnerId, scores: m.scores }); break;
        }
      };
    });
  }
  const sendRaw = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

  return {
    // 連線 + 大廳（配對）
    connect,
    create: ({ name, cfg }) => sendRaw({ type: 'rt_create', name, cfg }),
    join: ({ code, name }) => sendRaw({ type: 'rt_join', code, name }),
    start: () => sendRaw({ type: 'rt_start' }),
    onLobby: (cb) => { lobbyHandlers.push(cb); },
    close: () => { if (ws) ws.close(); },
    get localId() { return localId; },
    // 遊戲介面（跟 net-loopback 一致）
    send: (msg) => {
      if (msg.t === 'reveal_req') sendRaw({ type: 'reveal_req', x: msg.x, y: msg.y });
      else if (msg.t === 'move') sendRaw({ type: 'rt_move', x: msg.x, y: msg.y });
      // 't:new_board' 線上由 server 驅動 → 忽略
    },
    on: (cb) => { gameHandlers.push(cb); },
  };
}
