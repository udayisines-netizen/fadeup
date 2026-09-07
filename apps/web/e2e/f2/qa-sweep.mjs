/**
 * F2 — balayage navigateur manuel (hors suite Playwright test) : capture les
 * pages réelles à 390/430/1440, relève erreurs console et requêtes en échec.
 * Usage : node e2e/f2/qa-sweep.mjs
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4610'
const OUT = '/tmp/f2-qa'
mkdirSync(OUT, { recursive: true })

const PAGES = [
  ['pro-kais', '/pro/demo.kais.bellamine'],
  ['pro-fadel', '/pro/demo.fadel'],
  ['pro-moussa-unclaimed', '/pro/demo.moussa.diakite'],
  ['pro-sofian-unclaimed', '/pro/demo.sofian.cuts'],
  ['pro-notfound', '/pro/handle.inconnu'],
  ['shop-maison-kais', '/shop/demo-maison-kais'],
  ['shop-sofian-servicearea', '/shop/demo-sofian-cuts'],
  ['shop-barber-corner', '/shop/demo-barber-corner'],
  ['shop-notfound', '/shop/slug-inconnu'],
  // Non-régression visuelle du correctif cn.ts (twMerge apprend text-fu-*) :
  // un échantillon des surfaces qui mêlent text-fu-* et text-[var(...)].
  ['home', '/'],
  ['auth-login', '/auth/login'],
  ['auth-signup', '/auth/signup'],
  ['queue-maison-kais', '/q/demo-maison-kais'],
  ['queue-sofian-servicearea', '/q/demo-sofian-cuts'],
  ['demo-discovery', '/demo/discovery'],
  ['demo-profile', '/demo/profile?org=demo-maison-kais'],
  ['dev-ui', '/dev/ui'],
]

const WIDTHS = [
  [390, 844],
  [430, 932],
  [1440, 900],
]

const browser = await chromium.launch()
let issues = 0
for (const [w, h] of WIDTHS) {
  for (const [name, path] of PAGES) {
    // Un contexte NEUF par page : la machine (2 cœurs, production à côté)
    // épuise le renderer si un seul contexte enchaîne les captures pleine page.
    const context = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await context.newPage()
    const consoleErrors = []
    const failedRequests = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('response', (res) => {
      if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`)
    })
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    // Serveur DEV : le graphe de modules froid peut finir de s'exécuter
    // après networkidle — on attend le CONTENU, pas le réseau.
    await page.waitForFunction(() => (document.body.innerText ?? '').length > 30, undefined, { timeout: 20_000 })
    await page.waitForTimeout(800)
    try {
      await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: true })
    } catch {
      await page.screenshot({ path: `${OUT}/${name}-${w}.png` })
    }
    if (consoleErrors.length || failedRequests.length) {
      issues += 1
      console.log(`✗ ${name} @${w}`)
      for (const e of consoleErrors) console.log(`   console: ${e.slice(0, 200)}`)
      for (const r of failedRequests) console.log(`   request: ${r.slice(0, 200)}`)
    } else {
      console.log(`✓ ${name} @${w}`)
    }
    await context.close()
  }
}
await browser.close()
console.log(issues === 0 ? 'SWEEP CLEAN' : `${issues} page-width combos with issues`)
