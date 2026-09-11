// PERF — preuve A/B pixel : build de la base (3a0f5e4, :4177) vs build du lot (:4178).
// Captures back-to-back, diff sur pixels bruts (sharp, seuil 8/255 sur un canal).
// Archive JPEG des deux côtés + résumé JSON/MD dans docs/reports/artifacts/perf/.
import { chromium } from 'playwright'
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = 'http://127.0.0.1:4177'
const PERF = 'http://127.0.0.1:4178'
const OUT = '/home/fadeup/worktrees/perf/docs/reports/artifacts/perf'
mkdirSync(OUT, { recursive: true })

const STAFF = { email: 'qa.perf.platform@fadeup.test', password: 'QaPerf!2026' }
const NOSTAFF = { email: 'qa.perf.nostaff@fadeup.test', password: 'QaPerf!2026' }

const browser = await chromium.launch()
const results = []
const notes = []

async function settle(page) {
  try { await page.waitForLoadState('networkidle', { timeout: 15_000 }) } catch { notes.push(`networkidle timeout ${page.url()}`) }
  await page.waitForTimeout(1500)
}

function watch(page, bag) {
  page.on('console', (m) => { if (m.type() === 'error') bag.consoleErrors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => bag.consoleErrors.push('pageerror: ' + String(e).slice(0, 200)))
  page.on('response', (r) => { if (r.status() >= 400) bag.failed.push(`${r.status()} ${r.url().slice(0, 140)}`) })
  page.on('request', (r) => bag.requests.push(r.url()))
}

async function diff(aPng, bPng) {
  const a = await sharp(aPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const b = await sharp(bPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return { pct: NaN, sizeA: `${a.info.width}x${a.info.height}`, sizeB: `${b.info.width}x${b.info.height}` }
  }
  let bad = 0
  const n = a.info.width * a.info.height
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (Math.abs(a.data[o] - b.data[o]) > 8 || Math.abs(a.data[o + 1] - b.data[o + 1]) > 8 || Math.abs(a.data[o + 2] - b.data[o + 2]) > 8) bad++
  }
  return { pct: (bad * 100) / n, size: `${a.info.width}x${a.info.height}` }
}

async function archive(name, side, png) {
  await sharp(png).jpeg({ quality: 82 }).toFile(`${OUT}/${name}-${side}.jpg`)
}

async function login(page, origin, creds) {
  await page.goto(`${origin}/platform/login`)
  await settle(page)
  await page.locator('input[type="email"]').fill(creds.email)
  await page.locator('input[type="password"]').fill(creds.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/platform/login'), { timeout: 20_000 }).catch(() => notes.push('login: pas de redirection'))
  await settle(page)
}

// ---------- 1. Consumer + platform/login, anonymes, 390 et 1440 ----------
const anonScreens = [
  ['home', '/'], ['search', '/search'], ['pro-demo', '/pro/demo'], ['queue-demo', '/q/demo-maison-kais'], ['platform-login', '/platform/login'],
]
for (const width of [390, 1440]) {
  for (const [name, path] of anonScreens) {
    if (name === 'platform-login' && width === 390) continue
    const shots = {}
    const bags = {}
    for (const [side, origin] of [['base', BASE], ['perf', PERF]]) {
      const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: 'fr-FR', reducedMotion: 'reduce' })
      const page = await ctx.newPage()
      const bag = { consoleErrors: [], failed: [], requests: [] }
      watch(page, bag)
      await page.goto(origin + path)
      await settle(page)
      shots[side] = await page.screenshot({ type: 'png' })
      bags[side] = bag
      await ctx.close()
    }
    const d = await diff(shots.base, shots.perf)
    const label = `${name}-${width}`
    await archive(label, 'base', shots.base); await archive(label, 'perf', shots.perf)
    results.push({ screen: label, ...d, perfConsoleErrors: bags.perf.consoleErrors, perfFailed: bags.perf.failed,
      perfForbiddenChunks: bags.perf.requests.filter((u) => /\/assets\/(platform|maplibre|marketing|pro|jsQR)-/.test(u)).map((u) => u.split('/').pop()) })
    console.log(label, d)
  }
}

