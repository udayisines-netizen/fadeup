import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * F2 — les deux profils publics, contre la base réelle (fixtures démo B1
 * publiées par f2_demo_profile_fixtures.sql) :
 *
 *   /pro/demo.kais.bellamine   revendiqué, salarié de demo-maison-kais
 *   /pro/demo.moussa.diakite   NON revendiqué (le cas de lancement)
 *   /shop/demo-maison-kais     salon avec adresse, équipe, horaires
 *   /shop/demo-sofian-cuts     zone de service — AUCUNE adresse
 *
 * Les assertions sont agnostiques de la langue (data-testid / data-state /
 * motifs FR|EN) — leçon F1b sur l'aléa de langue du premier rendu.
 */

const KAIS = '/pro/demo.kais.bellamine'
const MOUSSA = '/pro/demo.moussa.diakite'
const SHOP = '/shop/demo-maison-kais'
const MOBILE_SHOP = '/shop/demo-sofian-cuts'

async function waitForProfile(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
}

test.describe('F2 — profil barber public', () => {
  test('s’ouvre sans authentification, hiérarchie en place', async ({ page }) => {
    await page.goto(KAIS)
    await expect(page).not.toHaveURL(/\/auth\//)
    await waitForProfile(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kaïs Bellamine')
    // Handle + badge de revendication.
    await expect(page.getByText('@demo.kais.bellamine')).toBeVisible()
    await expect(page.locator('[data-state="claimed"]')).toBeVisible()
    // Le CTA transactionnel et le CTA social existent tous deux.
    await expect(page.getByTestId('profile-book-cta')).toBeVisible()
    await expect(page.getByTestId('profile-follow-cta')).toBeVisible()
  })

  test('« Travaille chez » est visible et mène au profil salon', async ({ page }) => {
    await page.goto(KAIS)
    await waitForProfile(page)
    const worksAt = page.getByTestId('works-at-link')
    await expect(worksAt).toBeVisible()
    await worksAt.click()
    await expect(page).toHaveURL(/\/shop\/demo-maison-kais/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Maison Kaïs')
  })

  test('Book ACTIF en vert plein (état réel : la réservation accepte), Follow en secondaire', async ({ page }) => {
    await page.goto(KAIS)
    await waitForProfile(page)
    const book = page.getByTestId('profile-book-cta')
    const follow = page.getByTestId('profile-follow-cta')
    // Maison Kaïs détient un plan accordé : booking_accepting est VRAI en
    // base — le CTA doit être actif, pas seulement stylé.
    await expect(book).toBeEnabled({ timeout: 15_000 })
    // Book porte le fond accent (vert plein) et l'encre par token.
    await expect(book).toHaveClass(/bg-\[var\(--fu-accent\)\]/)
    await expect(book).toHaveClass(/text-\[color:var\(--fu-accent-fg\)\]/)
    // Follow n'est JAMAIS vert plein : contour, fond de surface.
    await expect(follow).not.toHaveClass(/bg-\[var\(--fu-accent\)\]/)
    await expect(follow).toHaveClass(/border/)
    // Le signal opérationnel réel dit « réservable ».
    await expect(page.locator('[data-testid="operational-signals"] [data-state="bookable"]')).toBeVisible()
    // Et le tap mène au tunnel RÉEL (F4 — plus un écran NotBuilt) : l'étape
    // service s'ouvre sur les services réels du salon.
    await book.click()
    await expect(page).toHaveURL(/\/book\/demo-maison-kais/)
    await expect(page.getByTestId('service-step')).toBeVisible({ timeout: 15_000 })
  })

  test('organisation GRATUITE : le CTA est ACTIF — la porte de l’acquisition (F4)', async ({ page }) => {
    // Atelier Fadel est en Free : depuis F4, le MODE ouvre la porte du tunnel
    // (une organisation sans capacité reçoit une DEMANDE, le tunnel
    // l'annonce) — la capacité ne décide que confirmed vs pending.
    await page.goto('/pro/demo.fadel')
    await waitForProfile(page)
    const book = page.getByTestId('profile-book-cta')
    await expect(book).toBeEnabled({ timeout: 15_000 })
    await book.click()
    await expect(page).toHaveURL(/\/book\/demo-atelier-fadel/)
    await page.goBack()
    await waitForProfile(page)
    // Le profil reste entier : Suivre actif, portfolio et services rendus.
    await expect(page.getByTestId('profile-follow-cta')).toBeEnabled()
    await expect(page.getByTestId('portfolio-empty').or(page.getByTestId('post-grid'))).toBeVisible()
    await expect(page.getByTestId('operational-signals')).toBeVisible()
    // Indépendant : sa page EST sa vitrine — pas de « Travaille chez ».
    await expect(page.getByTestId('works-at-link')).toHaveCount(0)
    await expect(page.getByTestId('profile-location')).toBeVisible()
  })

  test('les cinq métriques sont présentes et distinctes', async ({ page }) => {
    await page.goto(KAIS)
    await waitForProfile(page)
    const kinds = await page.locator('[data-testid="social-proof"] [data-kind]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-kind')),
    )
    expect(kinds).toEqual(['followers', 'verified-clients', 'rating', 'reviews', 'likes'])
    // Cinq icônes différentes — jamais la même pour deux métriques.
    const icons = await page.locator('[data-testid="social-proof"] [data-kind] svg').evaluateAll((els) =>
      els.map((el) => el.innerHTML),
    )
    expect(new Set(icons).size).toBe(icons.length)
  })

  test('sans avis : « Pas encore d’avis », JAMAIS zéro étoile', async ({ page }) => {
    await page.goto(KAIS)
    await waitForProfile(page)
    await expect(page.getByTestId('reviews-empty')).toBeVisible()
    const reviewsEmpty = await page.getByTestId('reviews-empty').textContent()
    expect(reviewsEmpty).toMatch(/pas encore d.avis|no reviews yet/i)
    // La métrique Note affiche « — », pas 0,0.
    const rating = await page.locator('[data-kind="rating"]').textContent()
    expect(rating).not.toMatch(/0[.,]0/)
    expect(rating).toContain('—')
  })

  test('non revendiqué : badge NEUTRE, sans rouge ni alerte, chemin de revendication présent', async ({ page }) => {
    await page.goto(MOUSSA)
    await waitForProfile(page)
    const badge = page.locator('[data-state="unclaimed"]')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText(/pas encore géré|not yet managed/i)
    // Aucun rouge : la couleur calculée du badge n'est pas dans le registre rouge.
    const color = await badge.evaluate((el) => getComputedStyle(el).color)
    const [r, g, b] = (color.match(/\d+/g) ?? []).map(Number)
    expect(r).toBeLessThan(150) // jamais un rouge dominant
    expect(r).toBeLessThanOrEqual((g ?? 0) + (b ?? 0))
    // Aucune icône d'alerte dans l'en-tête du profil.
    await expect(badge.locator('svg')).toHaveCount(0)
    // L'explication est transparente et le chemin « c'est moi » existe.
    await expect(page.getByTestId('unclaimed-explainer')).toBeVisible()
    await expect(page.getByTestId('claim-prompt')).toBeVisible()
    // Aucune capacité fabriquée : depuis F4, le geste RÉEL est la demande
    // d'intérêt (B2) — le CTA le dit, la note explique la réservation.
    await expect(page.getByTestId('profile-book-cta')).toBeEnabled()
    await expect(page.getByTestId('profile-book-cta')).toHaveText(/demander un créneau|ask for a slot/i)
    await expect(page.getByTestId('cta-note')).toHaveText(/rejoint fadeup|joins fadeup/i)
    // Suivre reste possible (moteur d'acquisition).
    await expect(page.getByTestId('profile-follow-cta')).toBeEnabled()
  })

  test('non revendiqué : AUCUNE métrique fabriquée sur un profil vide', async ({ page }) => {
    await page.goto(MOUSSA)
    await waitForProfile(page)
    // Verified clients, rating et likes n'ont pas de donnée : « — ».
    for (const kind of ['verified-clients', 'rating', 'likes']) {
      const text = await page.locator(`[data-kind="${kind}"]`).textContent()
      expect(text, kind).toContain('—')
    }
    // Et aucun salon n'est affiché : le lien d'emploi n'est public qu'après
    // revendication (décision B1, miroir de get_public_barber).
    await expect(page.getByTestId('works-at-link')).toHaveCount(0)
  })

  test('le chemin de revendication s’ouvre — sans session il mène à la connexion', async ({ page }) => {
    await page.goto(MOUSSA)
    await waitForProfile(page)
    await page.getByTestId('claim-prompt').getByRole('button').click()
    // La feuille propose la connexion (pas de session dans ce navigateur).
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('link')).toHaveAttribute('href', /\/auth\/login\?redirect=/)
  })

  test('professionnel mobile non revendiqué : AUCUN lieu, AUCUNE adresse inventée', async ({ page }) => {
    // HONNÊTETÉ DU TEST : demo.sofian.cuts est NON revendiqué — son absence
    // d'adresse vient de l'absence de lieu public (frontière B1), pas de la
    // branche zone-de-service du composant. Cette branche-là est couverte
    // côté salon (« zone de service : AUCUNE adresse ») ; le cas /pro d'un
    // REVENDIQUÉ en zone de service n'existe pas dans le jeu démo — écart
    // déclaré au rapport, pas maquillé ici.
    await page.goto('/pro/demo.sofian.cuts')
    await waitForProfile(page)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Sofian')
    await expect(page.getByTestId('profile-location')).toHaveCount(0)
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/rue |avenue |boulevard /i)
  })
})

