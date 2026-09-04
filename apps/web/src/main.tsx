import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initI18n } from './i18n'
import { registerV2Bundles } from './shared/i18n'

// Resolving the initial locale is synchronous (localStorage/browser only —
// see src/lib/locale.ts), so this only waits on loading that one locale's
// bundled JSON, not a network round-trip.
void initI18n().then(() => {
  // V2 (P1b) translations ride the same i18next instance, in their own
  // airtight `v2` namespace — registered once init has built the store.
  registerV2Bundles()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
