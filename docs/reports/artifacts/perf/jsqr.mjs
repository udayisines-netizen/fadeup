import { chromium } from 'playwright'
import sharp from 'sharp'
const PERF = 'http://127.0.0.1:4178'
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', permissions: ['camera'] })
const page = await ctx.newPage()
const reqs = []; const errors = []
page.on('request', (r) => reqs.push(r.url()))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
page.on('pageerror', (e) => errors.push('pageerror ' + String(e).slice(0, 160)))
const jsqr = () => reqs.filter((u) => /jsQR/i.test(u)).map((u) => u.split('/').pop())
await page.goto(PERF + '/q/demo-maison-kais'); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1000)
const atLoad = jsqr()
await page.getByRole('button', { name: 'Rejoindre la file' }).first().click(); await page.waitForTimeout(1500)
const atSheet = jsqr()
await page.getByRole('dialog').locator('input').first().fill('QA Perf')
await page.getByRole('dialog').getByRole('button', { name: 'Scanner le QR du salon' }).click(); await page.waitForTimeout(3000)
const atScan = jsqr()
const hasBarcodeDetector = await page.evaluate(() => 'BarcodeDetector' in window)
const videoCount = await page.locator('dialog video, [role=dialog] video').count()
await sharp(await page.screenshot({ type: 'png' })).jpeg({ quality: 82 }).toFile('/home/fadeup/worktrees/perf/docs/reports/artifacts/perf/jsqr-scan-step-perf.jpg')
console.log(JSON.stringify({ atLoad, atSheet, atScan, hasBarcodeDetector, videoCount, errors }))
await browser.close()
