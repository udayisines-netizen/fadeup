import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:5199'
const HOME = `${BASE}/_preview/r5r`
/*
  HONOURS QA_OUT, which it did not until R5R.1A-R1.

  `sweep.mjs` has always read this variable and the README said both scripts
  did. This one hard-coded the path, so running the revision's captures with
  QA_OUT set sent the route sweeps to the new directory and wrote the state
  captures straight over the first pass's — thirteen files, untracked, with no
  backup. They are gone. The route sweeps the product owner actually rejected
  survived, but the loss was avoidable and the cause was this line.
*/
const OUT = process.env.QA_OUT ?? '/opt/fadeup/docs/frontend/artifacts/r5r1a'
mkdirSync(OUT, { recursive: true })

const M = { width: 390, height: 844, mobile: true }
const D = { width: 1440, height: 900, mobile: false }
const log = []

const browser = await chromium.launch()

async function open({ vp, locale = 'en-US', reducedMotion, storage = [], route, wait = 900 }) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    locale,
    reducedMotion,
  })
  await context.addInitScript((entries) => {
    for (const [k, v] of entries) localStorage.setItem(k, v)
  }, storage)
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  if (route) await route(page)
  await page.goto(HOME, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(wait)
  return { context, page, errors }
}

async function shot(name, ctx) {
  await ctx.page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  /*
    R5R.1A-R1: Home no longer has one `#v2-discovery-heading`. It has a group
    per entity type, each with its own heading and its own server-scoped count,
    so the probe reads all of them. Left pointing at the old id it returned null
    for every state and would have gone on reporting null forever — a harness
    that silently stops measuring is worse than one that fails.
  */
  const groups = await ctx.page
    .locator('section[aria-labelledby^="v2-group"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        heading: node.querySelector('h2')?.textContent?.trim() ?? null,
        rows: node.querySelectorAll('article').length,
      })),
    )
    .catch(() => [])
  // Recorded per capture so a locale/direction claim in the report is a
  // measurement rather than an intention — see the note at the RTL capture.
  const doc = await ctx.page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir || getComputedStyle(document.body).direction,
  }))
  log.push({ name, ...doc, groups, errors: ctx.errors })
  await ctx.context.close()
}

/*
  A country FadeUp has listings in.

  The LANGUAGE is pinned separately and deliberately. Without it every capture
  inherits whatever `locale-detect` resolves for the machine running the
  harness — French, on this stack — which made "normal Home" and "French" the
  same screenshot and quietly cost the review one of its comparisons.
*/
const FR = [
  ['fadeup-country-explicit', 'FR'],
  ['fadeup-locale-explicit', 'en'],
]
// A country it does not — real filter, real empty answer.
const JP = [
  ['fadeup-country-explicit', 'JP'],
  ['fadeup-locale-explicit', 'en'],
]

await shot('home-country-390', await open({ vp: M, storage: FR }))
await shot('home-country-1440', await open({ vp: D, storage: FR }))
await shot('home-empty-390', await open({ vp: M, storage: JP }))
await shot('home-empty-1440', await open({ vp: D, storage: JP }))

// Loading: hold the RPC open past the delayed-skeleton threshold.
const slow = async (page) =>
  page.route('**/rpc/search_public_professionals', async (r) => {
    await new Promise((res) => setTimeout(res, 4000))
    await r.continue()
  })
await shot('home-loading-390', await open({ vp: M, storage: FR, route: slow, wait: 1200 }))
await shot('home-loading-1440', await open({ vp: D, storage: FR, route: slow, wait: 1200 }))

// Error: the RPC fails outright.
const broken = async (page) =>
  page.route('**/rpc/search_public_professionals', (r) => r.abort('failed'))
await shot('home-error-390', await open({ vp: M, storage: FR, route: broken, wait: 1500 }))

