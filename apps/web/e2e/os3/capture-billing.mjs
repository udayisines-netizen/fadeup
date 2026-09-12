// OS-3 — capture de l'écran d'abonnement sur l'état RÉEL d'un abonnement en
// mode test Stripe (annuel actif, descente programmée, résiliation en fin de
// période). Hors campagne Playwright : un seul écran, deux largeurs.
import { chromium } from '@playwright/test'

const PORT = process.env.E2E_PORT ?? '4670'
const BASE = `http://127.0.0.1:${PORT}`
const OUT = process.argv[2]

const browser = await chromium.launch()
for (const [label, width, height] of [['390', 390, 844], ['1440', 1440, 900]]) {
  const page = await browser.newPage({ viewport: { width, height }, locale: 'fr-FR' })
  page.setDefaultTimeout(30000)
  await page.goto(`${BASE}/auth/login`)
  await page.getByLabel(/e-?mail/i).first().fill('qa-f1b-shared@fadeup.test')
  await page.getByLabel(/mot de passe|password/i).first().fill('QaF1b!passw0rd')
  await page.getByRole('button', { name: /se connecter|sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 20000 })
  await page.goto(`${BASE}/dashboard/billing`)
  await page.getByTestId('pro-billing-state').waitFor({ timeout: 30000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/billing-subscribed-${label}.png`, fullPage: true })
  console.log(`capture ${label} ok`)
  await page.close()
}
await browser.close()
