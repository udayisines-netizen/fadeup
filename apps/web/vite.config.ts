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
    // X1 — cartes source : jamais dans une build servie (le Dockerfile copie
    // tout dist/, un .map présent serait public). 'hidden' n'est activé que
    // par scripts/sentry-sourcemaps.mjs, qui téléverse puis SUPPRIME les
    // .map ; 'hidden' n'ajoute pas de commentaire sourceMappingURL, le JS
    // émis reste donc identique octet pour octet à la build de production.
    sourcemap: process.env.SENTRY_SOURCEMAPS === '1' ? 'hidden' : false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // PERF — les règles de groupe P1b ('pro', 'platform', 'marketing')
          // sont SUPPRIMÉES : rolldown aspirait dans chaque groupe la
          // fermeture de dépendances de ses modules — y compris des modules
          // partagés dont l'entrée a besoin (supabase client, RealtimeProvider,
          // i18n, Toast…). L'entrée importait alors ces chunks EN STATIQUE et
          // le premier chargement consumer transférait ~674 Ko gzip (platform
          // 218 + maplibre 246 + marketing 62 + pro 37 — mesuré, D1 §11).
          // Le découpage NATUREL par import dynamique (toutes ces surfaces
          // sont des routes `lazy`) suffit ; la garantie « jamais dans
          // l'entrée consumer » est désormais tenue par
          // scripts/check-entry-graph.mjs, qui FAIT ÉCHOUER le build.
          //
          // F3 — maplibre est partagé entre la carte consumer (onglet Carte
          // de /search, paresseux) et la carte legacy /platform. Les DEUX
          // modules JS sont nommés explicitement : un filtre large sur le
          // paquet attrape aussi son CSS (id suffixé d'une requête, donc pas
          // de endsWith possible) et rolldown abandonne alors le groupe EN
          // SILENCE — mesuré pendant F3.
          if (id.includes('maplibre-gl.mjs') || id.includes('maplibre-gl-shared.mjs')) return 'maplibre'
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase'
          // PERF — règle resserrée : `node_modules/react` attrapait TOUT
          // react-* (react-hook-form, react-remove-scroll, react-day-picker…)
          // et les collait — avec leur fermeture — dans un chunk que l'entrée
          // importe en statique. Seul le cœur react partagé par tout reste
          // nommé ; le reste suit le découpage naturel de ses importeurs.
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          )
            return 'vendor-react'
        },
      },
    },
    chunkSizeWarningLimit: 180,
  },

  // F3 — maplibre charge son worker comme un module frère ; pré-bundlé par
  // l'optimiseur dev, ce worker n'existe pas (404 maplibre-gl-worker.mjs,
  // mesuré). Exclu, il se résout depuis la source. Build de prod inchangée.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
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