test.describe('F2 — profil salon public', () => {
  test('s’ouvre sans authentification, hiérarchie en place', async ({ page }) => {
    await page.goto(SHOP)
    await expect(page).not.toHaveURL(/\/auth\//)
    await waitForProfile(page)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Maison Kaïs')
    await expect(page.getByTestId('shop-location')).toContainText('Paris')
    await expect(page.getByTestId('profile-book-cta')).toBeVisible()
    await expect(page.getByTestId('team-list')).toBeVisible()
    await expect(page.getByTestId('hours-section')).toBeVisible()
  })

  test('l’équipe mène au profil barber — le chemin inverse du rattachement', async ({ page }) => {
    await page.goto(SHOP)
    await waitForProfile(page)
    const member = page.getByTestId('team-list').getByRole('link').first()
    await expect(member).toBeVisible()
    await member.click()
    await expect(page).toHaveURL(/\/pro\/demo\.kais\.bellamine/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kaïs Bellamine')
  })

  test('CTA de réservation par membre SEULEMENT pour les réservables — les deux faces', async ({ page }) => {
    // Face POSITIVE : Maison Kaïs accepte -> le membre réservable a son bouton.
    await page.goto(SHOP)
    await waitForProfile(page)
    await expect(page.getByTestId('team-list')).toBeVisible()
    await expect(page.getByTestId('team-book')).toHaveCount(1, { timeout: 15_000 })
    await page.getByTestId('team-book').click()
    await expect(page).toHaveURL(/\/book\/demo-maison-kais\?.*b=de300601/)
    // Depuis F4, la porte du bouton membre est le MODE — une organisation
    // GRATUITE dont le mode accepte reçoit une DEMANDE : le bouton du membre
    // de Barber Corner (Free) existe et mène au même tunnel, qui annonce
    // l'issue réelle. (L'ancienne face négative « Free -> aucun bouton »
    // était la porte capacité de B1, remplacée par F4.)
    await page.goto('/shop/demo-barber-corner')
    await waitForProfile(page)
    await expect(page.getByTestId('team-list')).toBeVisible()
    await expect(page.getByTestId('team-book')).toHaveCount(1, { timeout: 15_000 })
    await page.getByTestId('team-book').click()
    await expect(page).toHaveURL(/\/book\/demo-barber-corner\?.*b=/)
  })

  test('mode file actif : les files F1b et le pont évident vers /q', async ({ page }) => {
    await page.goto(SHOP)
    await waitForProfile(page)
    // La file de Maison Kaïs accepte (fait vérifiable en base) : la section
    // rend le QueueList de F1b et le lien vers la file en direct.
    await expect(page.getByTestId('queue-list')).toBeVisible({ timeout: 15_000 })
    const link = page.getByTestId('shop-queue-link')
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(/\/q\/demo-maison-kais/)
  })

  test('horaires : semaine + état ouvert/fermé, dans le fuseau du lieu', async ({ page }) => {
    await page.goto(SHOP)
    await waitForProfile(page)
    const hours = page.getByTestId('hours-section')
    await expect(hours.getByTestId('open-now')).toBeVisible()
    // Les sept jours sont rendus.
    expect(await hours.locator('dt').count()).toBe(7)
  })

  test('zone de service : AUCUNE adresse, la zone se dit', async ({ page }) => {
    await page.goto(MOBILE_SHOP)
    await waitForProfile(page)
    const location = page.getByTestId('shop-location')
    await expect(location).toHaveText(/se déplace|comes to you/i)
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/rue |avenue |boulevard /i)
  })

  test('salon sans avis : jamais zéro étoile, cinq métriques distinctes', async ({ page }) => {
    await page.goto(MOBILE_SHOP)
    await waitForProfile(page)
    await expect(page.getByTestId('reviews-empty')).toBeVisible()
    const kinds = await page.locator('[data-testid="social-proof"] [data-kind]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-kind')),
    )
    expect(kinds).toEqual(['followers', 'verified-clients', 'rating', 'reviews', 'likes'])
  })
})

test.describe('F2 — accessibilité', () => {
  for (const [name, path] of [
    ['profil barber', KAIS],
    ['profil barber non revendiqué', MOUSSA],
    ['profil salon', SHOP],
    ['profil salon zone de service', MOBILE_SHOP],
  ] as const) {
    test(`axe sans violation sérieuse ou critique — ${name}`, async ({ page }) => {
      await page.goto(path)
      await waitForProfile(page)
      const results = await new AxeBuilder({ page }).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(
        serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      ).toEqual([])
    })
  }
})
