import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  ORG_ID,
  QA_BARBER_EMAIL,
  QA_MARK,
  QA_OWNER_EMAIL,
  QA_PASSWORD,
  atUtc,
  createAppointment,
  ensureFixture,
  neutralize,
  passwordToken,
  qaDay,
  rpc,
  signIn,
  sql,
  type Fixture,
} from './helpers'

/**
 * OS-1 — la campagne de l'agenda : vue jour par barber, vue semaine par
 * ressource, glisser-déposer (souris à 1440, toucher synthétique à 390 +
 * repli par menu), conflit → avertissement → forçage tracé, forçage refusé
 * aux rôles non habilités, création manuelle, blocage ponctuel et
 * récurrent, terminé (durée collectée), absent, annulation, revenu par
 * permission, solo sans sélecteur, realtime (seul l'élément modifié
 * s'anime), aucun canal orphelin, axe, reduced-motion.
 *
 * Organisation partagée qa-f1b-shared (QA_DATA règle 3) ; données marquées
 * qa-os1 AVANT création ; neutralisation en fin de campagne. UNE campagne à
 * la fois (règle 2b).
 */

test.describe.configure({ mode: 'serial', timeout: 150_000 })

let fixture: Fixture
let ownerToken: string
let day: string

test.beforeAll(async () => {
  fixture = ensureFixture()
  neutralize()
  ownerToken = await passwordToken(QA_OWNER_EMAIL, QA_PASSWORD)
  day = qaDay(1)
})

test.afterAll(() => {
  neutralize()
})

const barber = (index: number) => fixture.barbers[index]!
const service = (name: string) => fixture.services.find((s) => s.name === name)!

async function ownerAgenda(page: Page): Promise<void> {
  await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
  await page.goto('/dashboard/agenda')
  await expect(page.getByTestId('pro-agenda')).toBeVisible({ timeout: 60_000 })
  // Le jour QA = demain.
  await page.getByTestId('agenda-next').click()
  await expect(page.getByTestId('agenda-day-grid')).toBeVisible({ timeout: 45_000 })
}

function card(page: Page, id: string): Locator {
  return page.locator(`[data-appointment-id="${id}"]`)
}

async function gridGeometry(page: Page): Promise<{ startHour: number; hourHeight: number }> {
  const grid = page.locator('[data-hour-start]')
  return {
    startHour: Number(await grid.getAttribute('data-hour-start')),
    hourHeight: Number(await grid.getAttribute('data-hour-height')),
  }
}

/**
 * Amène la source ET la cible dans la fenêtre : un point hors viewport ne
 * touche aucun élément (elementFromPoint), comme pour un vrai utilisateur
 * qui défile avant de saisir.
 */
async function scrollForDrag(page: Page, source: Locator, column: Locator, targetMinutes: number): Promise<void> {
  const { startHour, hourHeight } = await gridGeometry(page)
  const box = (await source.boundingBox())!
  const col = (await column.boundingBox())!
  const targetTop = col.y + ((targetMinutes - startHour * 60) / 60) * hourHeight
  const top = Math.min(box.y, targetTop) - 96
  await page.evaluate((delta) => window.scrollBy(0, delta), top)
  await page.waitForTimeout(150)
}

/** Glisser SOURIS : appui, seuil, déplacement en plusieurs pas, relâchement. */
async function mouseDrag(page: Page, source: Locator, column: Locator, targetMinutes: number): Promise<void> {
  await scrollForDrag(page, source, column, targetMinutes)
  const { startHour, hourHeight } = await gridGeometry(page)
  const box = (await source.boundingBox())!
  const col = (await column.boundingBox())!
  const grabX = box.x + Math.min(24, box.width / 2)
  const grabY = box.y + 6
  await page.mouse.move(grabX, grabY)
  await page.mouse.down()
  await page.mouse.move(grabX + 6, grabY + 6)
  const targetTop = col.y + ((targetMinutes - startHour * 60) / 60) * hourHeight
  await page.mouse.move(col.x + col.width / 2, targetTop + 6, { steps: 12 })
  await expect(page.getByTestId('agenda-drag-ghost')).toBeVisible()
  await page.mouse.up()
}

