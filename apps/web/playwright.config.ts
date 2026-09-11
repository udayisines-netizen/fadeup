import { defineConfig, devices } from '@playwright/test'

/**
 * E2E P1b — Chromium et WebKit, 390 px et 1440 px (§14).
 *
 * Le serveur cible est le serveur de DÉVELOPPEMENT : `/dev/ui` (cible des
 * tests axe) n'existe que là, et l'application parle à la vraie base locale
 * (Supabase via Kong :18100) — aucune donnée simulée.
 */
/**
 * Port du serveur de développement paramétrable : plusieurs worktrees
 * tournent en parallèle sur cette machine, et `reuseExistingServer` ferait
 * autrement passer les tests d'un lot contre le code d'un autre.
 * `E2E_PORT=<port> npm run e2e` isole chaque campagne.
 * Ports en usage : OS-1 4610, PERF 4620, PLAT-1 4630.
 */
const E2E_PORT = Number(process.env.E2E_PORT ?? 4610)

export default defineConfig({
  // P1b (régression shell/auth/i18n) + F1 (Live Queue).
  testDir: './e2e',
  timeout: 45_000,
  retries: 1,
  // La machine a 2 cœurs et fait tourner la production : un seul worker.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    /*
     * WebKit est téléchargé mais NE PEUT PAS se lancer sur cet hôte : il
     * manque les bibliothèques système (libgtk-4, gstreamer, flite…) et leur
     * installation exige root (`playwright install-deps`). Blocage documenté
     * dans le rapport P1b. Une fois les libs posées :
     * `P1B_WEBKIT=1 npm run e2e` exécute les quatre projets.
     */
    ...(process.env.P1B_WEBKIT === '1'
      ? [
          { name: 'webkit-mobile', use: { ...devices['Desktop Safari'], viewport: { width: 390, height: 844 } } },
          { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
        ]
      : []),
  ],
  webServer: {
    command: `npm run dev -- --port ${E2E_PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
