/**
 * F3 — balayage navigateur manuel (hors suite Playwright test) : les pages
 * réelles de l'accueil et de la recherche à 390/430/1440, erreurs console et
 * requêtes en échec relevées. Mêmes leçons que F2 : contexte NEUF par page,
 * attendre le CONTENU (pas networkidle seul).
 * Usage : node e2e/f3/qa-sweep.mjs
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4610'
const OUT = '/tmp/f3-qa'
mkdirSync(OUT, { recursive: true })

const PAGES = [
  ['home', '/'],
  ['search', '/search'],
  ['search-query', '/search?q=maison'],
  ['search-city', '/search?city=Paris'],
  ['search-point', '/search?lat=48.8566&lng=2.3522'],
  ['search-zero-geo', '/search?lat=43.2965&lng=5.3698'],
  ['search-zero-text', '/search?q=zzz-introuvable'],
  ['search-style', '/search?q=fade'],
  ['search-filters', '/search?open=1&pmin=10&pmax=60&sort=nearest&lat=48.8566&lng=2.3522'],
  ['search-map', '/search?view=map&lat=48.8566&lng=2.3522'],
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
    await page.waitForFunction(() => (document.body.innerText ?? '').length > 30, undefined, { timeout: 20_000 })
    await page.waitForTimeout(1200)
    try {
      await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: true })
    } catch {
      await page.screenshot({ path: `${OUT}/${name}-${w}.png` })
    }
    // Débordement horizontal : la page ne défile jamais latéralement.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    if (consoleErrors.length || failedRequests.length || overflow > 1) {
      issues += 1
      console.log(`✗ ${name} @${w}${overflow > 1 ? ` overflow:${overflow}px` : ''}`)
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
