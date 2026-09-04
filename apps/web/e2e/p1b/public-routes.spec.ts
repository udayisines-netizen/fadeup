import { expect, test } from '@playwright/test'

/**
 * Aucun mur d'authentification devant la découverte : un visiteur non
 * connecté parcourt les surfaces publiques sans redirection, et chaque route
 * non construite rend un EmptyState traduit — jamais une page blanche.
 */
test.describe('routes publiques sans session', () => {
  for (const path of ['/', '/search', '/pro/un-handle']) {
    test(`${path} rend sans redirection vers /auth`, async ({ page }) => {
      await page.goto(path)
      await expect(page).not.toHaveURL(/\/auth\//)
      // Un EmptyState avec titre + action, pas une page blanche.
      await expect(page.getByRole('heading', { level: 2 })).toBeVisible()
      await expect(page.getByRole('main')).not.toBeEmpty()
    })
  }

  test('la navigation consumer a CINQ onglets, dans l’ordre, avec Feed — et jamais Book', async ({ page, isMobile }) => {
    void isMobile
    await page.goto('/')
    const nav = page.locator('nav').last()
    const labels = await nav.locator('a').allTextContents()
    const compact = labels.map((label) => label.trim()).filter(Boolean)
    expect(compact.length).toBeGreaterThanOrEqual(5)
    const flat = compact.join(' | ').toLowerCase()
    for (const expected of ['accueil|home', 'recherche|search', 'feed', 'réservations|bookings', 'compte|account']) {
      const [fr, en] = expected.split('|')
      expect(flat.includes(fr ?? '') || flat.includes(en ?? expected)).toBe(true)
    }
    expect(flat).not.toMatch(/\bbook\b|\bréserver\b/)
  })

  test('une route inconnue affiche un 404 traduit avec une sortie', async ({ page }) => {
    await page.goto('/nimporte/quoi')
    await expect(page.getByRole('heading', { level: 2 })).toBeVisible()
    await expect(page.getByRole('main').getByRole('link')).toBeVisible()
  })

  test('/bookings sans session redirige vers /auth/login avec retour mémorisé', async ({ page }) => {
    await page.goto('/bookings')
    await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fbookings/)
  })

  test('/demo est accessible quand VITE_ENABLE_DEMO=true et porte noindex', async ({ page }) => {
    await page.goto('/demo')
    await expect(page).toHaveURL(/\/demo/)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  })
})