/** Glisser TOUCHER synthétique : appui long sans bouger, puis déplacement, relâchement. */
async function touchDrag(page: Page, source: Locator, column: Locator, targetMinutes: number): Promise<void> {
  await scrollForDrag(page, source, column, targetMinutes)
  const { startHour, hourHeight } = await gridGeometry(page)
  const box = (await source.boundingBox())!
  const col = (await column.boundingBox())!
  const grabX = box.x + Math.min(24, box.width / 2)
  const grabY = box.y + 6
  await source.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: grabX, clientY: grabY, bubbles: true })
  await page.waitForTimeout(400)
  await expect(page.getByTestId('agenda-drag-ghost')).toBeVisible()
  const targetTop = col.y + ((targetMinutes - startHour * 60) / 60) * hourHeight
  const targetX = col.x + col.width / 2
  const targetY = targetTop + 6
  for (let step = 1; step <= 8; step += 1) {
    const x = grabX + ((targetX - grabX) * step) / 8
    const y = grabY + ((targetY - grabY) * step) / 8
    await page.evaluate(([px, py]) => window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: px, clientY: py, bubbles: true })), [x, y])
  }
  await page.evaluate(([px, py]) => window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: px, clientY: py, bubbles: true })), [targetX, targetY])
}

function startsAtOf(id: string): string {
  return new Date(sql(`select starts_at from public.appointments where id='${id}'`)).toISOString()
}

/* ------------------------------------------------------------------ */

