import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  CONFIRMED_ORG,
  PENDING_ORG,
  QA_CUSTOMER_NAME,
  UNCLAIMED_HANDLE,
  anonBook,
  cancelLeftoverQaBookings,
  ensureQaCustomer,
  fetchEmailOtp,
  signIn,
  sql,
} from './helpers'

/**
 * F4 — le tunnel de réservation et « demande envoyée », contre la VRAIE base.
 *
 * Les deux chemins s'exercent sur le jeu de démonstration durable :
 *  - demo-maison-kais (plan accordé B1/F2, capacité booking) → `confirmed` ;
 *  - demo-atelier-fadel (Free) → `pending` avec échéance affichée ;
 * et la demande d'intérêt sur demo.moussa.diakite (non revendiqué, sans
 * prospect rattaché : aucune relance e-mail ne part).
 *
 * AUCUNE organisation n'est créée. Les rendez-vous QA sont marqués AVANT
 * création (qa-f4-…@fadeup.test) et annulés en fin de campagne.
 */

/** Le motif de verify_b2 §4, appliqué au TEXTE RENDU. */
const FORBIDDEN = /(^|[^\p{L}])(réservé|reserve|booked|confirmé|confirmed)(?![\p{L}])/iu

test.describe.configure({ mode: 'serial', timeout: 150_000 })

async function throughSlot(page: Page, slug: string, options: { anyBarber?: boolean } = {}) {
  await page.goto(`/book/${slug}`)
  await page.waitForSelector('[data-testid="service-step"]', { timeout: 20_000 })
  await page.locator('[data-testid="service-step"] button').first().click()
  await page.waitForSelector('[data-testid="barber-step"]', { timeout: 20_000 })
  await page
    .locator('[data-testid="barber-step"] button')
    .nth(options.anyBarber === false ? 1 : 0)
    .click()
  await page.waitForSelector('[data-testid="slot-step"]', { timeout: 20_000 })
  // Le premier jour À VENIR qui a des créneaux réels (certains jours sont
  // fermés — la grille ne fabrique rien, on cherche comme un vrai client).
  let found = false
  for (let dayIndex = 1; dayIndex <= 6 && !found; dayIndex += 1) {
    await page.locator('[data-testid="day-strip"] button').nth(dayIndex).click()
    found = await page
      .locator('[data-testid="slot-grid"] button')
      .first()
      .waitFor({ timeout: 8_000 })
      .then(() => true)
      .catch(() => false)
  }
  expect(found).toBe(true)
}

