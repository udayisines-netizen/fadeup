/**
 * P1PRO — preuve /platform : la surface legacy en production est intacte,
 * visuellement (Inter, pas de fuite Geist/Poppins, thème legacy sur <html>)
 * et fonctionnellement (200, rendu, zéro erreur console). À lancer contre
 * la build de PRODUCTION servie en preview.
 * Usage : QA_BASE=http://127.0.0.1:4174 node e2e/p1pro/platform-check.mjs [outdir]
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4174'
const OUT = process.argv[2] ?? '/tmp/p1pro-platform'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)))
page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`))

const response = await page.goto(`${BASE}/platform/login`, { waitUntil: 'networkidle' })
console.log('GET /platform/login →', response.status())

const probe = await page.evaluate(() => {
  const heading = document.querySelector('h1, h2, [class*=title]') ?? document.body
  const bodyFont = getComputedStyle(document.body).fontFamily
  const headingFont = getComputedStyle(heading).fontFamily
  return {
    htmlTheme: document.documentElement.getAttribute('data-theme'),
    bodyTheme: document.body.getAttribute('data-theme'),
    bodyFont,
    headingFont,
    textLength: document.body.innerText.trim().length,
  }
})
console.log(JSON.stringify(probe, null, 2))

const leak = /geist|poppins/i.test(probe.bodyFont + probe.headingFont)
console.log(leak ? 'ECHEC — fuite de police V2 dans /platform' : 'ok — aucune fuite Geist/Poppins')
console.log(probe.bodyTheme === null ? 'ok — aucun data-theme V2 sur <body> legacy' : `ATTENTION body[data-theme=${probe.bodyTheme}]`)
console.log(errors.length ? `erreurs: \n${errors.join('\n')}` : 'ok — zéro erreur console/réseau')

await page.screenshot({ path: `${OUT}/platform-login-1440.png`, fullPage: false })
console.log(`capture: ${OUT}/platform-login-1440.png`)
await browser.close()
if (leak || response.status() !== 200) process.exit(1)