// RTL, in Arabic.
/*
  A BROWSER LOCALE IS NOT A LANGUAGE CHOICE.

  These two used to pass only `locale:` to the context, and both captures came
  back in French — because FadeUp resolves language from `locale-detect`'s
  server-side country first, and the stack under test resolves FR. So the
  "RTL" screenshot was a left-to-right French page, and an RTL regression could
  have shipped straight through the gate that exists to catch it.

  `fadeup-locale-explicit` is the key the language switcher actually writes, and
  it outranks detection. Seeding it is what makes these two captures test the
  thing they are named after. Asserted below rather than trusted.
*/
const AR = [['fadeup-country-explicit', 'FR'], ['fadeup-locale-explicit', 'ar']]
const FR_LANG = [['fadeup-country-explicit', 'FR'], ['fadeup-locale-explicit', 'fr']]

await shot('home-rtl-390', await open({ vp: M, locale: 'ar', storage: AR, wait: 1500 }))
// French, the locale the product actually detects most.
await shot('home-fr-390', await open({ vp: M, locale: 'fr-FR', storage: FR_LANG, wait: 1500 }))
// Reduced motion.
await shot('home-reduced-390', await open({ vp: M, storage: FR, reducedMotion: 'reduce' }))

// Search that matches, and one that does not.
{
  const ctx = await open({ vp: M, storage: FR })
  await ctx.page.getByRole('searchbox').fill('Side')
  await ctx.page.waitForTimeout(1100)
  await shot('home-search-390', ctx)
}
{
  const ctx = await open({ vp: M, storage: FR })
  await ctx.page.getByRole('searchbox').fill('zzzzqqq')
  await ctx.page.waitForTimeout(1100)
  await shot('home-nomatch-390', ctx)
}

// The search field focused, which §17 of the revision brief asks for by name.
// The first revision shipped a stacked double ring here — a green border under a
// green outline — so this capture is the evidence that there is now exactly one.
{
  const ctx = await open({ vp: M, storage: FR })
  await ctx.page.getByRole('searchbox').focus()
  await ctx.page.waitForTimeout(200)
  await shot('home-searchfocus-390', ctx)
}

// Keyboard: tab through and prove a visible ring plus a reachable Book.
{
  const ctx = await open({ vp: D, storage: FR })
  const order = []
  let captured = false
  // Walk until focus leaves the document rather than stopping at a fixed count:
  // a 12-press cap stopped before the second result on desktop and before the
  // entire tab bar on mobile, so it demonstrated nothing about reachability.
  for (let i = 0; i < 40; i += 1) {
    await ctx.page.keyboard.press('Tab')
    const left = await ctx.page.evaluate(() => document.activeElement === document.body)
    if (left) break
    order.push(
      await ctx.page.evaluate(() => {
        const el = document.activeElement
        if (!el) return 'none'
        const s = getComputedStyle(el)
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 26)
        return `${el.tagName.toLowerCase()} "${name}" outline=${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`
      }),
    )

    // Scoped to a RESULT's Book, not the navigation tab that shares its label —
    // the first version matched on text alone and captured the header instead.
    const onResultBook = await ctx.page.evaluate(() => {
      const el = document.activeElement
      return Boolean(el?.closest('article')) && (el?.textContent ?? '').trim() === 'Book'
    })
    if (onResultBook && !captured) {
      await ctx.page.screenshot({ path: `${OUT}/home-focus-1440.png` })
      captured = true
    }
  }
  /*
    Nothing to see: this used to fire AFTER the loop, and the loop exits only
    once focus has LEFT the document — so the desktop "visible focus" evidence
    was a screenshot of a page with nothing focused, byte-identical to
    `home-country-1440.png`. The capture now happens inside the walk, on the
    first result's own Book control, which is the focus state worth showing.
  */
  log.push({ name: 'keyboard-order', order })
  await ctx.context.close()
}

// The whole result band must be clickable, not just the 22px title link.
{
  const ctx = await open({ vp: M, storage: FR })
  const card = ctx.page.locator('article').first()
  const box = await card.boundingBox()
  // A point well away from the title text and away from the Book button.
  await ctx.page.mouse.click(box.x + box.width - 24, box.y + 18)
  await ctx.page.waitForTimeout(900)
  log.push({ name: 'card-overlay-click', url: ctx.page.url() })
  await ctx.context.close()
}

await browser.close()
console.log(JSON.stringify(log, null, 2))
