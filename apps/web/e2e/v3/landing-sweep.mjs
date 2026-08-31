import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:4174'
const OUT = '/tmp/claude-1002/-opt-fadeup/8bfb1de3-56bd-4c67-a04c-ef7ce1266072/scratchpad/qa-v3'
mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '1440', width: 1440, height: 900, mobile: false },
  { name: '1920', width: 1920, height: 1080, mobile: false },
]

const browser = await chromium.launch()
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile,
    deviceScaleFactor: vp.mobile ? 2 : 1,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  const failed = []
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`))

  await page.goto(`${BASE}/_preview/v3`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  // scroll through to trigger lazy media, then return to top
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 60))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(800)

  // viewport (hero) shot
  await page.screenshot({ path: `${OUT}/landing-hero-${vp.name}.png` })
  // full page
  await page.screenshot({ path: `${OUT}/landing-full-${vp.name}.png`, fullPage: true })

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  console.log(`${vp.name}: overflowX=${overflow}px, consoleErrors=${errors.length}, failedReq=${failed.length}`)
  errors.slice(0, 5).forEach((e) => console.log('  ERR:', e.slice(0, 160)))
  failed.slice(0, 5).forEach((f) => console.log('  REQ:', f.slice(0, 160)))
  await ctx.close()
}
await browser.close()
console.log('done')
