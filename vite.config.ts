import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: process.env.CI ? '/Stratego/' : '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Stratego',
        short_name: 'Stratego',
        description: 'Offline-first Stratego board game',
        theme_color: '#111827',
        background_color: '#e2e8f0',
        display: 'standalone',
        start_url: './',
        icons: [
          {
            src: 'favicon.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,ico}'],
        navigateFallback: null,
      },
    }),
  ],
  build: {
    sourcemap: 'hidden',
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
