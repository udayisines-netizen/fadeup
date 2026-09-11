/**
 * PLAT-1 — relevé de non-régression de la console /platform.
 *
 * Parcourt les 30 routes de la surface, connecté ou non selon la route, et
 * produit pour chacune : capture 1440 px, capture 390 px, empreinte DOM
 * (titre, nombre de liens de navigation, longueur du texte, présence des
 * repères), erreurs console et réponses HTTP >= 400.
 *
 * Le fichier JSON produit est la référence : « avant » et « après » doivent
 * être identiques champ à champ, hors horodatages.
 *
 * Usage :
 *   QA_BASE=http://127.0.0.1:4630 QA_EMAIL=... QA_PASSWORD=... \
 *   node e2e/plat1/platform-baseline.mjs <outdir> [label]
 */
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4630'
const EMAIL = process.env.QA_EMAIL ?? 'qa-plat1-founder@fadeup.test'
const PASSWORD = process.env.QA_PASSWORD ?? 'Plat1-QA!2026'
const OUT = process.argv[2] ?? '/tmp/plat1-baseline'
const LABEL = process.argv[3] ?? 'avant'
mkdirSync(OUT, { recursive: true })

/** Les routes publiques de la surface (hors garde). */
const PUBLIC_ROUTES = [
  ['platform-login', '/platform/login'],
  ['platform-claim-token', '/platform/claim/qa-plat1-jeton-inexistant'],
  ['platform-invite-token', '/platform/invite/qa-plat1-jeton-inexistant'],
]

/** Les routes gardées, dans l'ordre de déclaration du routeur. */
const GUARDED_ROUTES = [
  ['overview', '/platform'],
  ['applications', '/platform/applications'],
  ['organizations', '/platform/organizations'],
  ['acquisition-overview', '/platform/acquisition'],
  ['acquisition-search', '/platform/acquisition/search'],
  ['acquisition-map', '/platform/acquisition/map'],
  ['acquisition-prospects', '/platform/acquisition/prospects'],
  ['acquisition-competitors', '/platform/acquisition/competitors'],
  ['acquisition-barbershops', '/platform/acquisition/barbershops'],
  ['acquisition-independent-barbers', '/platform/acquisition/independent-barbers'],
  ['acquisition-jobs', '/platform/acquisition/jobs'],
  ['acquisition-sources', '/platform/acquisition/sources'],
  ['acquisition-api-usage', '/platform/acquisition/api-usage'],
  ['acquisition-duplicates', '/platform/acquisition/duplicates'],
  ['acquisition-publication', '/platform/acquisition/publication'],
  ['acquisition-claims', '/platform/acquisition/claims'],
  ['acquisition-pipeline', '/platform/acquisition/pipeline'],
  ['acquisition-suppressions', '/platform/acquisition/suppressions'],
  ['outreach-index', '/platform/outreach'],
  ['outreach-whatsapp', '/platform/outreach/whatsapp'],
  ['outreach-templates', '/platform/outreach/templates'],
  ['outreach-experiments', '/platform/outreach/experiments'],
  ['outreach-replies', '/platform/outreach/replies'],
  ['data-science-index', '/platform/data-science'],
  ['data-science-dataset', '/platform/data-science/dataset'],
  ['data-science-performance', '/platform/data-science/performance'],
  ['team', '/platform/team'],
  ['audit', '/platform/audit'],
  ['unknown-platform-route', '/platform/cette-route-nexiste-pas'],
]

const probe = () => {
  const nav = document.querySelector('header nav, nav')
  const headings = [...document.querySelectorAll('h1, h2')].map((h) => h.textContent.trim()).filter(Boolean)
  return {
    title: document.title,
    htmlTheme: document.documentElement.getAttribute('data-theme'),
    bodyTheme: document.body.getAttribute('data-theme'),
    bodyFont: getComputedStyle(document.body).fontFamily,
    headings: headings.slice(0, 12),
    navLinks: [...document.querySelectorAll('header a[href^="/platform"], nav a[href^="/platform"]')].map((a) => a.getAttribute('href')),
    tabLinks: [...document.querySelectorAll('main a[href^="/platform"]')].length,
    tables: document.querySelectorAll('table').length,
    buttons: document.querySelectorAll('button').length,
    inputs: document.querySelectorAll('input, select, textarea').length,
    textLength: document.body.innerText.trim().length,
    hasSupportBanner: Boolean(document.querySelector('[data-plat1-support-banner]')),
    bodyTextHead: document.body.innerText.trim().slice(0, 220).replace(/\s+/g, ' '),
  }
}

const browser = await chromium.launch()
const results = []

async function sweep(context, routes, authed) {
  for (const [name, path] of routes) {
    // Une page neuve par route : sur cette machine à deux cœurs, réutiliser
    // un onglet sur trente écrans finit par le faire tomber (Page crashed).
    const page = await context.newPage()
    const errors = []
    const failed = []
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200))
    const onResponse = (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '').split('?')[0].slice(0, 140)}`)
    page.on('console', onConsole)
    page.on('response', onResponse)

    await page.setViewportSize({ width: 1440, height: 900 })
    const response = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch((e) => ({ status: () => `ERR ${e.message.slice(0, 80)}` }))
    await page.waitForTimeout(700)
    const dom = await page.evaluate(probe)
    const finalUrl = page.url().replace(BASE, '')
    await page.screenshot({ path: `${OUT}/${LABEL}-${authed ? 'auth' : 'anon'}-${name}-1440.png`, fullPage: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(400)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    await page.screenshot({ path: `${OUT}/${LABEL}-${authed ? 'auth' : 'anon'}-${name}-390.png` })

    page.off('console', onConsole)
    page.off('response', onResponse)
    await page.close()
    results.push({ name, path, authed, status: response.status(), finalUrl, dom, overflow390: overflow, consoleErrors: errors.sort(), httpFailures: [...new Set(failed)].sort() })
    process.stdout.write(`${authed ? 'auth' : 'anon'} ${path} → ${response.status()} ${finalUrl}${errors.length ? ` [${errors.length} err]` : ''}\n`)
  }
}

// 1. anonyme
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await sweep(anon, PUBLIC_ROUTES, false)
// la garde : /platform sans session doit renvoyer vers /platform/login
await sweep(anon, [['guard-redirect', '/platform/organizations']], false)
await anon.close()

// 2. connecté
const authed = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const login = await authed.newPage()
await login.goto(`${BASE}/platform/login`, { waitUntil: 'networkidle' })
await login.fill('input[type="email"]', EMAIL)
await login.fill('input[type="password"]', PASSWORD)
await Promise.all([
  login.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20_000 }),
  login.click('button[type="submit"]'),
])
console.log('connexion →', login.url().replace(BASE, ''))
await login.close()
await sweep(authed, GUARDED_ROUTES, true)
await authed.close()

await browser.close()
writeFileSync(`${OUT}/${LABEL}.json`, JSON.stringify(results, null, 2))
console.log(`\n${results.length} routes relevées → ${OUT}/${LABEL}.json`)
const totalErrors = results.reduce((n, r) => n + r.consoleErrors.length, 0)
const totalFailures = results.reduce((n, r) => n + r.httpFailures.length, 0)
console.log(`erreurs console : ${totalErrors} — réponses >= 400 : ${totalFailures}`)
