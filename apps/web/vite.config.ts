/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    visualizer({ filename: 'dist/stats.html', gzipSize: true }),
  ],

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // P1b — split points for the real surfaces: pro/platform/marketing
          // never ride in the consumer entry chunk. Legacy /platform pages
          // and layouts fold into the same 'platform' chunk (packaging only —
          // their code is untouched).
          if (id.includes('/app/shells/ProShell') || id.includes('/features/pro/') || id.includes('/features/pro-'))
            return 'pro'
          if (
            id.includes('/features/platform-') ||
            id.includes('/pages/platform-') ||
            id.includes('/routes/platform-') ||
            id.includes('/app/shells/PlatformShell')
          )
            return 'platform'
          if (id.includes('/features/marketing') || id.includes('/app/shells/MarketingShell')) return 'marketing'
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase'
          if (id.includes('node_modules/react')) return 'vendor-react'
        },
      },
    },
    chunkSizeWarningLimit: 180,
  },

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  preview: {
    host: '127.0.0.1',
    port: 15180,
    allowedHosts: ['fadeup.jasmean.com'],
  },

  test: {
    globals: true,
    environment: 'jsdom',
    // Les specs Playwright (e2e/) ne sont pas des tests Vitest.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    setupFiles: ['./src/test/setup.ts'],
    env: {
      // Dummy values so lib/env.ts validation passes under test — no real
      // network calls are made against these in unit tests.
      VITE_SUPABASE_URL: 'https://test.supabase.local',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
