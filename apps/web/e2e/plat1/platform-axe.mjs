/**
 * PLAT-1 — axe sur les écrans du lot, connecté comme fondateur puis comme
 * modérateur en vue empruntée (le bandeau agressif est le point sensible).
 *
 * Usage : QA_BASE=http://127.0.0.1:4630 node e2e/plat1/platform-axe.mjs <outdir>
 */
import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4630'
const OUT = process.argv[2] ?? '/tmp/plat1-axe'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.goto(`${BASE}/platform/login`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'qa-plat1-founder@fadeup.test')
await page.fill('input[type="password"]', 'Plat1-QA!2026')
await Promise.all([
  page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 25_000 }),
  page.click('button[type="submit"]'),
])

// Le bandeau de vue empruntée est le seul traitement visuel agressif du lot :
// il passe axe comme le reste, sinon il n'est pas « impossible à ignorer », il
// est illisible.
if (process.env.QA_SUPPORT_VIEW === '1') {
  await page.goto(`${BASE}/platform/organizations`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const href = await page.evaluate(
    () => document.querySelector('tbody a[href^="/platform/organizations/"]')?.getAttribute('href') ?? null,
  )
  if (href) {
    await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' })
    // Le bandeau porte lui aussi un bouton dont le nom contient « support » et
// il précède le contenu dans le DOM : viser /support/i tombait sur « Exit
// Support View » et refermait la session au lieu de l'ouvrir.
await page.getByRole('button', { name: /enter support view/i }).click()
    await page.waitForTimeout(1800)
  }
}

const report = []
for (const [name, path] of [
  ['login', '/platform/login'],
  ['team', '/platform/team'],
  ['audit', '/platform/audit'],
  ['organizations', '/platform/organizations'],
]) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    const bannerPresent = await page.evaluate(() => Boolean(document.querySelector('[data-plat1-support-banner]')))
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    report.push({
      screen: `${name}@${width}`,
      supportViewBanner: bannerPresent,
      violations: results.violations.length,
      serious: serious.length,
      detail: serious.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        help: v.help,
        targets: v.nodes.map((n) => ({ target: n.target.join(' '), summary: (n.failureSummary ?? '').split('\n').slice(0, 2).join(' ') })),
      })),
      minor: results.violations
        .filter((v) => v.impact !== 'serious' && v.impact !== 'critical')
        .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
    })
    console.log(
      `${name}@${width} → ${results.violations.length} violation(s), dont ${serious.length} sérieuse(s)/critique(s)` +
        (bannerPresent ? ' [bandeau de vue empruntée affiché]' : ''),
    )
    for (const v of serious) console.log(`    ${v.impact} ${v.id} (${v.nodes.length}) — ${v.help}`)
  }
}

await browser.close()
writeFileSync(`${OUT}/axe.json`, JSON.stringify(report, null, 2))
const total = report.reduce((n, r) => n + r.serious, 0)
console.log(`\ntotal sérieux/critique : ${total}`)
process.exit(total === 0 ? 0 : 1)
