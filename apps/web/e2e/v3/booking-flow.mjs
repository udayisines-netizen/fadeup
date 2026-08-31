import { chromium } from 'playwright'
const OUT = '/tmp/claude-1002/-opt-fadeup/8bfb1de3-56bd-4c67-a04c-ef7ce1266072/scratchpad/qa-v3'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://127.0.0.1:4174/_preview/v3/s/side-agency/book', { waitUntil: 'networkidle' })
// Step 1: choose the first service
await page.getByRole('button', { name: /Coupe$|^Coupe / }).first().click()
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/booking-after-service-390.png`, fullPage: true })
// If barber step appears, pick first barber; else time step is live
const barberBtn = page.locator('.v3b-option').first()
const stepTitle = await page.locator('.v3b-step-title').first().textContent()
console.log('step after service:', stepTitle?.trim())
if (stepTitle?.includes('barber') || stepTitle?.includes('Choisir votre')) {
  await barberBtn.click()
  await page.waitForTimeout(1500)
}
await page.screenshot({ path: `${OUT}/booking-time-390.png`, fullPage: true })
const slotCount = await page.locator('.v3b-slot').count()
const chips = await page.locator('.v3b-chip').allTextContents()
console.log('context chips:', chips.join(' | '))
console.log('slots visible:', slotCount)
if (slotCount > 0) {
  await page.locator('.v3b-slot').first().click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/booking-details-390.png`, fullPage: true })
  const title = await page.locator('.v3b-step-title').first().textContent()
  console.log('final step:', title?.trim())
}
console.log('page errors:', errors.length)
await browser.close()
