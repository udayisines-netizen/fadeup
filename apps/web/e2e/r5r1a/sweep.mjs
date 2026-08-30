import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:5199'
const OUT = process.env.QA_OUT ?? '/opt/fadeup/docs/frontend/artifacts/r5r1a'
mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '430', width: 430, height: 932, mobile: true },
  { name: '1440', width: 1440, height: 900, mobile: false },
]

const ROUTES = [
  { name: 'home', path: '/_preview/r5r' },
  { name: 'marketplace', path: '/_preview/r5r/marketplace' },
  { name: 'book', path: '/_preview/r5r/book' },
  { name: 'appointments', path: '/_preview/r5r/appointments' },
  { name: 'profile', path: '/_preview/r5r/profile' },
]

const report = []

const browser = await chromium.launch()

for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      locale: process.env.QA_LOCALE ?? 'en-US',
      permissions: [],
    })
    /*
      PIN THE LANGUAGE, DO NOT ASK FOR IT.

      `locale` above sets the BROWSER's locale, which FadeUp does not use to
      choose a language: `locale-detect` resolves a country server-side and wins.
      On a host that resolves FR, every capture in this sweep came back French —
      so `home-390`, `home-430` and `home-1440`, the three primary deliverables,
      were the French page under English names, and `home-390` was byte-identical
      to `home-fr-390`.

      `states.mjs` diagnosed and fixed exactly this and this file was not fixed
      with it, which is how a known bug survived in its sibling. QA_LOCALE now
      drives the key the language switcher actually writes.
    */
    await context.addInitScript((language) => {
      localStorage.setItem('fadeup-locale-explicit', language)
    }, (process.env.QA_LOCALE ?? 'en-US').slice(0, 2))
    const page = await context.newPage()
    const consoleErrors = []
    const consoleWarnings = []
    const failedRequests = []
    const badResponses = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
      if (msg.type() === 'warning') consoleWarnings.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
    page.on('requestfailed', (req) => failedRequests.push(`${req.url()} ${req.failure()?.errorText ?? ''}`))
    page.on('response', (res) => {
      if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`)
    })

    await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    // Wait for the app to actually mount rather than for the network to fall
    // quiet: `networkidle` never settles against a Supabase that holds a
    // connection open, and a blank capture then looks like a route defect.
    await page.waitForFunction(() => (document.getElementById('root')?.childElementCount ?? 0) > 0, {
      timeout: 20000,
    })
    // Fonts BEFORE measuring. Mid-swap the text is laid out in a fallback face
    // that is wider than the real one, so a `scrollWidth > clientWidth` probe
    // reports clipping that does not exist — it flagged a headline whose box
    // measured 640/640 the moment the swap completed.
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(700)

    const probe = await page.evaluate(() => {
      const doc = document.documentElement
      const overflow = Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth

      // Clipped leaf text: an element with no element children whose content
      // is wider or taller than its box.
      const clipped = []
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length > 0) continue
        const text = (el.textContent ?? '').trim()
        if (!text) continue
        // Skip visually-hidden content: `sr-only` is a 1px clipped box BY
        // DESIGN, so it always trips a scrollWidth test and would drown the
        // real truncations this probe exists to find.
        const box = el.getBoundingClientRect()
        if (box.width <= 2 || box.height <= 2) continue
        // Overflow alone is not truncation: text can exceed a tight line box
        // and still render in full, because nothing hides it. Only an element
        // that actually clips — or that sits inside one — loses characters.
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
        if (overflows && clips(el)) {
          clipped.push(`${el.tagName.toLowerCase()}: ${text.slice(0, 60)}`)
        }
      }

      const targets = [...document.querySelectorAll('button, a[href], [role="button"], input, select')]

      // A card-link overlay (`::after { position:absolute; inset:0 }`) makes the
      // whole positioned ancestor the hit area, so measuring the anchor's own
      // 22px text box would report a defect that does not exist. Measure what a
      // finger can actually land on.
      const hitBox = (el) => {
        const after = getComputedStyle(el, '::after')
        const overlays =
          after.position === 'absolute' &&
          after.top !== 'auto' &&
          after.left !== 'auto' &&
          after.right !== 'auto' &&
          after.bottom !== 'auto'
        if (!overlays) return el.getBoundingClientRect()
        let parent = el.parentElement
        while (parent && getComputedStyle(parent).position === 'static') parent = parent.parentElement
        return (parent ?? el).getBoundingClientRect()
      }

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

      // Widest interactive control, for the "desktop is not stretched" gate.
      let widest = 0
      let widestLabel = ''
      for (const el of targets) {
        const r = el.getBoundingClientRect()
        if (r.width > widest) {
          widest = r.width
          widestLabel = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)
        }
      }

      const shadowed = [...document.querySelectorAll('[data-fu-v2] *')].filter((el) => {
        const s = getComputedStyle(el).boxShadow
        return s && s !== 'none'
      }).length

      return {
        overflow,
        clipped,
        smallTargets: small,
        unnamedControls: unnamed,
        imagesWithoutAlt,
        h1,
        widestControl: `${Math.round(widest)}px "${widestLabel}"`,
        shadowedElements: shadowed,
        title: document.title,
        lang: doc.lang,
        dir: doc.dir,
      }
    })

    await page.screenshot({ path: `${OUT}/${route.name}-${vp.name}.png`, fullPage: true })

    const entry = {
      route: route.name,
      viewport: vp.name,
      consoleErrors,
      consoleWarnings,
      failedRequests,
      badResponses,
      ...probe,
    }
    report.push(entry)
    // One line per combination, flushed immediately. This box has two cores and
    // a browser target can crash mid-sweep; buffering the whole report until the
    // end meant one crash threw away every result before it.
    process.stderr.write(`${JSON.stringify(entry)}\n`)

    await context.close()
  }
}

await browser.close()
console.log(JSON.stringify(report, null, 2))