test.describe('F4 — tunnel de réservation et demande envoyée', () => {
  test.beforeAll(() => {
    ensureQaCustomer()
    cancelLeftoverQaBookings()
  })

  test.afterAll(() => {
    cancelLeftoverQaBookings()
  })

  test('fixture : les deux organisations disent leur capacité par le contrat F4', async () => {
    expect(
      sql(`select accepts_immediate_booking from public.get_public_booking_capability('${CONFIRMED_ORG}')`),
    ).toBe('t')
    expect(sql(`select accepts_immediate_booking from public.get_public_booking_capability('${PENDING_ORG}')`)).toBe(
      'f',
    )
  })

  test('réservation complète avec capacité → confirmée — et aucun écran de paiement nulle part', async ({ page }) => {
    await signIn(page)
    await throughSlot(page, CONFIRMED_ORG, { anyBarber: false })
    await page.locator('[data-testid="slot-grid"] button').first().click()
    await page.waitForSelector('[data-testid="summary-step"]', { timeout: 20_000 })

    // Le récapitulatif ANNONCE la confirmation (capacité présente).
    await expect(page.getByTestId('booking-submit')).toHaveText(/confirmer la réservation|confirm booking/i)
    // Paiement sur place uniquement : jamais carte, jamais CB, jamais payer en ligne.
    await expect(page.locator('body')).not.toContainText(/carte bancaire|credit card|\bCB\b|payer en ligne|pay online/i)

    await page.getByLabel(/votre nom|your name/i).fill(QA_CUSTOMER_NAME)
    await page.getByTestId('booking-submit').click()

    // AUCUN optimisme : l'écran confirmé n'existe qu'avec la réponse base.
    await page.waitForSelector('[data-testid="booking-confirmed"]', { timeout: 20_000 })
    await expect(page.getByTestId('booking-confirmed')).toContainText(/confirmé|confirmed/i)

    // Côté base : la ligne est bien `confirmed`, possédée par le compte QA.
    const status = sql(`
      select a.status from public.appointments a
      where a.customer_email = 'qa-f4-customer@fadeup.test'
      order by a.created_at desc limit 1
    `)
    expect(status).toBe('confirmed')

    // /bookings la montre en « À venir ».
    await page.goto('/bookings')
    await page.waitForSelector('[data-testid="bookings-upcoming"]', { timeout: 20_000 })
  })

  test('réservation sans capacité → demande envoyée, échéance RÉELLE affichée, jamais « Réservé »', async ({
    page,
  }) => {
    await signIn(page)
    await throughSlot(page, PENDING_ORG)
    await page.locator('[data-testid="slot-grid"] button').first().click()
    await page.waitForSelector('[data-testid="summary-step"]', { timeout: 20_000 })

    // Le client SAIT qu'il envoie une demande, AVANT le geste (F4 §3).
    await expect(page.getByTestId('booking-submit')).toHaveText(/envoyer la demande|send the request/i)
    await expect(page.getByTestId('request-notice')).toBeVisible()

    await page.getByLabel(/votre nom|your name/i).fill(QA_CUSTOMER_NAME)
    await page.getByTestId('booking-submit').click()
    await page.waitForSelector('[data-testid="booking-request-sent"]', { timeout: 20_000 })

    // L'échéance est réelle (base : least(24 h, heure demandée)) et affichée.
    await expect(page.getByTestId('request-countdown')).toBeVisible()
    const rendered = (await page.getByTestId('booking-request-sent').textContent()) ?? ''
    expect(rendered.length).toBeGreaterThan(50)
    // LA loi : le texte rendu ne dit jamais « Réservé » sur un is_request.
    expect(FORBIDDEN.exec(rendered)?.[2] ?? null).toBeNull()

    // Base : `pending`, échéance ≤ heure demandée.
    const row = sql(`
      select a.status || '|' || (a.expires_at <= a.starts_at)::text
      from public.appointments a
      where a.customer_email = 'qa-f4-customer@fadeup.test' and a.organization_id =
        (select id from public.organizations where slug = '${PENDING_ORG}')
      order by a.created_at desc limit 1
    `)
    expect(row).toBe('pending|true')

    // /bookings : la demande vit dans sa section, échéance qui défile.
    await page.goto('/bookings')
    await page.waitForSelector('[data-testid="bookings-requests"]', { timeout: 20_000 })
    await expect(page.getByTestId('request-row-countdown').first()).toBeVisible()
    const requests = (await page.getByTestId('bookings-requests').textContent()) ?? ''
    expect(FORBIDDEN.exec(requests)?.[2] ?? null).toBeNull()
  })

  test('conflit de créneau : arbitré serveur, message clair, AUCUN état optimiste', async ({ page }) => {
    await signIn(page)
    await throughSlot(page, PENDING_ORG)
    const firstSlot = page.locator('[data-testid="slot-grid"] button').first()
    const slotLabel = await firstSlot.getAttribute('aria-label')
    await firstSlot.click()
    await page.waitForSelector('[data-testid="summary-step"]', { timeout: 20_000 })

    // Pendant que le client relit, QUELQU'UN D'AUTRE prend le créneau (API réelle).
    const taken = sql(`
      select l.id || '|' || b.id || '|' || s.id || '|' || l.timezone
      from public.organizations o
      join public.locations l on l.organization_id = o.id and l.is_active
      join public.barbers b on b.organization_id = o.id and b.is_bookable
      join public.services s on s.organization_id = o.id and s.is_active
      where o.slug = '${PENDING_ORG}' limit 1
    `).split('|')
    const url = new URL(page.url())
    const startsAt = url.searchParams.get('t')
    expect(startsAt).toBeTruthy()
    const race = await anonBook({
      p_organization_slug: PENDING_ORG,
      p_location_id: taken[0],
      p_barber_id: taken[1],
      p_service_id: taken[2],
      p_starts_at: startsAt,
      p_customer_name: 'ZZ dead QA F4 course',
      p_customer_email: 'qa-f4-race@fadeup.test',
    })
    expect(race.status).toBe(200)

    await page.getByLabel(/votre nom|your name/i).fill(QA_CUSTOMER_NAME)
    await page.getByTestId('booking-submit').click()

    // Le refus est nommé, lu sur le code — et RIEN ne s'affiche comme envoyé.
    await expect(page.getByRole('alert')).toContainText(/vient d'être pris|just taken/i, { timeout: 20_000 })
    await expect(page.locator('[data-testid="booking-request-sent"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="booking-confirmed"]')).toHaveCount(0)
    // Retour à l'étape créneau : le créneau pris n'est PLUS proposé.
    await page.waitForSelector('[data-testid="slot-step"]', { timeout: 20_000 })
    if (slotLabel) {
      await expect(page.locator(`[data-testid="slot-grid"] button[aria-label="${slotLabel}"]`)).toHaveCount(0)
    }
  })

  test('un créneau indisponible n’est jamais sélectionnable : la grille ne montre que la vérité serveur', async ({
    page,
  }) => {
    // Le créneau pris par la course ci-dessus a disparu de la grille — déjà
    // prouvé. Ici : la grille n'affiche JAMAIS plus que ce que la base offre
    // pour le jour choisi (aucun créneau inventé).
    await throughSlot(page, PENDING_ORG)
    const day = new URL(page.url()).searchParams.get('d')
    expect(day).toBeTruthy()
    const shown = await page.locator('[data-testid="slot-grid"] button').count()
    const t = sql(`
      select count(*) from public.organizations o
      join public.locations l on l.organization_id = o.id and l.is_active,
      lateral public.get_public_available_slots(o.slug, l.id,
        (select b.id from public.barbers b where b.organization_id = o.id and b.is_bookable limit 1),
        (select s.id from public.services s where s.organization_id = o.id and s.is_active limit 1),
        date '${day}', 15)
      where o.slug = '${PENDING_ORG}'
    `)
    // La grille (un moment de la journée) est un sous-ensemble du jour entier.
    expect(shown).toBeLessThanOrEqual(Number(t))
    expect(shown).toBeGreaterThan(0)
  })

  test('inscription légère DANS le flux : e-mail → code à 6 chiffres → la demande part, sans quitter le tunnel', async ({
    page,
  }) => {
    const email = `qa-f4-otp-${Date.now()}@fadeup.test`
    await throughSlot(page, PENDING_ORG)
    await page.locator('[data-testid="slot-grid"] button').first().click()
    await page.waitForSelector('[data-testid="summary-step"]', { timeout: 20_000 })

    const tunnelUrl = page.url()
    await page.getByLabel(/votre nom|your name/i).fill('QA F4 OTP')
    await page.getByLabel(/votre e-mail|your email/i).fill(email)
    await page.getByTestId('booking-submit').click()

    // L'étape OTP apparaît SUR PLACE — aucune navigation.
    await expect(page.getByText(/code à 6 chiffres|6-digit code/i)).toBeVisible({ timeout: 20_000 })
    expect(page.url()).toBe(tunnelUrl)

    // Le code RÉEL du dernier envoi GoTrue (API admin — pas de boîte mail ici).
    const otp = await fetchEmailOtp(email)
    await page.getByLabel(/1\/6/).focus()
    await page.keyboard.type(otp)

    await page.waitForSelector('[data-testid="booking-request-sent"]', { timeout: 25_000 })
    // Le compte existe, la demande lui appartient.
    const owned = sql(`
      select count(*) from public.appointments a
      join auth.users u on u.id = a.booked_by_user_id
      where u.email = '${email}' and a.status = 'pending'
    `)
    expect(owned).toBe('1')
    // Nettoyage : la demande puis le compte jetable (aucune organisation).
    sql(`update public.appointments set status='cancelled', resolution='cancelled_by_customer', decided_at=now()
         where booked_by_user_id = (select id from auth.users where email='${email}') and status='pending'`)
    sql(`delete from auth.users where email = '${email}'`)
  })

  test('demande d’intérêt sur un profil non revendiqué : honnête, sans promesse de rendez-vous', async ({ page }) => {
    await signIn(page)
    await page.goto(`/pro/${UNCLAIMED_HANDLE}`)
    const cta = page.getByTestId('profile-book-cta')
    await expect(cta).toBeEnabled({ timeout: 20_000 })
    await expect(cta).toHaveText(/demander un créneau|ask for a slot/i)
    await cta.click()

    await page.waitForSelector('[data-testid="interest-request"]', { timeout: 20_000 })
    await expect(page.getByTestId('interest-explainer')).toContainText(/pas encore sur fadeup|not on fadeup yet/i)

    await page.getByLabel(/quel service|which service/i).fill('Coupe + barbe')
    const when = new Date(Date.now() + 48 * 3_600_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    await page
      .getByLabel(/quand cela|when would/i)
      .fill(
        `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`,
      )
    await page.getByLabel(/votre nom|your name/i).fill(QA_CUSTOMER_NAME)
    await page.getByTestId('interest-submit').click()

    await page.waitForSelector('[data-testid="interest-sent"]', { timeout: 20_000 })
    const rendered = (await page.getByTestId('interest-sent').textContent()) ?? ''
    // Préférence, pas créneau retenu — et jamais un mot de réservation acquise.
    expect(rendered).toMatch(/préférence|preference/i)
    expect(FORBIDDEN.exec(rendered)?.[2] ?? null).toBeNull()

    // /bookings : la demande d'intérêt vit dans sa section.
    await page.goto('/bookings')
    await page.waitForSelector('[data-testid="bookings-interest"]', { timeout: 20_000 })

    // Nettoyage : la demande d'intérêt QA est retirée (pas de RPC client — B2
    // n'en expose pas ; le statut withdrawn est l'état prévu par l'enum).
    sql(`update public.professional_interest_requests set status='withdrawn'
         where customer_display_name like 'QA F4%' and status='pending'`)
  })

  test('report en libre-service : mêmes créneaux réels, le rendez-vous reste confirmé', async ({ page }) => {
    await signIn(page)
    await page.goto('/bookings')
    await page.waitForSelector('[data-testid="bookings-upcoming"]', { timeout: 20_000 })
    const before = sql(`
      select starts_at from public.appointments
      where customer_email = 'qa-f4-customer@fadeup.test' and status = 'confirmed'
      order by created_at desc limit 1
    `)
    await page.locator('[data-testid="bookings-upcoming"] button').first().click()
    await page.waitForSelector('[data-testid="booking-detail"]', { timeout: 20_000 })
    await page.getByRole('button', { name: /reporter|reschedule/i }).click()
    await page.waitForSelector('[data-testid="reschedule-picker"]', { timeout: 20_000 })
    // Le premier jour à venir qui a des créneaux réels (certains jours sont fermés).
    let found = false
    for (let dayIndex = 2; dayIndex <= 6 && !found; dayIndex += 1) {
      await page.locator('[data-testid="booking-detail"] [data-testid="day-strip"] button').nth(dayIndex).click()
      found = await page
        .locator('[data-testid="booking-detail"] [data-testid="slot-grid"] button')
        .first()
        .waitFor({ timeout: 8_000 })
        .then(() => true)
        .catch(() => false)
    }
    expect(found).toBe(true)
    await page.locator('[data-testid="booking-detail"] [data-testid="slot-grid"] button').first().click()
    await expect(page.getByText(/a été déplacée|has been moved/i)).toBeVisible({ timeout: 20_000 })
    const after = sql(`
      select status || '|' || starts_at from public.appointments
      where customer_email = 'qa-f4-customer@fadeup.test'
        and organization_id = (select id from public.organizations where slug = '${CONFIRMED_ORG}')
        and status in ('pending','confirmed')
      order by created_at desc limit 1
    `)
    // Le statut est PRÉSERVÉ (un confirmé déplacé reste confirmé) et l'heure a changé.
    expect(after.startsWith('confirmed|')).toBe(true)
    expect(after.split('|')[1]).not.toBe(before)
  })

  test('annulation : l’état est correct DES DEUX CÔTÉS, et la demande en attente se retire', async ({ page }) => {
    await signIn(page)
    await page.goto('/bookings')

    // La demande pending (créée plus haut) : détail → retirer.
    await page.waitForSelector('[data-testid="bookings-requests"]', { timeout: 20_000 })
    await page.locator('[data-testid="bookings-requests"] button').first().click()
    await page.waitForSelector('[data-testid="booking-detail"]', { timeout: 20_000 })
    await page.getByRole('button', { name: /retirer la demande|withdraw the request/i }).click()
    await page.getByRole('button', { name: /oui, annuler|yes, cancel/i }).click()
    await expect(page.getByText(/c'est annulé|cancelled\. the shop/i)).toBeVisible({ timeout: 20_000 })

    // Côté base : cancelled + résolution client (le côté salon lit la même ligne).
    const pendingLeft = sql(`
      select count(*) from public.appointments
      where customer_email = 'qa-f4-customer@fadeup.test' and status = 'pending'
    `)
    expect(pendingLeft).toBe('0')

    // Le rendez-vous CONFIRMÉ aussi : annulation depuis « À venir ».
    await page.goto('/bookings')
    await page.waitForSelector('[data-testid="bookings-upcoming"]', { timeout: 20_000 })
    await page.locator('[data-testid="bookings-upcoming"] button').first().click()
    await page.waitForSelector('[data-testid="booking-detail"]', { timeout: 20_000 })
    await page.getByRole('button', { name: /^annuler$|^cancel$/i }).click()
    await page.getByRole('button', { name: /oui, annuler|yes, cancel/i }).click()
    await expect(page.getByText(/c'est annulé|cancelled\. the shop/i)).toBeVisible({ timeout: 20_000 })
    const state = sql(`
      select status || '|' || resolution from public.appointments
      where customer_email = 'qa-f4-customer@fadeup.test'
        and organization_id = (select id from public.organizations where slug = '${CONFIRMED_ORG}')
      order by created_at desc limit 1
    `)
    expect(state).toBe('cancelled|cancelled_by_customer')
  })

  test('« réserver à nouveau » : barber et service préremplis, créneaux réels immédiatement', async ({ page }) => {
    await signIn(page)
    await page.goto('/bookings')
    await page.waitForSelector('[data-testid="bookings-history"]', { timeout: 20_000 })
    await page
      .getByRole('button', { name: /réserver à nouveau|book .* again/i })
      .first()
      .click()

    // Le tunnel s'ouvre DIRECTEMENT sur la date/heure : s et b sont préremplis.
    await page.waitForURL(/\/book\/.+[?&]b=.+/, { timeout: 20_000 })
    expect(new URL(page.url()).searchParams.get('s')).toBeTruthy()
    await page.waitForSelector('[data-testid="slot-step"]', { timeout: 20_000 })
  })

  test('accessibilité : aucune violation axe sérieuse ou critique sur le tunnel et /bookings', async ({ page }) => {
    const check = async (label: string) => {
      const results = await new AxeBuilder({ page }).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious, `${label}: ${serious.map((v) => v.id).join(', ')}`).toEqual([])
    }

    await page.goto(`/book/${PENDING_ORG}`)
    await page.waitForSelector('[data-testid="service-step"]', { timeout: 20_000 })
    await check('étape service')
    await page.locator('[data-testid="service-step"] button').first().click()
    await page.locator('[data-testid="barber-step"] button').first().click()
    await page.locator('[data-testid="day-strip"] button').nth(1).click()
    await page.waitForSelector('[data-testid="slot-grid"] button', { timeout: 20_000 })
    await check('étape créneaux')
    await page.locator('[data-testid="slot-grid"] button').first().click()
    await page.waitForSelector('[data-testid="summary-step"]', { timeout: 20_000 })
    await check('récapitulatif')

    await signIn(page)
    await page.goto('/bookings')
    await page.waitForSelector('[data-testid="my-bookings"]', { timeout: 20_000 })
    await check('/bookings')

    await page.goto(`/request/${UNCLAIMED_HANDLE}`)
    await page.waitForSelector('[data-testid="interest-request"]', { timeout: 20_000 })
    await check('demande d’intérêt')
  })
})
