import { chromium } from '@playwright/test'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4610'
const PAGES = [
  ['professionals-data', '/professionals-data'],
  ['professionals-data-prefilled', '/professionals-data?pro=demo.moussa.diakite'],
  ['unsubscribe', '/unsubscribe/qa-x2-token'],
  ['pro-unclaimed', '/pro/demo.moussa.diakite'],
  ['pro-claimed', '/pro/demo.kais.bellamine'],
]
const WIDTHS = [[390, 844], [430, 932], [1440, 900]]
const outDir = process.argv[2]

for (const [w, h] of WIDTHS) {
  for (const [name, path] of PAGES) {
    const browser = await chromium.launch()
    const context = await browser.newContext({ viewport: { width: w, height: h } })
    const page = await context.newPage()
    const consoleIssues = []
    const failedRequests = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') consoleIssues.push(`${msg.type()}: ${msg.text().slice(0, 160)}`)
    })
    page.on('requestfailed', (req) => failedRequests.push(`${req.method()} ${req.url().slice(0, 120)} — ${req.failure()?.errorText}`))
    page.on('response', (res) => { if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url().slice(0, 120)}`) })
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    // Leçon F2 : attendre le CONTENU, pas networkidle seul.
    await page.waitForSelector('h1', { timeout: 20000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${outDir}/${name}-${w}.png`, fullPage: true })
    console.log(`${name} @${w}: console=[${consoleIssues.join(' | ') || 'propre'}] réseau=[${failedRequests.join(' | ') || 'propre'}]`)
    await browser.close()
  }
}
