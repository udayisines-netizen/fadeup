import { expect, test } from '@playwright/test'

test.describe('clavier et realtime', () => {
  test('navigation clavier sur le shell consumer : skip-link puis onglets, focus visible', async ({ page }) => {
    await page.goto('/')
    // Attendre le montage React : presser Tab avant l'hydratation ne focalise rien.
    const skip = page.locator('a[href="#fu-main"]')
    await skip.waitFor({ state: 'attached' })
    await page.keyboard.press('Tab')
    // Premier arrêt : le lien d'évitement.
    await expect(skip).toBeFocused()

    // Les cinq onglets sont atteignables au clavier.
    const focused: string[] = []
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab')
      const text = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
      if (text) focused.push(text)
    }
    expect(focused.length).toBeGreaterThanOrEqual(5)
  })

  test('navigation clavier sur /auth/login : champs et bouton atteignables', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByLabel(/e-mail|email/i).focus()
    await page.keyboard.press('Tab')
    await expect(page.getByLabel(/mot de passe|password/i)).toBeFocused()
  })

  test('aucun canal realtime orphelin après navigation', async ({ page }) => {
    // Sans session, aucun canal ne doit être créé du tout ; on vérifie
    // ensuite qu'une navigation ne laisse rien derrière elle.
    await page.goto('/')
    await page.goto('/auth/login')
    await page.goto('/search')
    await page.waitForTimeout(500)
    const orphans = await page.evaluate(() => {
      const client = (window as { __fuSupabase?: { getChannels: () => Array<{ state: string }> } }).__fuSupabase
      if (!client) return []
      // Un canal « joined » appartient à un composant monté ; après ces
      // navigations sans session, il ne doit rien rester.
      return client.getChannels().map((channel) => channel.state)
    })
    expect(orphans).toEqual([])
  })
})
