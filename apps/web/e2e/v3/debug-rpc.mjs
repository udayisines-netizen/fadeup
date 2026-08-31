import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
let body = null
page.on('response', async (r) => {
  if (r.url().includes('search_public_professionals')) {
    try { body = await r.json() } catch {}
  }
})
await page.goto('http://127.0.0.1:4174/_preview/v3', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
console.log(JSON.stringify(body?.map?.((row) => ({
  name: row.location_name, lat: row.latitude, lng: row.longitude, city: row.city,
  open: row.is_open_now, price: row.starting_price_cents, q: row.queue_waiting_count,
})) ?? body, null, 1))
await browser.close()
