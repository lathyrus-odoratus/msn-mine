import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    fs: { allow: ['..'] },   // 允許 dev 讀 repo 根的 lib/（探雷 bot 復用 pickMove）
    proxy: {
      // dev 模式下把 WebSocket 轉給 Node 伺服器
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
