import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initI18n } from './i18n'
import { registerV2Bundles } from './shared/i18n'
import { initErrorReporting } from './shared/observability/errorReporting'

// X1 — suivi d'erreurs. No-op sans VITE_SENTRY_DSN ; sinon, import dynamique
// du SDK dans son propre chunk (l'entrée consumer ne le porte jamais).
initErrorReporting()

// Resolving the initial locale is synchronous (localStorage/browser only —
// see src/lib/locale.ts), so this only waits on loading that one locale's
// bundled JSON, not a network round-trip.
// V2 (P1b) translations ride the same i18next instance, in their own
// airtight `v2` namespace. PERF: only the ACTIVE locale is awaited (the
// other loads in the background), IN PARALLEL with initI18n — both resolved
// before the first render, so no raw key can flash on first paint.
void Promise.all([initI18n(), registerV2Bundles()]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
