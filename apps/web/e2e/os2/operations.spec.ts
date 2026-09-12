import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  ensureFixture,
  neutralize,
  ORG_ID,
  QA_BARBER_EMAIL,
  QA_MARK,
  QA_OWNER_EMAIL,
  QA_PASSWORD,
  seedCustomer,
  signIn,
  sql,
  type Fixture,
} from './helpers'

/**
 * OS-2 — les quatre surfaces pro dans un vrai navigateur, à 390 et 1440
 * (les deux projets de `playwright.config.ts`). Données RÉELLES sur
 * l'organisation partagée `qa-f1b-shared`, marquées avant création et
 * neutralisées à la fin (QA_DATA règles 2 à 4).
 *
 * Les noms créés portent le suffixe du projet : les deux largeurs tournent
 * l'une après l'autre (workers: 1) sur la MÊME base, et deux services
 * homonymes rendraient les assertions ambiguës.
 */

test.describe.configure({ mode: 'serial' })

/* La langue de l'interface suit celle du navigateur : sans ce réglage, le
   contexte Playwright est en `en-US` et l'écran pro s'affiche en anglais.
   Les captures du rapport sont en français, la campagne doit l'être aussi. */
test.use({ locale: 'fr-FR' })

/** Les deux langues du produit, pour qu'une assertion ne dépende pas d'un réglage. */
const OBSERVED = /moyenne observée|observed average/i

let fixture: Fixture
let suffix = ''

test.beforeAll(({}, testInfo) => {
  suffix = testInfo.project.name === 'chromium-mobile' ? '390' : '1440'
  fixture = ensureFixture()
})

test.afterAll(() => {
  neutralize()
})

const noSeriousViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
}

/** Les erreurs de console d'une page — aucune n'est tolérée sur une surface pro. */
function watchConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  return errors
}

test('catalogue — le propriétaire crée, archive, et ne peut pas supprimer un service qui a un historique', async ({ page }) => {
  const errors = watchConsole(page)
  await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
  await page.goto('/dashboard/catalog')
  await page.getByTestId('pro-catalog-list').waitFor({ timeout: 30_000 })

  // Création avec un prix : le champ existe pour un propriétaire.
  const name = `QA OS2 Coupe ${suffix}`
  await page.getByTestId('pro-catalog-create').click()
  await page.getByTestId('pro-catalog-field-name').fill(name)
  await page.getByTestId('pro-catalog-field-duration').fill('35')
  await expect(page.getByTestId('pro-catalog-field-price')).toBeVisible()
  await page.getByTestId('pro-catalog-field-price').fill('28')
  await page.getByTestId('pro-catalog-save').click()
  await expect(page.getByTestId('pro-catalog-list').getByText(name, { exact: false })).toBeVisible({ timeout: 20_000 })

  const serviceId = sql(`select id from public.services where organization_id='${ORG_ID}' and name='${name}'`)
  expect(serviceId).not.toBe('')

  // Sans historique, la suppression est offerte.
  await page.getByTestId('pro-catalog-list').getByText(name, { exact: false }).click()
  await expect(page.getByTestId('pro-catalog-delete')).toBeVisible()
  await page.keyboard.press('Escape')

  // Avec un rendez-vous, elle disparaît — et l'archivage la remplace.
  sql(`insert into public.appointments
         (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, status, notes)
       values ('${ORG_ID}','${fixture.locationId}','${fixture.barbers[0]!.id}','${serviceId}','QA OS2 Client',
               now() + interval '5 days', now() + interval '5 days' + interval '35 minutes', 'confirmed', '${QA_MARK}')`)
  await page.reload()
  await page.getByTestId('pro-catalog-list').waitFor()
  await page.getByTestId('pro-catalog-list').getByText(name, { exact: false }).click()
  await expect(page.getByTestId('pro-catalog-delete')).toHaveCount(0)
  await page.getByTestId('pro-catalog-archive').click()
  await page.getByTestId('pro-catalog-confirm').click()

  await expect
    .poll(() => sql(`select archived_at is not null from public.services where id='${serviceId}'`), { timeout: 20_000 })
    .toBe('t')
  // Archivé, il quitte la liste courante mais reste retrouvable en archives.
  await expect(page.getByTestId('pro-catalog-list').getByText(name, { exact: false })).toHaveCount(0)
  await page.getByTestId('pro-catalog-show-archived').click()
  await expect(page.getByTestId('pro-catalog-list').getByText(name, { exact: false })).toBeVisible()

  await noSeriousViolations(page)
  expect(errors).toEqual([])
})

