import { execFileSync } from 'node:child_process'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * X2 — la page d'information RGPD (article 14) et le retrait.
 *
 * Fixtures : le jeu de démonstration durable F2 —
 *   /pro/demo.moussa.diakite  → NON revendiqué (porte le lien d'information)
 *   /pro/demo.kais.bellamine  → revendiqué (ne le porte PAS)
 *
 * Le test de bout en bout du formulaire ÉCRIT une vraie demande dans
 * marketplace_withdrawal_requests (canal public_form) puis la SUPPRIME —
 * la table n'est pas append-only, et laisser une demande en cours ferait
 * sonner l'échéance 72 h de l'écran opérateur sur une fixture de QA.
 *
 * Assertions agnostiques de la langue (data-testid), leçon F1b : le premier
 * rendu peut être FR ou EN selon la détection.
 */

const UNCLAIMED = 'demo.moussa.diakite'
const CLAIMED = 'demo.kais.bellamine'

function sql(query: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', 'fadeup-supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', query],
    { encoding: 'utf8' },
  ).trim()
}

function pendingPublicRequests(handle: string): string {
  return sql(
    `select w.requested_via || '|' || w.status || '|' || coalesce(w.requester_email, '-')
     from public.marketplace_withdrawal_requests w
     join public.professionals p on p.id = w.professional_id
     where p.handle = '${handle}' and w.status = 'pending'`,
  )
}

function cleanupRequests(handle: string): void {
  sql(
    `delete from public.marketplace_withdrawal_requests w
     using public.professionals p
     where p.id = w.professional_id and p.handle = '${handle}'
       and w.requested_via in ('public_form', 'email_link')`,
  )
}

test.describe('X2 — page d\'information RGPD', () => {
  test('accessible sans authentification, structure complète', async ({ page }) => {
    await page.goto('/professionals-data')
    await expect(page.getByTestId('professionals-data-page')).toBeVisible()
    await expect(page).not.toHaveURL(/\/auth\//)
    // Les neuf sections : responsable, finalités, données, sources,
    // destinataires, durée, droits, e-mails, retrait — et le formulaire.
    // Locator SCOPÉ à la page (revue X2 : un <section> de layout casserait
    // un compte global).
    await expect(page.getByTestId('professionals-data-page').locator('section')).toHaveCount(9)
    await expect(page.getByTestId('withdrawal-form')).toBeVisible()
  })

  test('atteignable depuis un profil non revendiqué, fiche préremplie', async ({ page }) => {
    await page.goto(`/pro/${UNCLAIMED}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
    const link = page.getByTestId('unclaimed-data-link')
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(new RegExp(`/professionals-data\\?pro=${UNCLAIMED.replace(/\./g, '\\.')}`))
    // La fiche arrivée par lien est nommée — le demandeur sait de quoi on parle.
    await expect(page.getByTestId('withdrawal-concerning')).toBeVisible()
  })

  test('un profil revendiqué n\'affiche PAS le lien d\'information', async ({ page }) => {
    await page.goto(`/pro/${CLAIMED}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
    // Le profil est bien revendiqué (sinon ce test ne prouve rien)…
    await expect(page.locator('[data-state="claimed"]').first()).toBeVisible()
    // …et le chemin article 14 n'y a pas d'objet.
    await expect(page.getByTestId('unclaimed-data-link')).toHaveCount(0)
  })

  test('le formulaire de retrait fonctionne de bout en bout (et se rejoue sans double demande)', async ({ page }) => {
    cleanupRequests(UNCLAIMED)
    try {
      await page.goto(`/professionals-data?pro=${UNCLAIMED}`)
      await expect(page.getByTestId('withdrawal-concerning')).toBeVisible()
      await page.getByRole('textbox', { name: /e-mail|email/i }).fill('qa-x2-requester@fadeup.test')
      await page.getByTestId('withdrawal-submit').click()
      await expect(page.getByTestId('withdrawal-success')).toBeVisible()

      // La demande est RÉELLE : une ligne pending, canal public_form, dans le
      // circuit que l'opérateur B2 traite sous 72 h.
      expect(pendingPublicRequests(UNCLAIMED)).toBe('public_form|pending|qa-x2-requester@fadeup.test')

      // Re-soumettre ne crée pas une seconde échéance : même demande, dite
      // « déjà en cours ».
      await page.goto(`/professionals-data?pro=${UNCLAIMED}`)
      await page.getByTestId('withdrawal-submit').click()
      await expect(page.getByTestId('withdrawal-success')).toBeVisible()
      expect(pendingPublicRequests(UNCLAIMED).split('\n')).toHaveLength(1)
    } finally {
      cleanupRequests(UNCLAIMED)
    }
  })

  test('le désabonnement demande une confirmation puis aboutit', async ({ page }) => {
    // Jeton inconnu : même parcours qu'un vrai (anti-énumération B2) — et
    // surtout AUCUN désabonnement au simple chargement de la page : les
    // scanners d'e-mails suivent les liens.
    await page.goto('/unsubscribe/qa-x2-token-inconnu')
    await expect(page.getByTestId('unsubscribe-page')).toBeVisible()
    await expect(page.getByTestId('unsubscribe-done')).toHaveCount(0)
    await page.getByTestId('unsubscribe-confirm').click()
    await expect(page.getByTestId('unsubscribe-done')).toBeVisible()
  })

  for (const [name, path] of [
    ['information', '/professionals-data'],
    ['désabonnement', '/unsubscribe/qa-x2-token-inconnu'],
  ] as const) {
    test(`axe — page ${name} sans violation sérieuse ou critique`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const results = await new AxeBuilder({ page }).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    })
  }
})
