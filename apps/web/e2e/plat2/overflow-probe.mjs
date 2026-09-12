/**
 * PLAT-2 — LA sonde de débordement horizontal à 390 px.
 *
 * `documentElement.scrollWidth > clientWidth` (l'heuristique du relevé PLAT-1)
 * RÉPOND VRAI sur des pages qui ne défilent pas : Chrome y compte la largeur
 * d'éléments pourtant contenus dans un conteneur qui défile. La seule mesure
 * qui ne ment pas est de TENTER de faire défiler la page et de regarder où
 * elle s'arrête.
 */
import { chromium } from '@playwright/test'
const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4650'
const PATHS = (process.env.QA_PATHS ?? '/platform/support,/platform/moderation,/platform/sales,/platform/field,/platform/posters,/a/QAPFREE001,/platform/team,/platform/acquisition/jobs').split(',')
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.goto(`${BASE}/platform/login`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'qa-plat1-founder@fadeup.test')
await page.fill('input[type="password"]', 'Plat1-QA!2026')
await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('/login')), page.click('button[type="submit"]')])
const out = []
for (const path of PATHS) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const r = await page.evaluate(() => {
    window.scrollTo(9999, 0)
    const scrolled = Math.round(window.scrollX)
    window.scrollTo(0, 0)
    return {
      heuristiquePlat1: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      defilementReel: scrolled,
    }
  })
  out.push({ path, ...r })
  console.log(
    `${path.padEnd(30)} défilement réel : ${String(r.defilementReel).padStart(4)} px` +
      `  (heuristique PLAT-1 : ${r.heuristiquePlat1 ? 'DÉBORDE' : 'ok'}, doc ${r.docScrollWidth}, body ${r.bodyScrollWidth})`,
  )
}
await browser.close()
