import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * D1 — la reprise de direction visuelle : carte de résultat, feuille,
 * profil modèle X, accueil tableau de bord, mémoire locale, reduced-motion.
 * Contre la vraie base (jeu de démonstration + imagerie D1).
 */

test.describe('D1 — carte et feuille de résultat', () => {
  test('un tap ouvre la feuille, la liste reste dessous, le défilement est préservé', async ({ page }) => {
    await page.goto('/search')
    await expect(page.getByTestId('result-count')).toBeVisible({ timeout: 20_000 })
    await page.evaluate(() => window.scrollTo(0, 250))
    // La page peut être plus courte que 250 px de défilement (desktop en
    // grille) : la référence est la position RÉELLEMENT atteinte.
    const scrolled = await page.evaluate(() => window.scrollY)
    expect(scrolled).toBeGreaterThan(0)
    await page.getByTestId('result-open').first().click()
    await expect(page.getByTestId('result-sheet')).toBeVisible()
    // La liste vit toujours sous la feuille.
    await expect(page.getByTestId('result-card').first()).toBeAttached()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('result-sheet')).toHaveCount(0)
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
  })

  test('la feuille dit l’essentiel : identité, services aux prix réels, CTA selon l’état réel', async ({ page }) => {
    await page.goto('/search?q=maison')
    await expect(page.getByTestId('result-count')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('result-open').first().click()
    const sheet = page.getByTestId('result-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', { name: /Maison Kaïs/ })).toBeVisible()
    // Des services réels avec des prix réels (jeu démo B1).
    await expect(sheet.locator('li').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('sheet-book-cta')).toBeVisible()
    await expect(page.getByTestId('sheet-full-profile')).toBeVisible()
  })

  test('la mini-bannière de démonstration s’affiche, et le repli sans image est composé (side-agency)', async ({ page }) => {
    await page.goto('/search')
    await expect(page.getByTestId('result-count')).toBeVisible({ timeout: 20_000 })
    // demo-maison-kais porte une image de démonstration marquée.
    const withImage = page.locator('[data-org="demo-maison-kais"] img[src^="/demo-media/banners/"]')
    await expect(withImage).toHaveCount(1)
    const loaded = await withImage.evaluate((el) => (el as HTMLImageElement).naturalWidth)
    expect(loaded).toBeGreaterThan(0)
    // side-agency n'a AUCUNE image : le repli est une composition, pas un
    // cadre photo — aucune fausse image.
    await expect(page.locator('[data-org="side-agency"] img[src^="/demo-media/"]')).toHaveCount(0)
    await expect(page.locator('[data-org="side-agency"]')).toBeVisible()
  })
})

test.describe('D1 — profil modèle X', () => {
  test('le profil barber suit le modèle X : bannière, portrait, handle, métriques en ligne, CTA avant contenu', async ({ page }) => {
    await page.goto('/pro/demo.kais.bellamine')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Kaïs', { timeout: 20_000 })
    // Le portrait de démonstration est réel (avatar_url en base).
    const avatar = page.locator('img[src^="/demo-media/avatars/"]').first()
    await expect(avatar).toBeVisible()
    // Le CTA inline précède les services dans le document.
    const order = await page.evaluate(() => {
      const cta = document.querySelector('[data-testid="inline-cta"]')
      const services = document.querySelector('section[aria-label]:not([data-testid="social-proof"])')
      if (!cta || !services) return 'missing'
      return cta.compareDocumentPosition(services) & Node.DOCUMENT_POSITION_FOLLOWING ? 'cta-first' : 'services-first'
    })
    expect(order).toBe('cta-first')
    // JAMAIS deux paires de CTA rendues en même temps.
    await expect(page.getByTestId('profile-book-cta')).toHaveCount(1)
  })

  test('le portfolio D1 rend des médias signés réels (chaîne B4)', async ({ page }) => {
    await page.goto('/pro/demo.kais.bellamine')
    const grid = page.getByTestId('post-grid')
    await expect(grid).toBeVisible({ timeout: 20_000 })
    const firstImage = grid.locator('img').first()
    await expect(firstImage).toBeVisible({ timeout: 20_000 })
    expect(await firstImage.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  })
})

test.describe('D1 — accueil tableau de bord', () => {
  test('dès la deuxième visite sans compte : « vous avez consulté », donnée locale réelle', async ({ page }) => {
    // Visite d'un profil : la mémoire locale s'écrit sur l'appareil.
    await page.goto('/shop/demo-atelier-fadel')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Atelier Fadel', { timeout: 20_000 })
    await page.goto('/')
    const recent = page.getByTestId('home-recent')
    await expect(recent).toBeVisible({ timeout: 20_000 })
    await expect(recent.getByText('Atelier Fadel')).toBeVisible()
    // Aucune écriture serveur : la donnée vit dans localStorage.
    const stored = await page.evaluate(() => window.localStorage.getItem('fu.recentProfiles.v1') ?? '')
    expect(stored).toContain('demo-atelier-fadel')
  })

  test('l’invitation à créer un compte est fermable et ne revient pas', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('fu.homeVisits.v1', '5')
    })
    await page.goto('/')
    await expect(page.getByTestId('home-invite')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('home-invite-dismiss').click()
    await expect(page.getByTestId('home-invite')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('home-discover')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('home-invite')).toHaveCount(0)
  })

  test('première visite absolue : recherche + découverte, aucune section vide', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('home-search')).toBeVisible()
    await expect(page.getByTestId('home-discover')).toBeVisible({ timeout: 20_000 })
    for (const missing of ['home-current', 'home-recent', 'home-followed', 'home-invite', 'home-rebook']) {
      await expect(page.getByTestId(missing)).toHaveCount(0)
    }
  })
})

test.describe('D1 — motion et accessibilité', () => {
  // `test.use({ reducedMotion })` n'atteint pas le contexte sur cette
  // version : l'émulation est posée explicitement AVANT la navigation.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('reduced-motion : la feuille s’ouvre sans translation ni échelle', async ({ page }) => {
    await page.goto('/search')
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
    await expect(page.getByTestId('result-count')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('result-open').first().click()
    await expect(page.getByTestId('result-sheet')).toBeVisible()
    const isMobile = await page.evaluate(() => window.matchMedia('(max-width: 767px)').matches)
    if (isMobile) {
      const transform = await page.getByTestId('sheet-panel').evaluate((el) => getComputedStyle(el).transform)
      expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(transform)
    }
  })

  test('axe : la feuille de résultat sans violation sérieuse ou critique', async ({ page }) => {
    await page.goto('/search')
    await expect(page.getByTestId('result-count')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('result-open').first().click()
    await expect(page.getByTestId('result-sheet')).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })
})
