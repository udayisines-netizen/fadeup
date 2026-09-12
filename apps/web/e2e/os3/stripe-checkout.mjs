// B3 — complète la session Stripe Checkout de TEST avec la carte 4242.
// Preuve du tunnel de souscription de bout en bout, sans navigateur humain.
import { chromium } from "@playwright/test"
import { readFileSync } from 'node:fs'

const url = readFileSync(process.argv[2], 'utf8').trim()
const browser = await chromium.launch()
const page = await browser.newPage()
page.setDefaultTimeout(30000)

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  // Champs du Checkout hébergé (ids stables côté Stripe).
  const email = page.locator('#email')
  if (await email.isVisible().catch(() => false)) {
    await email.fill('b3-qa-owner@fadeup.test')
  }
  // Le moyen « Card » est un accordéon : on l'ouvre d'abord.
  // Ouvre l'accordéon « Card » : viser le conteneur AccordionItem entier.
  const cardItem = page.locator('[data-testid="card-accordion-item"]')
  if (await cardItem.count()) {
    await cardItem.first().click({ position: { x: 40, y: 20 } })
  }
  await page.waitForTimeout(2000)
  await page.screenshot({ path: process.argv[3] + '/checkout-accordion.png' })
  await page.locator('#cardNumber').fill('4242424242424242')
  await page.locator('#cardExpiry').fill('12 / 30')
  await page.locator('#cardCvc').fill('123')
  const name = page.locator('#billingName')
  if (await name.isVisible().catch(() => false)) await name.fill('B3 QA Owner')

  // Adresse (billing_address_collection=required) : pays + lignes.
  const country = page.locator('#billingCountry')
  if (await country.isVisible().catch(() => false)) {
    await country.selectOption('FR').catch(() => {})
  }
  const addr = page.locator('#billingAddressLine1')
  if (await addr.isVisible().catch(() => false)) {
    await addr.fill('10 rue Oberkampf')
    await page.waitForTimeout(800)
    await page.keyboard.press('Escape') // ferme l'autocomplete
    const manual = page.getByText('Enter address manually').first()
    if (await manual.isVisible().catch(() => false)) await manual.click()
  }
  const city = page.locator('#billingLocality')
  if (await city.isVisible().catch(() => false)) await city.fill('Paris')
  const zip = page.locator('#billingPostalCode')
  if (await zip.isVisible().catch(() => false)) await zip.fill('75011')

  await page.screenshot({ path: process.argv[3] + '/checkout-filled.png' })

  const submit = page.locator('button[type="submit"], .SubmitButton').first()
  await submit.click()
  await page.waitForTimeout(10000)
  await page.screenshot({ path: process.argv[3] + '/checkout-after-click.png' })
  // Un second clic si le bouton est encore là (le premier a pu fermer un
  // autocomplete au lieu de soumettre).
  if (await submit.isVisible().catch(() => false)) {
    await submit.click().catch(() => {})
  }
  await page.waitForURL(/checkout=success/, { timeout: 90000 })
  console.log('SUCCÈS : redirigé vers ' + page.url())
} catch (e) {
  console.error('ÉCHEC : ' + e.message)
  await page.screenshot({ path: process.argv[3] + '/checkout-failed.png' }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