test.describe('OS-1 — agenda', () => {
  let a1: string // Amine 10:00 Coupe (30)
  let a2: string // Amine 11:00 Barbe (15)
  let k1: string // Karim 10:30 Coupe + barbe (45)

  test('la vue jour affiche les rendez-vous aux bonnes heures, par barber', async ({ page }, testInfo) => {
    neutralize()
    a1 = (await createAppointment(ownerToken, fixture, barber(0).id, service('Coupe').id, atUtc(day, 10, 0), 'Karim B.')).id
    a2 = (await createAppointment(ownerToken, fixture, barber(0).id, service('Barbe').id, atUtc(day, 11, 0), 'Sami D.')).id
    k1 = (await createAppointment(ownerToken, fixture, barber(1).id, service('Coupe + barbe').id, atUtc(day, 10, 30), 'Nadia R.')).id

    await ownerAgenda(page)
    const columns = page.getByTestId('agenda-column')
    const mobile = testInfo.project.name.includes('mobile')
    await expect(columns).toHaveCount(mobile ? 1 : fixture.barbers.length)

    // Chaque carte est dans la colonne de SON barber, à SA hauteur.
    const { startHour, hourHeight } = await gridGeometry(page)
    const col0 = columns.first()
    await expect(col0.locator(`[data-appointment-id="${a1}"]`)).toBeVisible()
    await expect(col0.locator(`[data-appointment-id="${a2}"]`)).toBeVisible()
    const top1 = (await card(page, a1).boundingBox())!.y - (await col0.boundingBox())!.y
    const top2 = (await card(page, a2).boundingBox())!.y - (await col0.boundingBox())!.y
    expect(Math.round(top1)).toBe(Math.round(((10 * 60 - startHour * 60) / 60) * hourHeight))
    expect(Math.round(top2)).toBe(Math.round(((11 * 60 - startHour * 60) / 60) * hourHeight))
    expect((await card(page, a1).boundingBox())!.height).toBeCloseTo(hourHeight / 2, 0)
    await expect(card(page, a1)).toContainText('10:00')
    await expect(card(page, a1)).toContainText('Karim B.')

    if (mobile) {
      // Le sélecteur devient essentiel : on change de barber.
      await page.getByRole('combobox').first().click()
      await page.getByRole('option', { name: barber(1).name }).click()
      await expect(columns.first().locator(`[data-appointment-id="${k1}"]`)).toBeVisible()
    } else {
      await expect(columns.nth(1).locator(`[data-appointment-id="${k1}"]`)).toBeVisible()
      await expect(columns.first().locator(`[data-appointment-id="${k1}"]`)).toHaveCount(0)
      // Le patron voit le revenu ; le prix est sur la carte de 45 min.
      await expect(page.getByTestId('agenda-revenue')).toBeVisible()
      await expect(card(page, k1).getByTestId('agenda-price')).toContainText('30')
    }
    // Aucun débordement horizontal de la page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)

    // La navigation entre jours n'anime RIEN (contrat §5) et ne remplace pas
    // la grille par un squelette : lendemain puis retour, les cartes
    // reviennent sans jeton d'arrivée.
    const anchor = mobile ? k1 : a1 // à 390, la colonne affichée est celle de Karim (choisie ci-dessus)
    await page.getByTestId('agenda-next').click()
    await expect(card(page, anchor)).toHaveCount(0)
    await expect(page.getByTestId('agenda-day-grid')).toBeVisible()
    await page.getByTestId('agenda-prev').click()
    await expect(card(page, anchor)).toBeVisible()
    expect(await page.locator('[data-testid="agenda-appointment"].fu-rise-in, [data-testid="agenda-appointment"].fu-update-flash').count()).toBe(0)
  })

  test('la vue semaine par ressource : barbers côte à côte, jours empilés, aération respectée', async ({ page }, testInfo) => {
    await ownerAgenda(page)
    await page.getByRole('radio', { name: /semaine|week/i }).click()
    await expect(page.getByTestId('agenda-week-grid')).toBeVisible()
    const mobile = testInfo.project.name.includes('mobile')
    const cells = page.getByTestId('agenda-week-cell')
    await expect(cells).toHaveCount(7 * (mobile ? 1 : fixture.barbers.length))
    // Chaque colonne fait au moins 200 px : l'aération est tenue, la page ne déborde pas.
    const widths = await cells.evaluateAll((els) => els.slice(0, 3).map((el) => el.getBoundingClientRect().width))
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(200)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    // La puce est dans la cellule (jour QA × barber 0), triée, avec l'heure en mono.
    const cell = page.locator(`[data-drop-day="${day}"][data-drop-barber="${barber(0).id}"]`)
    await expect(cell.locator('[data-testid="agenda-appointment"]')).toHaveCount(2)
    await expect(cell.locator('[data-testid="agenda-appointment"]').first()).toContainText('10:00')
    if (!mobile) {
      // Le filtre limite les barbers côte à côte — la réponse à la tension aération / ressources.
      await page.locator(`[data-testid="agenda-barber-chip"][data-barber-id="${barber(2).id}"]`).click()
      await expect(cells).toHaveCount(7 * (fixture.barbers.length - 1))
      await page.getByTestId('agenda-barber-all').click()
      await expect(cells).toHaveCount(7 * fixture.barbers.length)
    }
  })

  test('glisser un rendez-vous le déplace dans le temps et entre barbers ; le client le voit', async ({ page }, testInfo) => {
    await ownerAgenda(page)
    const mobile = testInfo.project.name.includes('mobile')
    const columns = page.getByTestId('agenda-column')
    // Dans le temps : a2 (11:00) → 13:00, même barber.
    if (mobile) await touchDrag(page, card(page, a2), columns.first(), 13 * 60)
    else await mouseDrag(page, card(page, a2), columns.first(), 13 * 60)
    await expect.poll(() => startsAtOf(a2), { timeout: 15_000 }).toBe(atUtc(day, 13, 0))
    await expect(card(page, a2)).toContainText(/13:00|01:00 PM/)
    // Le client le voit : notification de déplacement émise (e-mail transactionnel de la réservation).
    expect(
      sql(`select count(*) from public.email_outbox where template='booking_rescheduled' and dedupe_key like '${a2}:%'`),
    ).not.toBe('0')

    if (!mobile) {
      // Entre barbers : a2 → colonne de Karim, 14:00.
      await mouseDrag(page, card(page, a2), columns.nth(1), 14 * 60)
      await expect.poll(() => sql(`select barber_id from public.appointments where id='${a2}'`), { timeout: 15_000 }).toBe(barber(1).id)
      await expect(columns.nth(1).locator(`[data-appointment-id="${a2}"]`)).toBeVisible()
    } else {
      // Le repli par menu : « Déplacer » vers Karim Trois à 14:00.
      await card(page, a2).click()
      await page.getByTestId('agenda-move').click()
      await page.getByTestId('agenda-move-form').getByLabel(/heure|time/i).fill('14:00')
      await page.getByTestId('agenda-move-form').getByRole('combobox').click()
      await page.getByRole('option', { name: barber(1).name }).click()
      await page.getByTestId('agenda-move-submit').click()
      await expect.poll(() => sql(`select barber_id from public.appointments where id='${a2}'`), { timeout: 15_000 }).toBe(barber(1).id)
    }
    expect(startsAtOf(a2)).toBe(atUtc(day, 14, 0))
  })

  test('un conflit déclenche un avertissement ; forcer trace l’opération (qui, quand, pourquoi)', async ({ page }, testInfo) => {
    await ownerAgenda(page)
    const mobile = testInfo.project.name.includes('mobile')
    const columns = page.getByTestId('agenda-column')
    // a1 (Amine 10:00–10:30) → 10:15, sur… lui-même déplacé ? Non : on crée
    // un second rendez-vous d'Amine à 15:00 et on glisse a1 dessus.
    const a3 = (await createAppointment(ownerToken, fixture, barber(0).id, service('Coupe').id, atUtc(day, 15, 0), 'Yanis T.')).id
    await expect(card(page, a3)).toBeVisible({ timeout: 15_000 })
    if (mobile) await touchDrag(page, card(page, a1), columns.first(), 15 * 60)
    else await mouseDrag(page, card(page, a1), columns.first(), 15 * 60)

    const dialog = page.getByTestId('agenda-conflict')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Yanis T.')
    // Rien n'a bougé sans décision.
    expect(startsAtOf(a1)).toBe(atUtc(day, 10, 0))
    // Sans motif, pas de forçage.
    await page.getByTestId('agenda-conflict-force').click()
    await expect(dialog).toContainText(/motif|reason/i)
    expect(startsAtOf(a1)).toBe(atUtc(day, 10, 0))
    await page.getByTestId('agenda-force-reason').fill('Client fidèle, deux fauteuils')
    await page.getByTestId('agenda-conflict-force').click()
    await expect.poll(() => startsAtOf(a1), { timeout: 15_000 }).toBe(atUtc(day, 15, 0))

    // La trace : sur la ligne ET dans le journal.
    const trace = sql(`select coalesce(overlap_forced_reason,'') || '|' || (overlap_forced_by is not null)::text || '|' || (overlap_forced_at is not null)::text from public.appointments where id='${a1}'`)
    expect(trace).toBe('Client fidèle, deux fauteuils|true|true')
    const log = sql(`select action || '|' || reason || '|' || (u.email) || '|' || (f.conflicting_appointment_ids @> array['${a3}'::uuid])::text
      from public.appointment_overlap_forces f join auth.users u on u.id=f.forced_by where f.appointment_id='${a1}'`)
    expect(log).toBe(`reschedule|Client fidèle, deux fauteuils|${QA_OWNER_EMAIL}|true`)
    // La carte dit « Forcé » — la couleur n'est jamais seule.
    await expect(card(page, a1)).toHaveAttribute('data-tone', 'forced')
    await expect(card(page, a1)).toContainText(/Forcé|Forced/)
    // Les deux cartes se partagent la largeur (couloirs) — aucune n'est cachée.
    await expect(card(page, a3)).toBeVisible()
  })

  test('forcer est refusé à un rôle non habilité', async ({ page }) => {
    // Le barber salarié : la RPC refuse (il ne déplace pas), le forçage encore moins.
    const barberToken = await passwordToken(QA_BARBER_EMAIL, QA_PASSWORD)
    const refusal = await rpc('reschedule_appointment', { p_appointment_id: k1, p_starts_at: atUtc(day, 10, 0), p_force: true, p_force_reason: 'je veux' }, barberToken)
    expect(refusal.status).toBe(403)
    expect(JSON.stringify(refusal.body)).toContain('fadeup_booking_refusal=not_authorized')
    // Et la création forcée par le barber : refusée aussi.
    const created = await rpc('create_appointment_as_business', {
      p_location_id: fixture.locationId, p_barber_id: barber(0).id, p_service_id: service('Coupe').id,
      p_starts_at: atUtc(day, 15, 0), p_customer_name: 'Intrus', p_force: true, p_force_reason: 'x',
    }, barberToken)
    expect(created.status).toBe(403)
    // Le réceptionniste : tranché OS-1, refusé — prouvé en SQL (verify_os1 O2c/O6f) ;
    // ici on prouve la garde SQL elle-même à travers la fonction d'accès.
    expect(sql(`select private.can_force_overlap('${ORG_ID}')`)).toBe('f')

    // Côté écran, le barber n'a AUCUNE prise : pas de glisser, pas de forçage.
    await signIn(page, QA_BARBER_EMAIL, QA_PASSWORD)
    await page.goto('/dashboard/agenda')
    await page.getByTestId('agenda-next').click()
    await expect(page.getByTestId('agenda-day-grid')).toBeVisible({ timeout: 45_000 })
    // Il voit SA journée par défaut (Amine Deux) — a3 est dans sa colonne.
    const columns = page.getByTestId('agenda-column')
    await expect(columns).toHaveCount(1)
    await expect(columns.first().locator('[data-testid="agenda-appointment"]').first()).toBeVisible()
    const cursor = await columns.first().locator('[data-testid="agenda-appointment"]').first().evaluate((el) => getComputedStyle(el).cursor)
    expect(cursor).not.toBe('grab')
    await columns.first().locator('[data-testid="agenda-appointment"]').first().click()
    await expect(page.getByTestId('agenda-appointment-sheet')).toBeVisible()
    await expect(page.getByTestId('agenda-move')).toHaveCount(0)
    await expect(page.getByTestId('agenda-cancel')).toHaveCount(0)
    // Mais il peut marquer terminé / absent sur SON rendez-vous.
    await expect(page.getByTestId('agenda-complete')).toBeVisible()
  })

  test('créer manuellement, bloquer du temps (ponctuel et récurrent), marquer terminé, marquer absent, annuler', async ({ page }, testInfo) => {
    await ownerAgenda(page)
    const mobile = testInfo.project.name.includes('mobile')

    // Créer : un client appelle.
    await page.getByTestId('agenda-create-button').click()
    const form = page.getByTestId('agenda-create-form')
    await expect(form).toBeVisible()
    await form.getByLabel(/date/i).fill(day)
    await form.getByLabel(/heure|time/i).fill('16:00')
    await page.getByTestId('agenda-create-name').fill('Léo M.')
    await form.getByLabel(/e-?mail/i).fill(`${QA_MARK}-leom@fadeup.test`)
    await form.getByLabel(/note/i).fill(QA_MARK)
    await page.getByTestId('agenda-create-submit').click()
    await expect(form).toBeHidden({ timeout: 15_000 })
    const createdId = sql(`select id from public.appointments where organization_id='${ORG_ID}' and customer_name='Léo M.' and notes='${QA_MARK}' order by created_at desc limit 1`)
    expect(createdId).not.toBe('')
    expect(sql(`select status || '|' || (created_by is not null)::text from public.appointments where id='${createdId}'`)).toBe('confirmed|true')
    expect(startsAtOf(createdId)).toBe(atUtc(day, 16, 0))
    await expect(card(page, createdId)).toBeVisible({ timeout: 15_000 })

    // Bloquer : ponctuel.
    await page.getByTestId('agenda-block-button').click()
    const blockForm = page.getByTestId('agenda-block-form')
    await expect(blockForm).toBeVisible()
    await blockForm.getByLabel(/date/i).fill(day)
    await blockForm.getByLabel(/début|start/i).fill('12:00')
    await blockForm.getByLabel(/^fin|^end/i).fill('13:00')
    await page.getByTestId('agenda-block-reason').fill(`${QA_MARK} Pause déjeuner`)
    await page.getByTestId('agenda-block-submit').click()
    await expect(blockForm).toBeHidden({ timeout: 15_000 })
    await expect(page.getByTestId('agenda-block')).toHaveCount(1, { timeout: 15_000 })
    expect(sql(`select count(*) from public.time_blocks where organization_id='${ORG_ID}' and reason='${QA_MARK} Pause déjeuner'`)).toBe('1')

    // Bloquer : récurrent, 3 semaines → 3 occurrences liées par série.
    await page.getByTestId('agenda-block-button').click()
    await blockForm.getByLabel(/date/i).fill(day)
    await blockForm.getByLabel(/début|start/i).fill('18:00')
    await blockForm.getByLabel(/^fin|^end/i).fill('19:00')
    await page.getByTestId('agenda-block-reason').fill(`${QA_MARK} Formation`)
    await blockForm.getByRole('checkbox').click()
    await page.getByTestId('agenda-block-until').fill(qaDay(15))
    // L'aide du champ annonce le nombre d'occurrences (3 semaines).
    await expect(blockForm).toContainText(/3 (occurrences|séances|sessions)/i)
    await page.getByTestId('agenda-block-submit').click()
    await expect(blockForm).toBeHidden({ timeout: 15_000 })
    await expect.poll(() => sql(`select count(*) from public.time_blocks where reason='${QA_MARK} Formation'`)).toBe('3')
    expect(sql(`select count(distinct series_id) from public.time_blocks where reason='${QA_MARK} Formation' and series_id is not null`)).toBe('1')
    // Retirer toute la série depuis une occurrence.
    await page.locator('[data-testid="agenda-block"]').filter({ hasText: 'Formation' }).first().click()
    await page.getByTestId('agenda-block-remove-series').click()
    await expect.poll(() => sql(`select count(*) from public.time_blocks where reason='${QA_MARK} Formation'`), { timeout: 15_000 }).toBe('0')

    // Marquer terminé — en un geste — et la durée réelle est collectée.
    // Le rendez-vous doit avoir COMMENCÉ pour qu'une durée existe : la ligne
    // Léo M. est reculée à « il y a 25 minutes » (chemin sanctionné du
    // verify, jamais un usage client) ; l'écran revient sur aujourd'hui.
    sql(`select set_config('fadeup.appointment_reschedule','on',false); update public.appointments set starts_at=now()-interval '25 minutes', ends_at=now()+interval '5 minutes' where id='${createdId}'`)
    await page.getByTestId('agenda-today').click()
    // UN geste : le bouton « Terminé » de la carte (rendez-vous commencé).
    const quick = card(page, createdId).getByTestId('agenda-quick-complete')
    await expect(quick).toHaveCount(1)
    await quick.click()
    await expect.poll(() => sql(`select status from public.appointments where id='${createdId}'`), { timeout: 15_000 }).toBe('completed')
    await expect(page.getByTestId('agenda-appointment-sheet')).toHaveCount(0)
    expect(
      sql(`select (completed_at is not null)::text || '|' || (select count(*) from public.service_duration_samples s where s.source='appointment' and s.source_entry_id=a.id and s.duration_minutes between 24 and 27) from public.appointments a where a.id='${createdId}'`),
    ).toBe('true|1')
    await expect(card(page, createdId)).toHaveAttribute('data-tone', 'completed')

    // Marquer absent : enregistré, AUCUNE restriction du client.
    await page.getByTestId('agenda-next').click()
    await card(page, a3Of()).click()
    await expect(page.getByTestId('agenda-appointment-sheet')).toContainText(/sans restriction|no restriction/i)
    await page.getByTestId('agenda-no-show').click()
    await expect.poll(() => sql(`select status from public.appointments where id='${a3Of()}'`), { timeout: 15_000 }).toBe('no_show')
    expect(sql(`select count(*) from information_schema.tables where table_schema='public' and table_name like '%restriction%'`)).toBe('0')

    // Annuler côté salon : le client est prévenu. (À 390, une colonne à la
    // fois : on passe sur celle de Karim.)
    if (mobile) {
      await page.getByRole('combobox').first().click()
      await page.getByRole('option', { name: barber(1).name }).click()
    }
    await card(page, k1).click()
    await page.getByTestId('agenda-cancel').click()
    await page.getByTestId('agenda-cancel-confirm').click()
    await expect.poll(() => sql(`select status || '|' || resolution from public.appointments where id='${k1}'`), { timeout: 15_000 }).toBe('cancelled|cancelled_by_business')
    expect(sql(`select count(*) from public.email_outbox where template='booking_cancelled' and dedupe_key like '${k1}:%'`)).not.toBe('0')
    await expect(card(page, k1)).toHaveCount(0)
  })

  function a3Of(): string {
    return sql(`select id from public.appointments where organization_id='${ORG_ID}' and customer_name='Yanis T.' and notes='${QA_MARK}' limit 1`)
  }

  test('un barber sans permission ne voit aucun chiffre de revenu ; le patron décide, barber par barber', async ({ page }) => {
    const membership = barber(0).membershipId!
    expect(sql(`select can_view_revenue from public.memberships where id='${membership}'`)).toBe('f')
    await signIn(page, QA_BARBER_EMAIL, QA_PASSWORD)
    await page.goto('/dashboard/agenda')
    await page.getByTestId('agenda-next').click()
    await expect(page.getByTestId('agenda-day-grid')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('agenda-appointment').first()).toBeVisible()
    // Il voit LE SIEN : aucun sélecteur, une seule colonne, que ses lignes,
    // et la réponse réseau ne porte que ses rendez-vous.
    await expect(page.getByTestId('agenda-barber-picker')).toHaveCount(0)
    await expect(page.getByTestId('agenda-column')).toHaveCount(1)
    const shown = await page.getByTestId('agenda-appointment').evaluateAll((els) => els.map((el) => el.getAttribute('data-barber-id')))
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((id) => id === fixture.barberOfAccount)).toBe(true)
    await expect(page.getByTestId('agenda-revenue')).toHaveCount(0)
    await expect(page.getByTestId('agenda-price')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('€')
    // La RPC elle-même ne rend aucun prix à ce compte.
    const barberToken = await passwordToken(QA_BARBER_EMAIL, QA_PASSWORD)
    const rows = await rpc('get_calendar_appointments', { p_organization_id: ORG_ID, p_from: atUtc(day, 0), p_to: atUtc(qaDay(2), 0) }, barberToken)
    expect(rows.status).toBe(200)
    expect((rows.body as Array<{ price_cents: number | null }>).every((r) => r.price_cents === null)).toBe(true)

    // Le patron autorise (RPC owner) → le barber voit.
    const on = await rpc('set_membership_revenue_visibility', { p_membership_id: membership, p_visible: true }, ownerToken)
    expect(on.status).toBe(200)
    await page.reload()
    await expect(page.getByTestId('agenda-day-grid')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('agenda-revenue')).toBeVisible({ timeout: 15_000 })
    // Un manager/barber ne peut pas régler (owner seul).
    const denied = await rpc('set_membership_revenue_visibility', { p_membership_id: membership, p_visible: false }, barberToken)
    expect(denied.status).toBe(403)
    await rpc('set_membership_revenue_visibility', { p_membership_id: membership, p_visible: false }, ownerToken)
  })

  test('le patron règle la permission depuis l’agenda (desktop)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'contrôle desktop (la liste d’équipe)')
    await ownerAgenda(page)
    await page.getByTestId('agenda-team-button').click()
    const popover = page.getByTestId('agenda-team-popover')
    await expect(popover).toBeVisible()
    await popover.getByRole('switch').first().click()
    await expect.poll(() => sql(`select can_view_revenue from public.memberships where id='${barber(0).membershipId}'`), { timeout: 15_000 }).toBe('t')
    await popover.getByRole('switch').first().click()
    await expect.poll(() => sql(`select can_view_revenue from public.memberships where id='${barber(0).membershipId}'`), { timeout: 15_000 }).toBe('f')
  })

  test('un solo_professional ne voit ni sélecteur de barber ni entrée d’équipe', async ({ page }) => {
    const before = sql(`select business_type from public.organizations where id='${ORG_ID}'`)
    sql(`update public.organizations set business_type='solo_professional' where id='${ORG_ID}'`)
    try {
      await ownerAgenda(page)
      await expect(page.getByTestId('agenda-barber-picker')).toHaveCount(0)
      await expect(page.getByTestId('agenda-team-button')).toHaveCount(0)
      await expect(page.getByTestId('agenda-column')).toHaveCount(1)
      await expect(page.locator('nav').getByText(/équipe|team/i)).toHaveCount(0)
      await page.getByRole('radio', { name: /semaine|week/i }).click()
      await expect(page.getByTestId('agenda-week-cell')).toHaveCount(7)
    } finally {
      sql(`update public.organizations set business_type='${before}' where id='${ORG_ID}'`)
    }
  })

  test('un rendez-vous créé ailleurs apparaît sans rafraîchir, et seul lui s’anime', async ({ page }, testInfo) => {
    await ownerAgenda(page)
    const before = await page.getByTestId('agenda-appointment').count()
    expect(before).toBeGreaterThan(0)
    // À 390, une colonne à la fois : la ligne arrive dans celle qui est affichée.
    const target = testInfo.project.name.includes('mobile') ? barber(0) : barber(2)
    const rt = await createAppointment(ownerToken, fixture, target.id, service('Barbe').id, atUtc(day, 17, 0), 'Realtime R.')
    await expect(card(page, rt.id)).toBeVisible({ timeout: 15_000 })
    await expect(card(page, rt.id)).toHaveClass(/fu-rise-in/)
    const animated = await page.locator('[data-testid="agenda-appointment"].fu-rise-in').count()
    expect(animated).toBe(1)
  })

  test('aucun canal realtime orphelin après navigation', async ({ page }, testInfo) => {
    await ownerAgenda(page)
    await page.waitForTimeout(1500)
    const live = await page.evaluate(() => {
      const client = (window as { __fuSupabase?: { getChannels: () => Array<{ state: string }> } }).__fuSupabase
      return client?.getChannels().map((c) => c.state) ?? []
    })
    expect(live.length).toBeGreaterThan(0)
    // Navigation SPA vers l'accueil : à 390 la nav vit dans le tiroir.
    if (testInfo.project.name.includes('mobile')) await page.getByRole('button', { name: /ouvrir (la )?navigation|open navigation|menu/i }).first().click()
    // Deux <nav> existent (latérale cachée + tiroir) : on clique celui qui est visible.
    await page.locator('nav').getByText(/aujourd|today/i).locator('visible=true').first().click()
    await page.waitForTimeout(1500)
    const after = await page.evaluate(() => {
      const client = (window as { __fuSupabase?: { getChannels: () => Array<{ topic: string; state: string }> } }).__fuSupabase
      return client?.getChannels().map((c) => c.topic) ?? []
    })
    expect(after.filter((topic) => topic.includes('pro-agenda'))).toHaveLength(0)
  })

  test('axe : aucune violation sérieuse ou critique (jour et semaine)', async ({ page }) => {
    await ownerAgenda(page)
    const dayResults = await new AxeBuilder({ page }).analyze()
    expect(dayResults.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
    await page.getByRole('radio', { name: /semaine|week/i }).click()
    await expect(page.getByTestId('agenda-week-grid')).toBeVisible()
    const weekResults = await new AxeBuilder({ page }).analyze()
    expect(weekResults.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  })

  test('prefers-reduced-motion : le glisser reste utilisable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('mobile'), 'geste souris')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await ownerAgenda(page)
    const target = sql(`select id from public.appointments where organization_id='${ORG_ID}' and customer_name='Realtime R.' and notes='${QA_MARK}' limit 1`)
    await mouseDrag(page, card(page, target), page.getByTestId('agenda-column').nth(2), 19 * 60)
    await expect.poll(() => startsAtOf(target), { timeout: 15_000 }).toBe(atUtc(day, 19, 0))
  })
})
