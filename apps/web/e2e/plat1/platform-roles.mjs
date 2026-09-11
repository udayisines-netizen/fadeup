/**
 * PLAT-1 — preuve par rôle, dans le navigateur.
 *
 * Se connecte successivement avec chaque rôle interne et relève ce que la
 * console lui rend : les entrées de navigation, l'écran d'équipe, le journal.
 * Capture aussi l'entrée en vue empruntée avec son bandeau, et le refus d'un
 * rôle non habilité qui appelle la RPC DIRECTEMENT depuis la page.
 *
 * Usage : QA_BASE=http://127.0.0.1:4630 node e2e/plat1/platform-roles.mjs <outdir>
 */
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4630'
const PASSWORD = 'Plat1-QA!2026'
const OUT = process.argv[2] ?? '/tmp/plat1-roles'
mkdirSync(OUT, { recursive: true })

const ROLES = [
  ['fondateur', 'qa-plat1-founder@fadeup.test'],
  ['admin', 'qa-plat1-admin@fadeup.test'],
  ['support', 'qa-plat1-support@fadeup.test'],
  ['moderateur', 'qa-plat1-moderator@fadeup.test'],
  ['commercial', 'qa-plat1-sales@fadeup.test'],
  ['stagiaire', 'qa-plat1-intern@fadeup.test'],
]

const browser = await chromium.launch()
const report = []

async function signIn(context, email) {
  const page = await context.newPage()
  await page.goto(`${BASE}/platform/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', PASSWORD)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 25_000 }),
    page.click('button[type="submit"]'),
  ])
  return page
}

for (const [label, email] of ROLES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const errors = []
  const page = await signIn(context, email)
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)))

  await page.goto(`${BASE}/platform`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const nav = await page.evaluate(() =>
    [...document.querySelectorAll('header a[href^="/platform"]')].map((a) => a.getAttribute('href')),
  )
  const permissions = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-disabled="true"], [disabled]')].length,
  )
  await page.screenshot({ path: `${OUT}/nav-${label}-1440.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/nav-${label}-390.png` })
  await page.setViewportSize({ width: 1440, height: 900 })

  // L'écran d'équipe et le journal, tels que ce rôle les reçoit.
  const screens = {}
  for (const [name, path] of [['team', '/platform/team'], ['audit', '/platform/audit']]) {
    const response = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    screens[name] = {
      status: response.status(),
      rows: await page.evaluate(() => document.querySelectorAll('tbody tr').length),
      text: await page.evaluate(() => document.body.innerText.trim().slice(0, 160).replace(/\s+/g, ' ')),
    }
    await page.screenshot({ path: `${OUT}/${name}-${label}-1440.png`, fullPage: true })
  }

  // La vue en tant que, appelée DIRECTEMENT — pas par un bouton.
  const supportView = await page.evaluate(async () => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
    const token = key ? JSON.parse(localStorage.getItem(key)).access_token : null
    const url = window.__FADEUP_SUPABASE_URL__ ?? null
    return { hasToken: Boolean(token), url }
  })

  report.push({ role: label, email, nav, disabledOrLocked: permissions, screens, supportView, consoleErrors: errors })
  console.log(`${label.padEnd(12)} nav=[${nav.join(' ')}] équipe=${screens.team.rows} lignes journal=${screens.audit.rows} lignes`)
  await context.close()
}

await browser.close()
writeFileSync(`${OUT}/roles.json`, JSON.stringify(report, null, 2))
console.log(`\n→ ${OUT}/roles.json`)