test('catalogue — un barber modifie une durée mais ne voit AUCUN champ de prix', async ({ page }) => {
  await signIn(page, QA_BARBER_EMAIL, QA_PASSWORD)
  await page.goto('/dashboard/catalog')
  await page.getByTestId('pro-catalog-list').waitFor({ timeout: 30_000 })

  const target = fixture.services[0]!
  await page.getByTestId('pro-catalog-list').getByText(target.name, { exact: false }).first().click()
  // « Ce qui n'est pas permis n'est pas rendu » : pas de champ grisé, pas de cadenas.
  await expect(page.getByTestId('pro-catalog-field-price')).toHaveCount(0)
  await expect(page.getByTestId('pro-catalog-field-duration')).toBeVisible()

  const newDuration = String(target.duration + 5)
  await page.getByTestId('pro-catalog-field-duration').fill(newDuration)
  await page.getByTestId('pro-catalog-save').click()
  await expect
    .poll(() => sql(`select duration_minutes from public.services where id='${target.id}'`), { timeout: 20_000 })
    .toBe(newDuration)
  // Le prix n'a pas bougé.
  expect(sql(`select price_cents from public.services where id='${target.id}'`)).toBe(String(target.price))
  sql(`update public.services set duration_minutes=${target.duration} where id='${target.id}'`)
})

test('catalogue — la durée observée s’affiche quand elle existe, et RIEN quand elle n’existe pas', async ({ page }) => {
  const service = fixture.services[0]!
  sql(`delete from public.service_duration_samples where service_id='${service.id}'`)

  await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
  await page.goto('/dashboard/catalog')
  await page.getByTestId('pro-catalog-list').waitFor({ timeout: 30_000 })
  // Sans mesure : aucune moyenne observée nulle part, et surtout pas un zéro.
  await expect(page.getByText(OBSERVED)).toHaveCount(0)

  // Huit mesures réelles de 27 minutes.
  for (let i = 0; i < 8; i += 1) {
    sql(`insert into public.service_duration_samples
           (organization_id, location_id, barber_id, service_id, source, source_entry_id, started_at, ended_at)
         values ('${ORG_ID}','${fixture.locationId}','${fixture.barbers[0]!.id}','${service.id}','queue',
                 gen_random_uuid(), now() - interval '${i + 1} days',
                 now() - interval '${i + 1} days' + interval '27 minutes')`)
  }
  await page.reload()
  await page.getByTestId('pro-catalog-list').waitFor()
  await expect(page.getByText(OBSERVED).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/27/).first()).toBeVisible()

  // Et l'effet sur l'estimation est EXPLIQUÉ au professionnel.
  await page.getByTestId('pro-catalog-list').getByText(service.name, { exact: false }).first().click()
  await expect(page.getByTestId('pro-catalog-estimate')).toBeVisible()
  await expect(page.getByTestId('pro-catalog-estimate')).toContainText(/8/)

  sql(`delete from public.service_duration_samples where service_id='${service.id}'`)
})

