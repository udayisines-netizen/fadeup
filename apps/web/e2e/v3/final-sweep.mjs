/**
 * V3 final browser sweep — the R5R final harness's probes pointed at the V3
 * preview. Probes: horizontal overflow, clipped leaf text, sub-44px targets,
 * unnamed controls, missing alt, h1 presence, console/page errors, failed
 * requests, 4xx/5xx, lang/dir. Shadow count is INFORMATIONAL in V3 (the
 * system deliberately owns one ambient float shadow).
 *
 * QA_LOCALE drives the key the language switcher actually writes;
 * QA_PRO_EMAIL/QA_PRO_PASSWORD sign into authed pro routes (never committed
 * credentials — a deletable local QA login provided per run).
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4174'
const OUT = process.env.QA_OUT ?? '/tmp/claude-1002/-opt-fadeup/8bfb1de3-56bd-4c67-a04c-ef7ce1266072/scratchpad/qa-v3-final'
mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '430', width: 430, height: 932, mobile: true },
  { name: '1440', width: 1440, height: 900, mobile: false },
]

const ROUTES = [
  { name: 'landing', path: '/_preview/v3' },
  { name: 'home', path: '/_preview/v3/home' },
  { name: 'marketplace', path: '/_preview/v3/marketplace' },
  { name: 'shop', path: '/_preview/v3/s/side-agency' },
  { name: 'barber', path: '/_preview/v3/s/side-agency/b/e9cf978d-f12e-4b82-872d-a2d1430136fb' },
  { name: 'booking', path: '/_preview/v3/s/side-agency/book' },
  { name: 'book', path: '/_preview/v3/book' },
  { name: 'queue', path: '/_preview/v3/queue' },
  { name: 'appointments', path: '/_preview/v3/appointments' },
  { name: 'profile', path: '/_preview/v3/profile' },
  { name: 'passport', path: '/_preview/v3/profile/passport' },
  { name: 'pro-dashboard', path: '/_preview/v3/pro', authed: true },
  { name: 'pro-calendar', path: '/_preview/v3/pro/calendar', authed: true },
  { name: 'pro-customers', path: '/_preview/v3/pro/customers', authed: true },
  { name: 'pro-analytics', path: '/_preview/v3/pro/analytics', authed: true },
  { name: 'pro-retention', path: '/_preview/v3/pro/retention', authed: true },
  { name: 'pro-editor', path: '/_preview/v3/pro/profile', authed: true },
]

const onlyRoutes = process.env.QA_ONLY ? new Set(process.env.QA_ONLY.split(',')) : null
const skipAuthed = process.env.QA_SKIP_AUTHED === '1'

const report = []
const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    if (onlyRoutes && !onlyRoutes.has(route.name)) continue
    if (route.authed && skipAuthed) continue
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      locale: process.env.QA_LOCALE ?? 'en-US',
      permissions: [],
    })
    await context.addInitScript((language) => {
      localStorage.setItem('fadeup-locale-explicit', language)
    }, (process.env.QA_LOCALE ?? 'en-US').slice(0, 2))
    const page = await context.newPage()
    const consoleErrors = []
    const failedRequests = []
    const badResponses = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
    page.on('requestfailed', (req) => failedRequests.push(`${req.url()} ${req.failure()?.errorText ?? ''}`))
    page.on('response', (res) => {
      if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`)
    })

    await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    if (route.authed) {
      await page.waitForTimeout(1500)
      if (page.url().includes('/login')) {
        const email = process.env.QA_PRO_EMAIL
        const password = process.env.QA_PRO_PASSWORD
        if (!email || !password) {
          throw new Error('Authed routes need QA_PRO_EMAIL / QA_PRO_PASSWORD in the environment')
        }
        await page.fill('input[type="email"]', email)
        await page.fill('input[type="password"]', password)
        await page.click('button[type="submit"]')
        await page.waitForURL('**/_preview/v3/pro**', { timeout: 20000 }).catch(() => {})
        await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      }
    }
    await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, {
      timeout: 20000,
    })
    await page.evaluate(() => document.fonts.ready)
    // Trigger lazy media, then settle.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) {
        window.scrollTo(0, y)
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      window.scrollTo(0, 0)
    })
    await page.waitForTimeout(700)

    const probe = await page.evaluate(() => {
      const doc = document.documentElement
      const overflow = Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth

      const clipped = []
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length > 0) continue
        const text = (el.textContent ?? '').trim()
        if (!text) continue
        const box = el.getBoundingClientRect()
        if (box.width <= 2 || box.height <= 2) continue
        const clips = (node) => {
          let n = node
          while (n && n !== document.body) {
            const s = getComputedStyle(n)
            if (s.overflowX !== 'visible' || s.overflowY !== 'visible') return true
            n = n.parentElement
          }
          return false
        }
        const overflows = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
        if (overflows && clips(el)) clipped.push(`${el.tagName.toLowerCase()}: ${text.slice(0, 60)}`)
      }

      const targets = [...document.querySelectorAll('button, a[href], [role="button"], input, select')]
        // maplibre's own zoom chrome is not FadeUp's to restyle.
        .filter((el) => !el.closest('.maplibregl-map'))

      const hitBox = (el) => el.getBoundingClientRect()

      const small = targets
        .filter((el) => {
          const r = hitBox(el)
          return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)
        })
        .map((el) => {
          const r = hitBox(el)
          const name = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30)
          return `${el.tagName.toLowerCase()} "${name}" ${Math.round(r.width)}x${Math.round(r.height)}`
        })

      const unnamed = targets
        .filter((el) => {
          if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return false
          const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()
          return name.length === 0
        })
        .map((el) => el.outerHTML.slice(0, 90))

      const imagesWithoutAlt = [...document.querySelectorAll('img')].filter((img) => !img.hasAttribute('alt')).length
      const h1 = [...document.querySelectorAll('h1')].map((el) => (el.textContent ?? '').trim())

      return {
        overflow,
        clipped: clipped.slice(0, 6),
        smallTargets: small.slice(0, 8),
        unnamedControls: unnamed.slice(0, 4),
        imagesWithoutAlt,
        h1,
        title: document.title,
        lang: doc.lang,
        dir: doc.dir,
      }
    })

    const suffix = process.env.QA_LOCALE ? `-${process.env.QA_LOCALE.slice(0, 2)}` : ''
    await page.screenshot({ path: `${OUT}/${route.name}${suffix}-${vp.name}.png`, fullPage: true })

    const entry = {
      route: route.name,
      viewport: vp.name,
      consoleErrors: consoleErrors.slice(0, 4),
      failedRequests: failedRequests.slice(0, 4),
      badResponses: badResponses.slice(0, 4),
      ...probe,
    }
    report.push(entry)
    process.stderr.write(`${JSON.stringify(entry)}\n`)
    await context.close()
  }
}

await browser.close()

const findings = report.filter(
  (entry) =>
    entry.overflow > 0 ||
    entry.clipped.length > 0 ||
    entry.smallTargets.length > 0 ||
    entry.unnamedControls.length > 0 ||
    entry.imagesWithoutAlt > 0 ||
    entry.h1.length === 0 ||
    entry.consoleErrors.length > 0 ||
    entry.failedRequests.length > 0 ||
    entry.badResponses.length > 0,
)
console.log(`SWEEP ${report.length} combinations, ${findings.length} with findings`)
for (const entry of findings) {
  console.log(`- ${entry.route}@${entry.viewport}:`, JSON.stringify({ ...entry, title: undefined }, null, 0).slice(0, 400))
}
