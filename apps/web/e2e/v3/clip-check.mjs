import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
await page.goto('http://127.0.0.1:4174/_preview/v3', { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)
const data = await page.evaluate(() => {
  const h1 = document.querySelector('h1')
  const measure = (el) => ({
    text: el.textContent.slice(0, 30),
    scrollW: el.scrollWidth, clientW: el.clientWidth,
    scrollH: el.scrollHeight, clientH: el.clientHeight,
    overflowAncestors: (() => {
      const list = []
      let n = el.parentElement
      while (n && n !== document.body) {
        const s = getComputedStyle(n)
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible')
          list.push(`${n.className.split(' ')[0]}:${s.overflowX}/${s.overflowY}`)
        n = n.parentElement
      }
      return list
    })(),
  })
  return [measure(h1), ...[...document.querySelectorAll('h2')].slice(0, 2).map(measure)]
})
console.log(JSON.stringify(data, null, 1))
await browser.close()