test('clients — la liste, le segment des non revenus, et une note privée', async ({ page }) => {
  const errors = watchConsole(page)
  const lapsed = seedCustomer(`Regulier ${suffix}`, 4, 100, 28)

  await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
  await page.goto('/dashboard/clients')
  await page.getByTestId('pro-clients-list').waitFor({ timeout: 30_000 })

  // Le rappel qui a de la valeur, et qui bascule sur le segment.
  await expect(page.getByTestId('pro-clients-lapsed-callout')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('pro-clients-lapsed-callout').getByRole('button').first().click()
  await expect(page.getByTestId('pro-clients-list').getByText(`QA OS2 Regulier ${suffix}`)).toBeVisible()

  // La fiche.
  await page.getByTestId('pro-clients-list').getByText(`QA OS2 Regulier ${suffix}`).click()
  await page.getByTestId('pro-client-detail').waitFor({ timeout: 20_000 })
  await expect(page.getByTestId('pro-client-visits')).toContainText('4')

  // Une note privée, écrite et relue.
  const note = `Préfère le dégradé court ${suffix}`
  await page.getByTestId('pro-client-note-input').fill(note)
  await page.getByTestId('pro-client-note-submit').click()
  await expect(page.getByTestId('pro-client-notes').getByText(note)).toBeVisible({ timeout: 20_000 })
  expect(sql(`select count(*) from public.customer_notes where customer_id='${lapsed}'`)).toBe('1')
  // Elle est écrite au nom du compte connecté, jamais d'un paramètre.
  expect(
    sql(`select count(*) from public.customer_notes n join auth.users u on u.id=n.author_user_id
         where n.customer_id='${lapsed}' and u.email='${QA_OWNER_EMAIL}'`),
  ).toBe('1')

  // L'historique existe et porte les prestations réelles.
  await expect(page.getByTestId('pro-client-history-row').first()).toBeVisible()

  await noSeriousViolations(page)
  expect(errors).toEqual([])
})

test('équipe — inviter par e-mail, et le retrait qui préserve le profil professionnel', async ({ page }) => {
  const errors = watchConsole(page)
  const email = `${QA_MARK}-invite-${suffix}@fadeup.test`
  sql(`delete from public.invitations where organization_id='${ORG_ID}' and email='${email}'`)
  sql(`delete from public.email_outbox where to_email='${email}'`)

  await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
  await page.goto('/dashboard/team')
  await page.getByTestId('pro-team-members').waitFor({ timeout: 30_000 })

  await page.getByTestId('pro-team-invite').click()
  await page.getByTestId('pro-team-invite-sheet').waitFor()
  await page.getByTestId('pro-team-invite-email').fill(email)
  await page.getByTestId('pro-team-invite-submit').click()

  await expect
    .poll(
      () => sql(`select count(*) from public.invitations where organization_id='${ORG_ID}' and email='${email}' and revoked_at is null and accepted_at is null`),
      { timeout: 20_000 },
    )
    .toBe('1')
  // L'envoi passe par email_outbox et le gabarit existant — pas de second système.
  expect(sql(`select count(*) from public.email_outbox where template='team_invitation' and to_email='${email}'`)).toBe('1')
  await expect(page.getByTestId('pro-team-invitations').getByText(email)).toBeVisible({ timeout: 20_000 })

  // Le dialogue de retrait DIT que le profil professionnel survit. Les
  // actions d'une rangée vivent derrière un popover (régime dense).
  const rows = page.getByTestId('pro-team-member')
  const count = await rows.count()
  let opened = false
  for (let i = 0; i < count && !opened; i += 1) {
    const trigger = rows.nth(i).getByRole('button').first()
    if (!(await trigger.isVisible())) continue
    await trigger.click()
    if (await page.getByTestId('pro-team-remove').isVisible().catch(() => false)) {
      opened = true
      break
    }
    await page.keyboard.press('Escape')
  }
  expect(opened, 'au moins un membre doit être retirable par le propriétaire').toBe(true)
  await page.getByTestId('pro-team-remove').click()
  await page.getByTestId('pro-team-remove-dialog').waitFor()
  await expect(page.getByTestId('pro-team-remove-identity-notice')).toBeVisible()
  await page.keyboard.press('Escape')

  await noSeriousViolations(page)
  expect(errors).toEqual([])
})

test('équipe — un solo_professional n’a pas cet écran, même par URL directe', async ({ page }) => {
  sql(`update public.organizations set business_type='solo_professional' where id='${ORG_ID}'`)
  try {
    await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
    await page.goto('/dashboard/team')
    await page.waitForURL((url) => url.pathname === '/dashboard', { timeout: 30_000 })
    // L'entrée de menu n'existe pas non plus dans le DOM.
    await expect(page.getByRole('link', { name: /^(Équipe|Team)$/ })).toHaveCount(0)
  } finally {
    sql(`update public.organizations set business_type='barbershop' where id='${ORG_ID}'`)
  }
})

test('file — les seuils se lisent et s’écrivent en base depuis l’écran', async ({ page }) => {
  const errors = watchConsole(page)
  // Des seuils volontairement inhabituels, écrits AVANT l'ouverture.
  sql(`update public.location_service_settings
         set queue_capacity_per_barber=17, queue_call_grace_minutes=9, queue_geofence_meters=275
       where location_id='${fixture.locationId}'`)
  await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
  await page.goto('/dashboard/queue/settings')
  await page.getByTestId('pro-queue-settings-thresholds').waitFor({ timeout: 30_000 })

  // Les valeurs affichées viennent de la BASE, pas d'une constante — et on
  // le prouve avec des valeurs qui ne sont PAS les défauts SQL (20 / 5 / 150),
  // sinon l'assertion ne distinguerait pas les deux hypothèses.
  await expect(page.getByTestId('pro-queue-threshold-capacity')).toHaveValue('17')
  await expect(page.getByTestId('pro-queue-threshold-grace')).toHaveValue('9')
  await expect(page.getByTestId('pro-queue-threshold-geofence')).toHaveValue('275')

  await page.getByTestId('pro-queue-threshold-capacity').fill('14')
  await page.getByTestId('pro-queue-thresholds-save').click()
  await expect
    .poll(
      () => sql(`select queue_capacity_per_barber || '/' || queue_geofence_meters from public.location_service_settings where location_id='${fixture.locationId}'`),
      { timeout: 20_000 },
    )
    // Le rayon, non touché, n'a pas été écrasé.
    .toBe('14/275')

  // L'interrupteur de file par barber écrit bien en base depuis CET écran.
  // (Que la désactivation se répercute côté CLIENT est prouvé séparément,
  //  par `list_public_queues` dans contracts.spec.ts — ici on ne teste que
  //  l'écran.)
  await page.getByTestId('pro-queue-settings-barbers').getByRole('switch').first().click()
  await expect
    .poll(
      () => sql(`select count(*) from public.barbers where organization_id='${ORG_ID}' and not queue_enabled`),
      { timeout: 20_000 },
    )
    .not.toBe('0')

  await noSeriousViolations(page)
  expect(errors).toEqual([])
})
