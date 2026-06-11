import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // dev 模式下把 WebSocket 轉給 Node 伺服器
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
