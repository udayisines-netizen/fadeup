import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  ORG_NAME,
  ORG_SLUG,
  QA_BARBER_EMAIL,
  QA_EMAIL,
  QA_PASSWORD,
  SHOP_COORDS,
  anonRpc,
  sql,
} from './helpers'

/**
 * F1b — files par barber, estimation, quitter, compte à rebours, balayage —
 * de bout en bout contre la base réelle.
 *
 * SÉRIELLE et re-entrante : la suite réutilise UNE organisation partagée
 * (`qa-f1b-shared`), créée une seule fois par le vrai parcours /setup puis
 * réactivée à chaque exécution — leçon des 29 organisations de F1. Les refus
 * inatteignables depuis l'interface (c'est leur but) sont prouvés contre
 * l'API réelle via Kong (anonRpc), jamais simulés.
 */

let locationId = ''
let checkInToken = ''
let barberAmineId = ''
let barberKarimId = ''
let serviceId = ''

function queueUrl(withToken: boolean): string {
  const base = `/q/${ORG_SLUG}?l=${locationId}`
  return withToken ? `${base}&t=${checkInToken}` : base
}

async function newClientContext(
  browser: Browser,
  options: { geolocation?: { latitude: number; longitude: number } } = {},
): Promise<BrowserContext> {
  return browser.newContext({
    locale: 'fr-FR',
    ...(options.geolocation ? { geolocation: options.geolocation, permissions: ['geolocation'] } : {}),
  })
}

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/auth/login')
  await page.getByLabel('Adresse e-mail').fill(email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(QA_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 20_000 })
}

/** Rejoint une file : celle passée en argument (nom affiché), sinon le CTA collant (premier disponible). */
async function joinAs(page: Page, name: string, pickQueue?: string): Promise<void> {
  await page.goto(queueUrl(true))
  if (pickQueue) {
    await page.getByTestId('queue-list').getByRole('button', { name: new RegExp(pickQueue) }).click()
  } else {
    await page.getByTestId('queue-join-cta').click()
  }
  await page.getByLabel('Votre prénom').fill(name)
  await page.getByRole('button', { name: /Rejoindre — ma position/ }).click()
}

