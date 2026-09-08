/**
 * P1PRO — balayage visuel de développement (hors suite Playwright test) :
 * l'accueil pro et l'écran des demandes, connectés en owner QA, à 390 et
 * 1440. Erreurs console et requêtes en échec relevées.
 * Usage : node e2e/p1pro/smoke.mjs [outdir]
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4610'
const OUT = process.argv[2] ?? '/tmp/p1pro-smoke'
const EMAIL = process.env.QA_PRO_EMAIL ?? 'qa-f1b-shared@fadeup.test'
const PASSWORD = process.env.QA_PRO_PASSWORD ?? 'QaF1b!passw0rd'

mkdirSync(OUT, { recursive: true })

const issues = []

async function shoot(context, path, name, width) {
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.push(`[console] ${name}-${width}: ${msg.text().slice(0, 200)}`)
  })
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('favicon')) issues.push(`[http ${res.status()}] ${name}-${width}: ${res.url().slice(0, 140)}`)
  })
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 1) issues.push(`[overflow ${overflow}px] ${name}-${width}`)
  await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true })
  await page.close()
}

async function run(width, height, storageState) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width, height }, storageState })
  // login
  const page = await context.newPage()
  await page.goto(`${BASE}/auth/login`)
  await page.getByLabel(/e-?mail/i).first().fill(EMAIL)
  await page.getByLabel(/mot de passe|password/i).first().fill(PASSWORD)
  await page.getByRole('button', { name: /se connecter|sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 15000 })
  await page.close()

  await shoot(context, '/dashboard', 'pro-home', width)
  await shoot(context, '/dashboard/requests', 'pro-requests', width)
  await browser.close()
}

await run(1440, 900)
await run(390, 844)

console.log(issues.length ? issues.join('\n') : 'aucun problème relevé')
console.log(`captures dans ${OUT}`)
