import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * F1 — la face publique de la file sur les organisations de démonstration
 * P1c : lectures seules, aucune écriture, aucune permission accordée.
 */

test.use({ locale: 'fr-FR' })

test.describe('/q/:slug public', () => {
  test('se consulte sans authentification, sans géolocalisation, sans jeton', async ({ page }) => {
    await page.goto('/q/demo-maison-kais')
    await expect(page.getByRole('heading', { name: /Maison Kaïs/ })).toBeVisible()
    // La réponse à LA question : combien de personnes.
    await expect(page.getByTestId('queue-waiting-count')).toBeVisible()
    // Jamais de temps d'attente inventé.
    await expect(page.getByTestId('queue-estimated-wait')).toHaveCount(0)
    // Jamais l'identité des autres : uniquement des comptes, pas de liste nominative.
    await expect(page.getByRole('main')).not.toContainText(/·\s[A-Z]\./)
    // Le chemin vers le profil du salon existe.
    await expect(page.getByRole('link', { name: /profil/i })).toBeVisible()
  })

  test('une zone de service n’a pas de file — état honnête avec une sortie', async ({ page }) => {
    await page.goto('/q/demo-sofian-cuts')
    await expect(page.getByText(/Pas de file d’attente ici|Pas de file d'attente ici/)).toBeVisible()
    await expect(page.getByTestId('queue-join-cta')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /réserver/i })).toBeVisible()
  })

  test('un slug inconnu rend un état introuvable, pas une page blanche', async ({ page }) => {
    await page.goto('/q/nexiste-pas-du-tout')
    await expect(page.getByText(/introuvable/i)).toBeVisible()
  })

  test('axe : aucune violation sérieuse ou critique sur la file publique', async ({ page }) => {
    await page.goto('/q/demo-maison-kais')
    await expect(page.getByTestId('queue-waiting-count')).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter((violation) =>
      violation.impact === 'serious' || violation.impact === 'critical',
    )
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
  })
})
