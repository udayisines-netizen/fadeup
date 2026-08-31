import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:4174'
const OUT = process.env.QA_OUT ?? '/tmp/claude-1002/-opt-fadeup/8bfb1de3-56bd-4c67-a04c-ef7ce1266072/scratchpad/qa-v3'
mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '1440', width: 1440, height: 900, mobile: false },
]
const ROUTES = (process.env.QA_ROUTES ?? 'home:/_preview/v3/home,marketplace:/_preview/v3/marketplace')
  .split(',')
  .map((pair) => {
    const [name, path] = pair.split(':')
    return { name, path }
  })

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

  for (const route of ROUTES) {
    errors.length = 0
    failed.length = 0
    await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/${route.name}-${vp.name}.png`, fullPage: true })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    console.log(`${route.name}@${vp.name}: overflowX=${overflow} errors=${errors.length} failed=${failed.length}`)
    errors.slice(0, 3).forEach((e) => console.log('  ERR:', e.slice(0, 140)))
    failed.slice(0, 3).forEach((f) => console.log('  REQ:', f.slice(0, 140)))
  }
  await ctx.close()
}
await browser.close()