test.describe.serial('F1b — files par barber, sorties, échéances, balayage', () => {
  test.describe.configure({ timeout: 150_000 })

  test('fixture : l’organisation partagée est prête (créée UNE fois, réactivée ensuite)', async ({ browser }) => {
    const orgExists = sql(`select count(*) from public.organizations where slug='${ORG_SLUG}'`) !== '0'
    const ownerExists = sql(`select count(*) from auth.users where email='${QA_EMAIL}'`) !== '0'

    if (!orgExists) {
      const context = await newClientContext(browser, { geolocation: SHOP_COORDS })
      const page = await context.newPage()

      if (!ownerExists) {
        await page.goto('/auth/signup?redirect=%2Fsetup')
        await page.getByLabel('Adresse e-mail').fill(QA_EMAIL)
        await page.getByLabel('Mot de passe', { exact: true }).fill(QA_PASSWORD)
        await page.getByRole('button', { name: 'Créer mon compte' }).click()
        await expect(page).toHaveURL(/\/setup/, { timeout: 20_000 })
      } else {
        await login(page, QA_EMAIL)
        await page.goto('/setup')
      }

      await page.getByLabel('Nom du salon').fill(ORG_NAME)
      await page.getByLabel('Adresse FadeUp').fill(ORG_SLUG)
      await page.getByRole('button', { name: 'Enregistrer et continuer' }).click()
      await page.getByLabel('Nom affiché').fill('Qa Owner')
      await page.getByRole('button', { name: 'Enregistrer et continuer' }).click()
      await page.getByLabel('Adresse', { exact: true }).fill('10 rue de la Clipper')
      await page.getByLabel('Code postal').fill('93400')
      await page.getByLabel('Ville').fill('Saint-Ouen')
      await page.getByRole('button', { name: 'Utiliser ma position' }).click()
      await expect(page.getByText('Position enregistrée')).toBeVisible()
      await page.getByRole('button', { name: 'Enregistrer et continuer' }).click()
      await page.getByRole('button', { name: 'Enregistrer et continuer' }).click()
      await page.getByRole('button', { name: 'Enregistrer et continuer' }).click()
      await page.getByRole('button', { name: /Terminer l’installation|Terminer l'installation/ }).click()
      const openButton = page.getByRole('button', { name: 'Ouvrir la file maintenant' })
      const poster = page.locator('#fu-qr-poster')
      await expect(poster.or(openButton)).toBeVisible({ timeout: 30_000 })
      if (await openButton.isVisible()) await openButton.click()
      await expect(poster).toBeVisible({ timeout: 30_000 })
      await context.close()
    }

    // Le compte du BARBER salarié (droit de déplacement F1b) — créé une fois.
    const barberUserExists = sql(`select count(*) from auth.users where email='${QA_BARBER_EMAIL}'`) !== '0'
    if (!barberUserExists) {
      const context = await newClientContext(browser)
      const page = await context.newPage()
      await page.goto('/auth/signup')
      await page.getByLabel('Adresse e-mail').fill(QA_BARBER_EMAIL)
      await page.getByLabel('Mot de passe', { exact: true }).fill(QA_PASSWORD)
      await page.getByRole('button', { name: 'Créer mon compte' }).click()
      await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 20_000 })
      await context.close()
    }

    // Réactivation (la suite précédente a neutralisé) + barbers de test.
    sql(`
      update public.organizations set name='${ORG_NAME}', marketplace_visible=false where slug='${ORG_SLUG}';
      update public.locations l set is_active=true
        from public.organizations o where l.organization_id=o.id and o.slug='${ORG_SLUG}';
      update public.location_service_settings s
         set queue_open=true, queue_grace_sweep_enabled=false, default_service_mode='hybrid'
        from public.locations l join public.organizations o on o.id=l.organization_id
        where s.location_id=l.id and o.slug='${ORG_SLUG}';
      update public.queue_entries qe set status='cancelled'
        from public.organizations o
        where qe.organization_id=o.id and o.slug='${ORG_SLUG}'
          and qe.status in ('waiting','called','in_service');
      update public.staff_profiles sp set is_active=true, is_public=true
        from public.organizations o where sp.organization_id=o.id and o.slug='${ORG_SLUG}';
      update public.barbers b set is_bookable=true, queue_enabled=true
        from public.organizations o where b.organization_id=o.id and o.slug='${ORG_SLUG}';
    `)

    locationId = sql(
      `select l.id from public.locations l join public.organizations o on o.id=l.organization_id where o.slug='${ORG_SLUG}' limit 1`,
    )
    checkInToken = sql(
      `select l.queue_check_in_token from public.locations l join public.organizations o on o.id=l.organization_id where o.slug='${ORG_SLUG}' limit 1`,
    )

    // Deux barbers de plus — « Amine Deux » (rattaché au compte barber, rôle
    // membership barber : le droit de déplacer se prouve avec LUI) et
    // « Karim Trois » (sans compte).
    sql(`
      with org as (select id from public.organizations where slug='${ORG_SLUG}'),
      barber_user as (select id from auth.users where email='${QA_BARBER_EMAIL}'),
      sp_amine as (
        insert into public.staff_profiles (organization_id, user_id, location_id, display_name, is_public, is_active)
        select org.id, barber_user.id, '${locationId}', 'Amine Deux', true, true
        from org, barber_user
        where not exists (
          select 1 from public.staff_profiles sp where sp.organization_id = org.id and sp.display_name = 'Amine Deux'
        )
        returning id, organization_id
      )
      insert into public.barbers (organization_id, staff_profile_id, is_bookable)
      select organization_id, id, true from sp_amine;
      with org as (select id from public.organizations where slug='${ORG_SLUG}'),
      sp_karim as (
        insert into public.staff_profiles (organization_id, location_id, display_name, is_public, is_active)
        select org.id, '${locationId}', 'Karim Trois', true, true
        from org
        where not exists (
          select 1 from public.staff_profiles sp where sp.organization_id = org.id and sp.display_name = 'Karim Trois'
        )
        returning id, organization_id
      )
      insert into public.barbers (organization_id, staff_profile_id, is_bookable)
      select organization_id, id, true from sp_karim;
      insert into public.memberships (organization_id, user_id, role)
      select o.id, u.id, 'barber'
      from public.organizations o, auth.users u
      where o.slug='${ORG_SLUG}' and u.email='${QA_BARBER_EMAIL}'
      on conflict (organization_id, user_id) do nothing;
    `)

    barberAmineId = sql(`
      select b.id from public.barbers b
      join public.staff_profiles sp on sp.id=b.staff_profile_id
      join public.organizations o on o.id=b.organization_id
      where o.slug='${ORG_SLUG}' and sp.display_name='Amine Deux'`)
    barberKarimId = sql(`
      select b.id from public.barbers b
      join public.staff_profiles sp on sp.id=b.staff_profile_id
      join public.organizations o on o.id=b.organization_id
      where o.slug='${ORG_SLUG}' and sp.display_name='Karim Trois'`)
    serviceId = sql(`
      select s.id from public.services s
      join public.organizations o on o.id=s.organization_id
      where o.slug='${ORG_SLUG}' and s.is_active and s.duration_minutes=30
      order by s.name limit 1`)

    expect(locationId).not.toBe('')
    expect(checkInToken).toMatch(/^[0-9a-f]{32}$/)
    expect(barberAmineId).not.toBe('')
    expect(barberKarimId).not.toBe('')
    expect(serviceId).not.toBe('')
  })

  test('les files s’affichent : « premier disponible » EN TÊTE, tri par attente', async ({ browser }) => {
    const context = await newClientContext(browser)
    const page = await context.newPage()
    await page.goto(queueUrl(false))

    const list = page.getByTestId('queue-list')
    await expect(list).toBeVisible({ timeout: 15_000 })
    // Première rangée : premier disponible.
    await expect(list.getByRole('button').first()).toContainText('Premier disponible')
    // Les trois barbers à file sont listés.
    await expect(list).toContainText('Amine Deux')
    await expect(list).toContainText('Karim Trois')
    await expect(list).toContainText('Qa Owner')
    await context.close()
  })

  test('axe : aucune violation sérieuse ou critique sur la liste des files', async ({ page }) => {
    await page.goto(queueUrl(false))
    await expect(page.getByTestId('queue-list')).toBeVisible({ timeout: 15_000 })
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    )
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
  })

  test('un barber sans file disparaît côté client et son join est refusé, motif distinct', async ({ browser }) => {
    // Le propriétaire coupe la file de Karim depuis l'écran pro.
    const proContext = await newClientContext(browser)
    const pro = await proContext.newPage()
    await login(pro, QA_EMAIL)
    await pro.goto('/dashboard/queue')
    await expect(pro.getByTestId('pro-queue-settings')).toBeVisible({ timeout: 20_000 })
    await pro.getByRole('switch', { name: 'File de Karim Trois' }).click()
    await expect
      .poll(() => sql(`select queue_enabled from public.barbers where id='${barberKarimId}'`), { timeout: 15_000 })
      .toBe('f')

    // Côté client : Karim n'est plus listé.
    const context = await newClientContext(browser)
    const page = await context.newPage()
    await page.goto(queueUrl(false))
    await expect(page.getByTestId('queue-list')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('queue-list')).not.toContainText('Karim Trois')

    // Et l'API réelle refuse un join vers lui, avec SON motif — pas un
    // refus générique (contrat vérifié via Kong, comme le ferait un tiers).
    const refusal = await anonRpc('join_public_queue', {
      p_organization_slug: ORG_SLUG,
      p_location_id: locationId,
      p_customer_name: 'Refusé Karim',
      p_barber_id: barberKarimId,
      p_check_in_token: checkInToken,
      p_latitude: SHOP_COORDS.latitude,
      p_longitude: SHOP_COORDS.longitude,
    })
    expect(JSON.stringify(refusal.body), JSON.stringify(refusal)).toContain('fadeup_queue_refusal=barber_queue_disabled')
    expect([401, 403]).toContain(refusal.status)

    await context.close()
    await proContext.close()
  })

  test('rejoindre la file d’un barber choisi : la position se calcule dans SA file', async ({ browser }) => {
    // Client A — premier disponible.
    const contextA = await newClientContext(browser, { geolocation: SHOP_COORDS })
    const clientA = await contextA.newPage()
    await joinAs(clientA, 'Alpha Premier')
    await expect(clientA.getByTestId('queue-track-position')).toHaveText('1', { timeout: 15_000 })
    await expect(clientA.getByTestId('queue-track-file')).toContainText(/premier disponible/i)
    await contextA.close()

    // Client B — choisit Amine : position 1 DANS LA FILE D'AMINE, pas 2.
    const contextB = await newClientContext(browser, { geolocation: SHOP_COORDS })
    const clientB = await contextB.newPage()
    await clientB.goto(queueUrl(true))
    await clientB.getByTestId('queue-list').getByRole('button', { name: /Amine Deux/ }).click()
    await expect(clientB.getByTestId('queue-join-target')).toContainText('Amine Deux')
    await clientB.getByLabel('Votre prénom').fill('Bravo Choisi')
    await clientB.getByRole('button', { name: /Rejoindre — ma position/ }).click()
    await expect(clientB.getByTestId('queue-track-position')).toHaveText('1', { timeout: 15_000 })
    await expect(clientB.getByTestId('queue-track-file')).toContainText('Amine Deux')
    await contextB.close()
  })

  test('changer de barber : avertissement de perte de place, puis fin de la nouvelle file', async ({ browser }) => {
    // Client C rejoint premier disponible, puis bascule vers Amine — il
    // arrive DERRIÈRE Bravo (fin de file), pas devant.
    const context = await newClientContext(browser, { geolocation: SHOP_COORDS })
    const page = await context.newPage()
    await joinAs(page, 'Charlie Mobile')
    await expect(page.getByTestId('queue-track-position')).toHaveText('2', { timeout: 15_000 })

    await page.getByTestId('queue-track-change').click()
    // L'avertissement est ANNONCÉ avant confirmation.
    await expect(page.getByText(/perdre votre place/i)).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: /Amine Deux/ }).click()
    await page.getByTestId('queue-change-confirm').click()

    await expect(page.getByTestId('queue-track-file')).toContainText('Amine Deux', { timeout: 15_000 })
    await expect(page.getByTestId('queue-track-position')).toHaveText('2', { timeout: 15_000 })
    await context.close()
  })

  test('l’estimation affiche la durée déclarée quand il y a moins de cinq mesures — et RIEN sans durée', async ({
    browser,
  }) => {
    // Les entrées de la suite n'ont pas de service choisi : AUCUNE minute ne
    // s'affiche (repli « rien », loi produit). On pose le service déclaré
    // 30 min sur les deux entrées de la file d'Amine — geste comptoir — et
    // l'estimation devient la somme des durées DÉCLARÉES (0 mesure).
    const context = await newClientContext(browser)
    const page = await context.newPage()
    await page.goto(queueUrl(false))
    await expect(page.getByTestId('queue-list')).toBeVisible({ timeout: 15_000 })
    // Sans durée déclarée (pas de service) : pas de minute pour Amine.
    await expect(page.getByTestId('queue-list')).not.toContainText('≈')

    // (Drapeau du déplacement : restrict_queue_entry_self_update interdit à
    // raison un changement de service hors geste autorisé — ce SQL simule le
    // geste comptoir.)
    sql(`
      begin;
      select set_config('fadeup.queue_move', '1', true);
      update public.queue_entries qe set service_id='${serviceId}'
        from public.organizations o
        where qe.organization_id=o.id and o.slug='${ORG_SLUG}'
          and qe.status='waiting' and qe.barber_id='${barberAmineId}';
      commit;
    `)

    // 2 en attente × 30 min déclarées = 60 min, arrondies au pas de 5.
    await expect(page.getByTestId('queue-list').getByTestId('queue-list-wait').first()).toContainText('60', {
      timeout: 20_000,
    })
    await context.close()
  })

  test('un pro déplace un client, l’écran client le reflète — et le droit du BARBER est réel', async ({ browser }, testInfo) => {
    // Nom unique par tentative : une reprise ne doit pas retrouver l'entrée
    // d'une tentative précédente.
    const deltaName = `Delta R${testInfo.retry} ${Date.now().toString(36).slice(-4)}`
    // Client D suit sa place en premier disponible.
    const contextD = await newClientContext(browser, { geolocation: SHOP_COORDS })
    const clientD = await contextD.newPage()
    await joinAs(clientD, deltaName)
    await expect(clientD.getByTestId('queue-track-position')).toBeVisible({ timeout: 15_000 })

    // C'est le BARBER SALARIÉ (rôle membership barber, pas owner) qui le
    // déplace vers sa propre file — « va chez Amine, il est libre ».
    const barberContext = await newClientContext(browser)
    const barberPage = await barberContext.newPage()
    await login(barberPage, QA_BARBER_EMAIL)
    await barberPage.goto('/dashboard/queue')
    await expect(barberPage.getByTestId('pro-queue-list')).toContainText('Delta R', { timeout: 20_000 })
    const deltaEntryId = sql(`
      select qe.id from public.queue_entries qe
      join public.organizations o on o.id=qe.organization_id
      where o.slug='${ORG_SLUG}' and qe.status='waiting' and qe.customer_name='${deltaName}' limit 1`)
    expect(deltaEntryId).not.toBe('')
    await barberPage.getByTestId(`pro-queue-move-${deltaEntryId}`).click()
    await barberPage.getByTestId('pro-queue-move-sheet').getByRole('button', { name: 'Amine Deux' }).click()
    // Le FAIT d'abord (la base), l'écran ensuite.
    await expect
      .poll(() => sql(`select barber_id from public.queue_entries where id='${deltaEntryId}'`), { timeout: 15_000 })
      .toBe(barberAmineId)

    // La trace d'audit : QUI (le compte barber), d'où (premier disponible),
    // vers où (Amine), quand.
    const trace = sql(`
      select count(*) from public.queue_entry_moves m
      join public.organizations o on o.id=m.organization_id
      join auth.users u on u.id=m.moved_by
      where o.slug='${ORG_SLUG}' and u.email='${QA_BARBER_EMAIL}'
        and m.kind='staff_move' and m.from_barber_id is null and m.to_barber_id='${barberAmineId}'
        and m.entry_id='${deltaEntryId}'`)
    expect(Number(trace)).toBeGreaterThan(0)

    // Le client le VOIT, sans geste : « Vous êtes maintenant dans la file d'Amine ».
    await expect(clientD.getByTestId('queue-track-moved')).toContainText('Amine Deux', { timeout: 20_000 })
    await expect(clientD.getByTestId('queue-track-file')).toContainText('Amine Deux')

    await contextD.close()
    await barberContext.close()
  })

  test('rejoindre puis quitter ; quitter la place d’un autre est refusé', async ({ browser }) => {
    const context = await newClientContext(browser, { geolocation: SHOP_COORDS })
    const page = await context.newPage()
    await joinAs(page, 'Echo Partant')
    await expect(page.getByTestId('queue-track-position')).toBeVisible({ timeout: 15_000 })

    // L'identifiant de SA propre entrée (trace locale du navigateur).
    const entryId = await page.evaluate(() => {
      const raw = window.localStorage.getItem('fadeup.queueEntry')
      return raw ? (JSON.parse(raw) as { entryId: string }).entryId : ''
    })
    expect(entryId).not.toBe('')

    // Une entrée de COMPTE ne se quitte pas avec le seul uuid : on rattache
    // l'entrée d'un AUTRE client (Delta) au compte owner, puis on tente en
    // anonyme — refus nommé, contrat vérifié contre l'API réelle.
    const foreignEntry = sql(`
      select qe.id from public.queue_entries qe
      join public.organizations o on o.id=qe.organization_id
      where o.slug='${ORG_SLUG}' and qe.status='waiting' and qe.customer_name like 'Delta R%' limit 1`)
    sql(`
      update public.queue_entries set booked_by_user_id=(select id from auth.users where email='${QA_EMAIL}')
      where id='${foreignEntry}'`)
    const refusal = await anonRpc('leave_public_queue', { p_entry_id: foreignEntry })
    expect(JSON.stringify(refusal.body), JSON.stringify(refusal)).toContain('fadeup_queue_refusal=not_entry_owner')
    expect([401, 403]).toContain(refusal.status)

    // Et un identifiant inconnu n'existe pas.
    const unknown = await anonRpc('leave_public_queue', { p_entry_id: '00000000-0000-4000-8000-00000000f1bb' })
    expect(JSON.stringify(unknown.body), JSON.stringify(unknown)).toContain('fadeup_queue_refusal=entry_not_found')
    expect([401, 403]).toContain(unknown.status)

    // Lui, en revanche, quitte : confirmation AVANT (irréversible), état
    // honnête APRÈS, avec une action.
    await page.getByTestId('queue-track-leave').click()
    await expect(page.getByText(/Votre place sera perdue/)).toBeVisible()
    await page.getByTestId('queue-leave-confirm').click()
    await expect(page.getByTestId('queue-track-ended-left')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Revoir la file' })).toBeVisible()

    await context.close()
  })

  test('compte à rebours : présent avec échéance, jamais négatif après échéance', async ({ browser }) => {
    const context = await newClientContext(browser, { geolocation: SHOP_COORDS })
    const page = await context.newPage()
    await joinAs(page, 'Foxtrot Appelé')
    await expect(page.getByTestId('queue-track-position')).toBeVisible({ timeout: 15_000 })
    const entryId = await page.evaluate(() => {
      const raw = window.localStorage.getItem('fadeup.queueEntry')
      return raw ? (JSON.parse(raw) as { entryId: string }).entryId : ''
    })

    // Le comptoir l'appelle (transition réelle : called_at horodaté serveur).
    const proContext = await newClientContext(browser)
    const pro = await proContext.newPage()
    await login(pro, QA_EMAIL)
    await pro.goto('/dashboard/queue')
    const foxtrotEntryId = sql(`
      select qe.id from public.queue_entries qe
      join public.organizations o on o.id=qe.organization_id
      where o.slug='${ORG_SLUG}' and qe.status='waiting' and qe.customer_name='Foxtrot Appelé' limit 1`)
    await expect(pro.getByTestId(`pro-queue-call-${foxtrotEntryId}`)).toBeVisible({ timeout: 20_000 })
    await pro.getByTestId(`pro-queue-call-${foxtrotEntryId}`).click()

    // L'appel est impossible à manquer, ET porte le compte à rebours (une
    // échéance absolue existe : grâce du salon + called_at serveur).
    await expect(page.getByTestId('queue-track-called')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('queue-track-deadline')).toBeVisible({ timeout: 15_000 })
    const countdown = (await page.getByTestId('queue-track-deadline').textContent()) ?? ''
    expect(countdown).toMatch(/\d+:\d{2}/)
    expect(countdown).not.toMatch(/-\d/)

    // Échéance DÉPASSÉE (recul serveur de called_at) : plus de minutes, pas
    // de négatif — « le salon décide ».
    sql(`
      update public.queue_entries
         set created_at = created_at - interval '1 hour',
             called_at = now() - interval '30 minutes'
       where id='${entryId}'`)
    await expect(page.getByTestId('queue-track-deadline-passed')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('queue-track-deadline')).toHaveCount(0)

    await context.close()
    await proContext.close()
  })

  test('balayage activé : l’appelé au-delà du délai sort, son écran le dit sans reproche', async ({ browser }) => {
    // L'entrée « Foxtrot » est appelée, échéance dépassée depuis le test
    // précédent. Le patron ACTIVE le balayage (off par défaut) depuis l'écran.
    const proContext = await newClientContext(browser)
    const pro = await proContext.newPage()
    await login(pro, QA_EMAIL)
    await pro.goto('/dashboard/queue')
    await expect(pro.getByTestId('pro-queue-settings')).toBeVisible({ timeout: 20_000 })
    await pro.getByRole('switch', { name: /Sortie automatique/ }).click()
    await expect
      .poll(
        () =>
          sql(
            `select s.queue_grace_sweep_enabled from public.location_service_settings s where s.location_id='${locationId}'`,
          ),
        { timeout: 15_000 },
      )
      .toBe('t')

    // Le client suit toujours sa place (contexte neuf, même entrée locale).
    const context = await newClientContext(browser)
    const page = await context.newPage()
    const entryId = sql(`
      select qe.id from public.queue_entries qe
      join public.organizations o on o.id=qe.organization_id
      where o.slug='${ORG_SLUG}' and qe.status='called' and qe.customer_name='Foxtrot Appelé' limit 1`)
    expect(entryId).not.toBe('')
    await page.goto(queueUrl(false))
    await page.evaluate(
      ({ id, slug, locId }) => {
        window.localStorage.setItem(
          'fadeup.queueEntry',
          JSON.stringify({ entryId: id, slug, locationId: locId, joinedAt: new Date().toISOString() }),
        )
      },
      { id: entryId, slug: ORG_SLUG, locId: locationId },
    )
    await page.reload()
    await expect(page.getByTestId('queue-track-called')).toBeVisible({ timeout: 15_000 })

    // Le tick du scheduler passe (exécuté ici comme le conteneur le fait,
    // idempotent : la seconde passe ne fait rien).
    expect(sql('select entries_swept from public.run_queue_grace_maintenance()')).toBe('1')
    expect(sql('select entries_swept from public.run_queue_grace_maintenance()')).toBe('0')

    // Trace : sortie AUTOMATIQUE, distincte d'un « Absent » cliqué.
    expect(sql(`select auto_marked_no_show_at is not null from public.queue_entries where id='${entryId}'`)).toBe('t')

    // Son écran le dit, sans le culpabiliser.
    // FR ou EN selon l'aléa de détection de langue du premier rendu — le
    // point testé est la FORMULATION (le délai, jamais le reproche), pas la
    // langue.
    const ended = page.getByTestId('queue-track-ended-removedAuto')
    await expect(ended).toBeVisible({ timeout: 15_000 })
    await expect(ended).toContainText(/délai|window/)
    await expect(ended).not.toContainText(/pas venu|did not show|no.show/i)

    // Retour au réglage par défaut.
    sql(
      `update public.location_service_settings set queue_grace_sweep_enabled=false where location_id='${locationId}'`,
    )
    await context.close()
    await proContext.close()
  })

  test.afterAll(() => {
    if (!locationId) return
    // Neutralisation « ZZ dead » — la fixture est REPRISE (pas recréée) à la
    // prochaine exécution : c'est ce qui borne le compte d'organisations QA
    // de cette suite à UNE, pour toujours.
    sql(`
      update public.queue_entries qe set status='cancelled'
        from public.organizations o
        where qe.organization_id=o.id and o.slug='${ORG_SLUG}'
          and qe.status in ('waiting','called','in_service');
      update public.location_service_settings s set queue_open=false, queue_grace_sweep_enabled=false
        from public.locations l join public.organizations o on o.id=l.organization_id
        where s.location_id=l.id and o.slug='${ORG_SLUG}';
      update public.locations l set is_active=false
        from public.organizations o
        where l.organization_id=o.id and o.slug='${ORG_SLUG}';
      update public.organizations set name='ZZ dead ${ORG_NAME}', marketplace_visible=false
        where slug='${ORG_SLUG}';
    `)
  })
})
