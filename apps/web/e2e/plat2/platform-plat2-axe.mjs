/**
 * PLAT-2 — axe sur les SIX écrans du lot, à 1440 px et à 390 px.
 *
 * Le relevé porte aussi le DÉBORDEMENT HORIZONTAL et le nombre de cibles
 * tactiles sous 44 px : l'écran stagiaire est le seul écran interne dessiné
 * pour le téléphone, et une exigence qu'on ne mesure pas n'est pas tenue.
 *
 * Usage : QA_BASE=http://127.0.0.1:4650 node e2e/plat2/platform-plat2-axe.mjs <outdir>
 */
import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4650'
const OUT = process.argv[2] ?? '/tmp/plat2-axe'
mkdirSync(OUT, { recursive: true })

const SCREENS = [
  ['support', '/platform/support', true],
  ['moderation', '/platform/moderation', true],
  ['sales', '/platform/sales', true],
  ['field', '/platform/field', true],
  ['posters', '/platform/posters', true],
  // La seule surface PUBLIQUE du lot : relevée sans session.
  ['poster-scan-free', '/a/QAPFREE001', false],
  ['poster-scan-unknown', '/a/ZZZZZZZZZZ', false],
]

const browser = await chromium.launch()
const authed = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await authed.newPage()

await page.goto(`${BASE}/platform/login`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'qa-plat1-founder@fadeup.test')
await page.fill('input[type="password"]', 'Plat1-QA!2026')
await Promise.all([
  page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 25_000 }),
  page.click('button[type="submit"]'),
])

const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const anonPage = await anon.newPage()

const report = []
for (const [name, path, needsAuth] of SCREENS) {
  const target = needsAuth ? page : anonPage
  for (const width of [1440, 390]) {
    await target.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await target.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await target.waitForTimeout(900)

    const geometry = await target.evaluate(() => {
      const doc = document.documentElement
      const small = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"]')]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 24)
        })
        .map((el) => `${el.tagName.toLowerCase()}:${(el.textContent ?? '').trim().slice(0, 28)}`)
      return {
        overflow: doc.scrollWidth > doc.clientWidth + 1,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        smallTargets: small.slice(0, 12),
        smallTargetCount: small.length,
      }
    })

    const results = await new AxeBuilder({ page: target }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    report.push({
      screen: `${name}@${width}`,
      ...geometry,
      violations: results.violations.length,
      serious: serious.length,
      detail: serious.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
        help: v.help,
        targets: v.nodes.slice(0, 6).map((n) => ({
          target: n.target.join(' '),
          summary: (n.failureSummary ?? '').split('\n').slice(0, 2).join(' '),
        })),
      })),
      minor: results.violations
        .filter((v) => v.impact !== 'serious' && v.impact !== 'critical')
        .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
    })
    await target.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: width === 1440 })
    console.log(
      `${name}@${width} → ${results.violations.length} violation(s), ${serious.length} sérieuse(s)` +
        (geometry.overflow ? ` [DÉBORDE ${geometry.scrollWidth}>${geometry.clientWidth}]` : '') +
        (geometry.smallTargetCount ? ` [${geometry.smallTargetCount} cible(s) < 44 px]` : ''),
    )
    for (const v of serious) console.log(`    ${v.impact} ${v.id} (${v.nodes.length}) — ${v.help}`)
  }
}

await browser.close()
writeFileSync(`${OUT}/axe.json`, JSON.stringify(report, null, 2))
const total = report.reduce((n, r) => n + r.serious, 0)
console.log(`\ntotal sérieux/critique : ${total}`)
