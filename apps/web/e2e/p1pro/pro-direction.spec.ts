import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  ORG_ID,
  QA_BARBER_EMAIL,
  QA_CUSTOMER_EMAIL,
  QA_CUSTOMER_PASSWORD,
  QA_OWNER_EMAIL,
  QA_PASSWORD,
  book,
  ensureFixture,
  ensureQaCustomer,
  expireTrial,
  neutralize,
  passwordToken,
  restoreTrial,
  rpc,
  saveTrialState,
  signIn,
  sql,
  tomorrowAtUtc,
  type Fixture,
  type TrialState,
} from './helpers'

/**
 * P1PRO — la campagne de la direction pro : accueil TODAY/NOW/NEXT/QUEUE,
 * écran des demandes (accepter / contre-proposer / refuser, realtime,
 * historique), réponse client à la contre-proposition, libellés
 * « Sur demande » / « Réservable », rôles, axe, reduced-motion.
 *
 * Organisation partagée qa-f1b-shared (QA_DATA règle 3) ; données marquées
 * qa-p1pro-* AVANT création ; essai sauvegardé/restauré ; neutralisation en
 * fin de campagne. UNE campagne à la fois (règle 2b).
 */

test.describe.configure({ mode: 'serial' })

let fixture: Fixture
let trialBefore: TrialState

test.beforeAll(() => {
  fixture = ensureFixture()
  trialBefore = saveTrialState()
  ensureQaCustomer()
  neutralize()
  sql(`update public.location_service_settings set queue_open=true where location_id='${fixture.locationId}'`)
})

test.afterAll(() => {
  restoreTrial(trialBefore)
  neutralize()
})

async function ownerPage(page: Page): Promise<void> {
  await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
}

/* ------------------------------------------------------------------ */
/* Phase 1 — SANS capacité booking (essai expiré) : le monde Free.     */
/* ------------------------------------------------------------------ */