// ---------- 2. /platform connecté staff, 1440 ----------
const staffScreens = [['platform-overview', '/platform'], ['platform-organizations', '/platform/organizations'], ['platform-audit', '/platform/audit'], ['platform-acquisition-map', '/platform/acquisition/map']]
{
  const shots = {}; const bags = {}
  for (const [side, origin] of [['base', BASE], ['perf', PERF]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    const bag = { consoleErrors: [], failed: [], requests: [] }
    watch(page, bag)
    await login(page, origin, STAFF)
    shots[side] = {}
    for (const [name, path] of staffScreens) {
      await page.goto(origin + path)
      await settle(page)
      if (name === 'platform-acquisition-map') await page.waitForTimeout(4000)
      shots[side][name] = await page.screenshot({ type: 'png' })
    }
    bags[side] = { ...bag, finalUrl: page.url() }
    await ctx.close()
  }
  for (const [name] of staffScreens) {
    const d = await diff(shots.base[name], shots.perf[name])
    await archive(name, 'base', shots.base[name]); await archive(name, 'perf', shots.perf[name])
    results.push({ screen: name + ' (staff connecté)', ...d })
    console.log(name, d)
  }
  results.push({ screen: 'platform staff session (perf)', perfConsoleErrors: bags.perf.consoleErrors, perfFailed: bags.perf.failed,
    maplibreLoaded: bags.perf.requests.some((u) => /\/assets\/maplibre-/.test(u)), platformChunksLoaded: bags.perf.requests.filter((u) => /\/assets\/platform-/.test(u)).length })
  results.push({ screen: 'platform staff session (base)', baseConsoleErrors: bags.base.consoleErrors, baseFailed: bags.base.failed })
}

// ---------- 3. Garde /platform : anonyme, route profonde, non-staff ----------
for (const [side, origin] of [['base', BASE], ['perf', PERF]]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  const guard = { side }
  await page.goto(origin + '/platform'); await settle(page)
  guard.anonRoot = page.url().replace(origin, '')
  await page.goto(origin + '/platform/organizations'); await settle(page)
  guard.anonDeep = page.url().replace(origin, '')
  guard.anonDeepShot = await page.screenshot({ type: 'png' })
  await login(page, origin, NOSTAFF)
  await page.goto(origin + '/platform'); await settle(page)
  guard.nostaffUrl = page.url().replace(origin, '')
  const text = await page.locator('body').innerText()
  guard.nostaffRefused = /doesn't have FadeUp platform access/.test(text)
  guard.nostaffNavCount = await page.locator('nav a[href^="/platform/"]').count()
  guard.nostaffShot = await page.screenshot({ type: 'png' })
  await ctx.close()
  results.push({ screen: `garde-${side}`, anonRoot: guard.anonRoot, anonDeep: guard.anonDeep, nostaffUrl: guard.nostaffUrl, nostaffRefused: guard.nostaffRefused, nostaffNavCount: guard.nostaffNavCount })
  globalThis[`guard_${side}`] = guard
}
{
  const d1 = await diff(globalThis.guard_base.anonDeepShot, globalThis.guard_perf.anonDeepShot)
  const d2 = await diff(globalThis.guard_base.nostaffShot, globalThis.guard_perf.nostaffShot)
  await archive('garde-anon-deep', 'base', globalThis.guard_base.anonDeepShot); await archive('garde-anon-deep', 'perf', globalThis.guard_perf.anonDeepShot)
  await archive('garde-nostaff', 'base', globalThis.guard_base.nostaffShot); await archive('garde-nostaff', 'perf', globalThis.guard_perf.nostaffShot)
  results.push({ screen: 'garde-anon-deep (redirection login)', ...d1 })
  results.push({ screen: 'garde-nostaff (refus)', ...d2 })
  console.log('garde', d1, d2)
}

// ---------- 4. jsQR ne part qu'au scan (perf, 390) ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  const bag = { consoleErrors: [], failed: [], requests: [] }
  watch(page, bag)
  const jsqr = () => bag.requests.filter((u) => /jsQR/i.test(u)).length
  await page.goto(PERF + '/q/demo-maison-kais'); await settle(page)
  const atLoad = jsqr()
  await page.getByRole('button', { name: 'Rejoindre la file' }).first().click()
  await page.waitForTimeout(1500)
  const atSheet = jsqr()
  const nameInput = page.getByRole('dialog').locator('input').first()
  await nameInput.fill('QA Perf')
  await page.getByRole('dialog').getByRole('button', { name: 'Scanner le QR du salon' }).click()
  await page.waitForTimeout(3000)
  const atScan = jsqr()
  const shot = await page.screenshot({ type: 'png' })
  await archive('jsqr-scan-step', 'perf', shot)
  results.push({ screen: 'jsQR', requestsAtLoad: atLoad, requestsAtSheet: atSheet, requestsAtScan: atScan, chunk: bag.requests.filter((u) => /jsQR/i.test(u)).map((u) => u.split('/').pop()), consoleErrors: bag.consoleErrors })
  console.log('jsQR', atLoad, atSheet, atScan)
  await ctx.close()
}

await browser.close()
writeFileSync(`${OUT}/ab-summary.json`, JSON.stringify({ base: '3a0f5e4', notes, results }, null, 2))
console.log('NOTES', notes)