test.describe('demandes — le monde Free (essai expiré)', () => {
  test.beforeAll(() => {
    expireTrial()
    // Idempotence inter-projets (la suite tourne à 390 puis 1440) : les
    // lignes qa-p1pro du run précédent sont closes, leurs créneaux libérés.
    neutralize()
  })

  test('une demande arrive en temps réel, triée, avec son échéance qui défile', async ({ page }) => {
    await ownerPage(page)
    await page.goto('/dashboard/requests')
    await expect(page.getByTestId('pro-requests')).toBeVisible()
    const before = await page.getByTestId('request-card').count()

    // La demande naît par le tunnel RÉEL, pendant que l'écran est ouvert.
    const booked = await book(fixture, tomorrowAtUtc(9, 0), 'Karim B.', 'qa-p1pro-rt@fadeup.test')
    expect(booked.status).toBe('pending')

    // Realtime : elle apparaît SANS rechargement.
    await expect(page.getByTestId('request-card')).toHaveCount(before + 1, { timeout: 15_000 })
    const card = page.getByTestId('request-card').first()
    await expect(card.getByTestId('request-countdown')).toBeVisible()
    await expect(card.getByTestId('request-customer')).toContainText('Karim B.')

    // Tri par urgence : une demande pour DANS DEUX HEURES expire à l'heure
    // demandée (least(TTL, starts_at)) — elle passe en tête, devant celle
    // de demain qui expire au TTL.
    await book(fixture, new Date(Date.now() + 2 * 3600 * 1000).toISOString(), 'Nassim T.', 'qa-p1pro-rt2@fadeup.test')
    await expect(page.getByTestId('request-card')).toHaveCount(before + 2, { timeout: 15_000 })
    await expect(page.getByTestId('request-card').first().getByTestId('request-customer')).toContainText('Nassim T.', {
      timeout: 10_000,
    })

    // Coordonnées : exactement ce que la RPC expose — ici, aucun téléphone
    // n'a été fourni, aucun ne s'affiche.
    await expect(card.locator('text=/\\+?[0-9]{6,}/')).toHaveCount(0)
  })

  test('accepter est un geste direct ; un salon Free accepte SANS mur, l’incitation vient APRÈS', async ({ page }) => {
    await ownerPage(page)
    await page.goto('/dashboard/requests')
    // Attendre les DONNÉES, pas le squelette, avant de compter.
    await page.getByTestId('request-card').first().waitFor({ timeout: 15_000 })
    const cards = page.getByTestId('request-card')
    const before = await cards.count()
    expect(before).toBeGreaterThan(0)

    await expect(page.getByTestId('free-upsell')).toHaveCount(0)
    await cards.first().getByTestId('request-accept').click()

    // La demande acceptée sort ; AUCUN mur n'est apparu avant le geste.
    await expect(cards).toHaveCount(before - 1, { timeout: 10_000 })
    // L'incitation apparaît APRÈS, fermable, non bloquante.
    await expect(page.getByTestId('free-upsell')).toBeVisible()
    if (before > 1) {
      await expect(cards.first().getByTestId('request-accept')).toBeEnabled()
    }
    await page.getByTestId('upsell-dismiss').click()
    await expect(page.getByTestId('free-upsell')).toHaveCount(0)

    // L'historique dit l'issue.
    await expect(page.getByTestId('requests-history')).toContainText(/Acceptée|Accepted/)
  })

  test('refuser demande confirmation — un client attend derrière', async ({ page }) => {
    await ownerPage(page)
    await page.goto('/dashboard/requests')
    await page.getByTestId('request-card').first().waitFor({ timeout: 15_000 })
    const cards = page.getByTestId('request-card')
    const before = await cards.count()
    expect(before).toBeGreaterThan(0)

    await cards.first().getByTestId('request-decline').click()
    // Rien ne part sans confirmation.
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByTestId('decline-confirm').click()
    await expect(cards).toHaveCount(before - 1, { timeout: 10_000 })
    await expect(page.getByTestId('requests-history')).toContainText(/Refusée|Declined/)
  })

  test('contre-proposer : créneaux réels, le créneau proposé est retenu, la demande passe « en attente du client »', async ({
    page,
  }) => {
    const booked = await book(fixture, tomorrowAtUtc(11, 30), 'Yanis M.', 'qa-p1pro-counter@fadeup.test')
    await ownerPage(page)
    await page.goto('/dashboard/requests')
    const card = page.getByTestId('request-card').filter({ hasText: 'Yanis M.' })
    await expect(card).toHaveCount(1)

    await card.getByTestId('request-counter').click()
    const sheet = page.getByTestId('counter-propose-sheet')
    await expect(sheet).toBeVisible()
    // Les créneaux du jour proposé sont RÉELS (get_available_slots).
    await expect(sheet.getByTestId('counter-slots')).toBeVisible({ timeout: 15_000 })
    await expect(sheet.getByTestId('counter-submit')).toBeDisabled()
    await sheet.getByTestId('counter-slots').locator('button').first().click()
    await sheet.getByTestId('counter-submit').click()

    // La demande sort du « à traiter » et attend le client, avec l'horaire
    // d'origine barré et le proposé en évidence.
    await expect(page.getByTestId('awaiting-card').filter({ hasText: 'Yanis M.' })).toHaveCount(1, { timeout: 10_000 })
    await expect(card).toHaveCount(0)
    const awaiting = page.getByTestId('awaiting-card').filter({ hasText: 'Yanis M.' })
    await expect(awaiting.locator('s')).toBeVisible()

    // En base : la ligne pending a été DÉPLACÉE (créneau retenu) et le salon
    // ne peut plus « accepter » à la place du client.
    const moved = sql(`select counter_proposed_at is not null from public.appointments where id='${booked.id}'`)
    expect(moved).toBe('t')
    const owner = await passwordToken(QA_OWNER_EMAIL, QA_PASSWORD)
    const confirmTry = await rpc('confirm_booking_request', { p_appointment_id: booked.id }, owner)
    expect(confirmTry.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(confirmTry.body)).toContain('counter_pending')
  })

  test('le client VOIT la contre-proposition et l’accepte — la demande devient un rendez-vous', async ({ page }) => {
    // Une demande créée AU NOM du compte client (session réelle par mot de
    // passe) : c'est elle que /bookings doit montrer.
    const customerToken = await passwordToken(QA_CUSTOMER_EMAIL, QA_CUSTOMER_PASSWORD)
    const booked = await book(fixture, tomorrowAtUtc(13, 0), 'Client P1PRO', QA_CUSTOMER_EMAIL, customerToken)
    const owner = await passwordToken(QA_OWNER_EMAIL, QA_PASSWORD)
    const countered = await rpc(
      'counter_propose_booking_request',
      { p_appointment_id: booked.id, p_starts_at: tomorrowAtUtc(15, 30), p_note: 'Pas 13h, mais 15h30 — même fauteuil.' },
      owner,
    )
    expect(countered.status).toBe(200)

    await signIn(page, QA_CUSTOMER_EMAIL, QA_CUSTOMER_PASSWORD)
    await page.goto('/bookings')
    const counterCard = page.getByTestId('counter-proposal-card')
    await expect(counterCard).toHaveCount(1, { timeout: 15_000 })
    await expect(counterCard.getByTestId('counter-proposed-slot')).toBeVisible()
    await expect(counterCard.locator('s')).toBeVisible()
    await expect(counterCard).toContainText('même fauteuil')

    await counterCard.getByTestId('counter-accept').click()
    await expect(counterCard).toHaveCount(0, { timeout: 10_000 })
    await expect(page.getByTestId('bookings-upcoming')).toBeVisible()

    const status = sql(`select status from public.appointments where id='${booked.id}'`)
    expect(status).toBe('confirmed')
  })

  test('le client peut REFUSER la contre-proposition — la demande se clôt, dit avant le geste', async ({ page }) => {
    const customerToken = await passwordToken(QA_CUSTOMER_EMAIL, QA_CUSTOMER_PASSWORD)
    const booked = await book(fixture, tomorrowAtUtc(16, 0), 'Client P1PRO', QA_CUSTOMER_EMAIL, customerToken)
    const owner = await passwordToken(QA_OWNER_EMAIL, QA_PASSWORD)
    await rpc('counter_propose_booking_request', { p_appointment_id: booked.id, p_starts_at: tomorrowAtUtc(17, 30) }, owner)

    await signIn(page, QA_CUSTOMER_EMAIL, QA_CUSTOMER_PASSWORD)
    await page.goto('/bookings')
    const counterCard = page.getByTestId('counter-proposal-card')
    await expect(counterCard).toHaveCount(1, { timeout: 15_000 })
    await counterCard.getByTestId('counter-decline').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByTestId('counter-decline-confirm').click()
    await expect(counterCard).toHaveCount(0, { timeout: 10_000 })

    const row = sql(`select status||'|'||resolution from public.appointments where id='${booked.id}'`)
    expect(row).toBe('cancelled|cancelled_by_customer')
  })

  test('axe — demandes (pro, sombre) : aucune violation sérieuse ou critique', async ({ page }) => {
    await ownerPage(page)
    await page.goto('/dashboard/requests')
    await expect(page.getByTestId('pro-requests')).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Phase 2 — AVEC capacités (essai restauré) : l'accueil composé.      */
/* ------------------------------------------------------------------ */

test.describe('accueil pro — TODAY / NOW / NEXT / QUEUE', () => {
  test.beforeAll(async () => {
    restoreTrial(trialBefore)
    // Idempotence inter-projets : lignes du run précédent closes, créneaux
    // libérés, file vidée puis rouverte.
    neutralize()
    sql(`update public.location_service_settings set queue_open=true where location_id='${fixture.locationId}'`)
    // La journée réelle : une prestation terminée (revenu calculé), une en
    // cours (NOW), une à venir (NEXT), trois clients en file.
    sql(`insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, customer_email, starts_at, ends_at, status)
         values ('${ORG_ID}','${fixture.locationId}','${fixture.barberId}','${fixture.serviceId}','Adam S.','qa-p1pro-done@fadeup.test', now()-interval '2 hours', now()-interval '90 minutes','confirmed')`)
    sql(`update public.appointments set status='completed' where organization_id='${ORG_ID}' and customer_email='qa-p1pro-done@fadeup.test' and status='confirmed'`)
    sql(`insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, customer_email, starts_at, ends_at, status)
         values ('${ORG_ID}','${fixture.locationId}','${fixture.barberId}','${fixture.serviceId}','Ibrahim K.','qa-p1pro-now@fadeup.test', now()-interval '10 minutes', now()+interval '20 minutes','confirmed')`)
    const owner = await passwordToken(QA_OWNER_EMAIL, QA_PASSWORD)
    await book(fixture, new Date(Date.now() + 3 * 3600 * 1000).toISOString(), 'Sofiane L.', 'qa-p1pro-next@fadeup.test', owner)
    sql(`insert into public.queue_entries (organization_id, location_id, customer_name, status) values
         ('${ORG_ID}','${fixture.locationId}','Rayan','waiting'),
         ('${ORG_ID}','${fixture.locationId}','Théo','waiting'),
         ('${ORG_ID}','${fixture.locationId}','Sami','waiting')`)
  })

  test('owner : LE chiffre est le revenu calculé ; demandes en ambre ; file réelle ; « Terminé » en un geste', async ({
    page,
  }) => {
    await ownerPage(page)
    await page.goto('/dashboard')
    await expect(page.getByTestId('pro-home')).toBeVisible()

    // Le chiffre dominant est un MONTANT (owner voit le revenu).
    await expect(page.getByTestId('pro-home-dominant')).toContainText(/€|EUR/)
    // NOW montre la prestation en cours, avec l'action.
    await expect(page.getByTestId('pro-home-now')).toContainText('Ibrahim K.')
    // NEXT et la file réelle.
    await expect(page.getByTestId('pro-home-next')).toContainText('Sofiane L.')
    await expect(page.getByTestId('pro-home-queue')).toContainText('Rayan')
    // TODAY : le fil dense.
    await expect(page.getByTestId('pro-home-today')).toContainText('Adam S.')

    // « Terminé » en un geste : la prestation en cours part au terminé.
    await page.getByTestId('pro-home-complete').click()
    await expect(page.getByTestId('pro-home-now')).not.toContainText('Ibrahim K.', { timeout: 10_000 })
    const status = sql(`select status from public.appointments where organization_id='${ORG_ID}' and customer_email='qa-p1pro-now@fadeup.test' order by created_at desc limit 1`)
    expect(status).toBe('completed')
  })

  test('barber salarié : SA journée domine, ni revenu ni entrée Demandes', async ({ page }) => {
    await signIn(page, QA_BARBER_EMAIL, QA_PASSWORD)
    await page.goto('/dashboard')
    await expect(page.getByTestId('pro-home')).toBeVisible()

    // Le chiffre dominant n'est PAS un montant.
    await expect(page.getByTestId('pro-home-dominant')).not.toContainText(/€|EUR/)
    // Aucun revenu nulle part, aucun bloc demandes, pas d'entrée de nav.
    await expect(page.getByTestId('pro-home-hero')).not.toContainText(/€/)
    await expect(page.getByTestId('pro-home-requests')).toHaveCount(0)
    await expect(page.getByRole('navigation').getByRole('link', { name: /Demandes|Requests/ })).toHaveCount(0)
  })

  test('axe — accueil pro : aucune violation sérieuse ou critique', async ({ page }) => {
    await ownerPage(page)
    await page.goto('/dashboard')
    await expect(page.getByTestId('pro-home')).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious).toEqual([])
  })

  test('reduced-motion : aucune translation sur les surfaces pro', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await ownerPage(page)
    await page.goto('/dashboard/requests')
    await expect(page.getByTestId('pro-requests')).toBeVisible()
    // La neutralisation globale (theme.css) vide les animations fu-* :
    // aucun élément animé ne porte une durée > 0,1 s.
    const animated = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[class*="fu-rise-in"], [class*="fu-update-flash"]'))
      return nodes
        .map((node) => window.getComputedStyle(node).animationDuration)
        .filter((duration) => duration.split(',').some((value) => parseFloat(value) > 0.1))
    })
    expect(animated).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Phase 3 — le libellé : « Sur demande » vs « Réservable ».           */
/* ------------------------------------------------------------------ */

test.describe('libellés de découverte', () => {
  test('la carte d’un salon sans capacité dit « Sur demande » — un seul badge, sans redondance', async ({ page }) => {
    await page.goto('/search?q=atelier')
    const card = page.getByTestId('result-card').filter({ hasText: 'Atelier Fadel' })
    await expect(card).toHaveCount(1, { timeout: 15_000 })
    await expect(card.locator('[data-state="on-request"]')).toBeVisible({ timeout: 15_000 })
    // La mention de revendication est devenue redondante SUR LA CARTE.
    await expect(card.locator('[data-state="unclaimed"]')).toHaveCount(0)
  })

  test('la feuille d’un salon sans capacité propose « Demander un créneau » et l’annonce', async ({ page }) => {
    await page.goto('/search?q=atelier')
    const card = page.getByTestId('result-card').filter({ hasText: 'Atelier Fadel' })
    await card.getByTestId('result-open').click()
    const sheet = page.getByTestId('result-sheet')
    await expect(sheet).toBeVisible()
    await expect(page.getByTestId('sheet-book-cta')).toContainText(/Demander un créneau|Ask for a slot/, {
      timeout: 15_000,
    })
    await expect(page.getByTestId('sheet-cta-note')).toBeVisible()
  })

  test('un salon AVEC capacité reste « Réservable »', async ({ page }) => {
    await page.goto('/search?q=kais')
    const card = page.getByTestId('result-card').filter({ hasText: 'Maison Kaïs' })
    await expect(card).toHaveCount(1, { timeout: 15_000 })
    // Réservable (badge) ou disponible maintenant (qui prime) — jamais « Sur demande ».
    await expect(card.locator('[data-state="on-request"]')).toHaveCount(0)
  })

  test('le profil d’un salon sans capacité dit « Demander un créneau » avec la note', async ({ page }) => {
    await page.goto('/shop/demo-atelier-fadel')
    const cta = page.getByTestId('profile-book-cta').first()
    await expect(cta).toContainText(/Demander un créneau|Ask for a slot/, { timeout: 20_000 })
    await expect(page.getByTestId('cta-note').first()).toBeVisible()
  })
})
