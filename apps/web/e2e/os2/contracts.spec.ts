import { expect, test } from '@playwright/test'
import {
  ensureFixture,
  envValue,
  kongBase,
  neutralize,
  ORG_ID,
  ORG_SLUG,
  PLAT_INTERN_EMAIL,
  PLAT_PASSWORD,
  PLAT_SALES_EMAIL,
  PLAT_SUPPORT_EMAIL,
  passwordToken,
  QA_BARBER_EMAIL,
  QA_MARK,
  QA_OWNER_EMAIL,
  QA_PASSWORD,
  refusal,
  rpc,
  seedCustomer,
  sql,
  type Fixture,
} from './helpers'

/**
 * OS-2 — les vérités SERVEUR, prouvées par HTTP réel à travers Kong.
 *
 * Ce fichier ne touche pas au DOM : il prouve que les gardes tiennent même
 * quand personne ne passe par l'interface. C'est la leçon de F1b §12.3 — un
 * test psql simule une session, seul le client HTTP réel montre les trous.
 *
 * Une seule exécution : les écritures ne doivent pas être rejouées par le
 * second projet de navigateur.
 */

test.describe.configure({ mode: 'serial' })

// Les écritures de ce fichier ne doivent pas être rejouées par le second
// projet de navigateur : `testInfo` n'est disponible que dans un hook.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'contrats serveur : une seule exécution')
})

let fixture: Fixture
let ownerToken = ''
let barberToken = ''

test.beforeAll(async () => {
  neutralize()
  fixture = ensureFixture()
  ownerToken = await passwordToken(QA_OWNER_EMAIL, QA_PASSWORD)
  barberToken = await passwordToken(QA_BARBER_EMAIL, QA_PASSWORD)
})

test.afterAll(() => {
  neutralize()
})

test('le prix est refusé à un barber — côté serveur, avec un motif', async () => {
  const created = await rpc(
    'create_service',
    { p_organization_id: ORG_ID, p_name: 'QA OS2 Coupe', p_duration_minutes: 30, p_price_cents: 2500 },
    ownerToken,
  )
  expect(created.status).toBe(200)
  const serviceId = (created.body as { id: string }).id

  // Le barber modifie nom et durée : accepté.
  const edited = await rpc(
    'update_service',
    { p_service_id: serviceId, p_name: 'QA OS2 Coupe longue', p_duration_minutes: 45 },
    barberToken,
  )
  expect(edited.status).toBe(200)
  expect((edited.body as { duration_minutes: number }).duration_minutes).toBe(45)

  // Le MÊME appel avec un prix : refusé, nommé, et rien n'a bougé.
  const withPrice = await rpc(
    'update_service',
    { p_service_id: serviceId, p_name: 'QA OS2 Coupe longue', p_duration_minutes: 45, p_price_cents: 9900 },
    barberToken,
  )
  expect(withPrice.status).toBe(403)
  expect(refusal(withPrice.body)).toBe('fadeup_service_refusal=price_forbidden_for_role')
  expect(sql(`select price_cents from public.services where id='${serviceId}'`)).toBe('2500')

  // Renvoyer le prix COURANT est refusé aussi : la garde porte sur la présence du champ.
  const samePrice = await rpc(
    'update_service',
    { p_service_id: serviceId, p_name: 'QA OS2 Coupe longue', p_duration_minutes: 45, p_price_cents: 2500 },
    barberToken,
  )
  expect(samePrice.status).toBe(403)

  // Et tarifer directement est refusé.
  const priced = await rpc('set_service_price', { p_service_id: serviceId, p_price_cents: 3000 }, barberToken)
  expect(priced.status).toBe(403)

  // Un service créé par un barber naît brouillon, donc invisible du public.
  const draft = await rpc(
    'create_service',
    { p_organization_id: ORG_ID, p_name: 'QA OS2 Barbe', p_duration_minutes: 20 },
    barberToken,
  )
  expect(draft.status).toBe(200)
  expect((draft.body as { price_pending: boolean; is_active: boolean }).price_pending).toBe(true)
  expect((draft.body as { is_active: boolean }).is_active).toBe(false)
  const publicServices = await rpc('list_public_services', { p_organization_slug: ORG_SLUG, p_location_id: fixture.locationId })
  const names = (publicServices.body as Array<{ name: string }>).map((s) => s.name)
  expect(names).not.toContain('QA OS2 Barbe')
})

test('un service avec historique s’archive, il ne se supprime pas', async () => {
  const created = await rpc(
    'create_service',
    { p_organization_id: ORG_ID, p_name: 'QA OS2 Historique', p_duration_minutes: 30, p_price_cents: 2000 },
    ownerToken,
  )
  const serviceId = (created.body as { id: string }).id

  // Un service NEUF se supprime.
  const throwaway = await rpc(
    'create_service',
    { p_organization_id: ORG_ID, p_name: 'QA OS2 Jetable', p_duration_minutes: 10, p_price_cents: 500 },
    ownerToken,
  )
  const throwawayId = (throwaway.body as { id: string }).id
  expect((await rpc('delete_service', { p_service_id: throwawayId }, ownerToken)).status).toBe(204)

  // Dès qu'un rendez-vous s'y rattache, la suppression est refusée.
  const barberId = fixture.barbers[0]!.id
  sql(`insert into public.appointments
         (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, status, notes)
       values ('${ORG_ID}','${fixture.locationId}','${barberId}','${serviceId}','QA OS2 Client',
               now() + interval '2 days', now() + interval '2 days' + interval '30 minutes', 'confirmed', '${QA_MARK}')`)

  const refused = await rpc('delete_service', { p_service_id: serviceId }, ownerToken)
  expect(refused.status).toBe(409)
  expect(refusal(refused.body)).toContain('fadeup_service_refusal=has_history')
  expect(sql(`select count(*) from public.services where id='${serviceId}'`)).toBe('1')

  // L'archivage, lui, passe — et le rendez-vous garde sa prestation.
  const archived = await rpc('archive_service', { p_service_id: serviceId }, ownerToken)
  expect(archived.status).toBe(200)
  expect((archived.body as { archived_at: string | null }).archived_at).not.toBeNull()
  expect(sql(`select count(*) from public.appointments where service_id='${serviceId}'`)).toBe('1')

  const restored = await rpc('restore_service', { p_service_id: serviceId }, ownerToken)
  expect((restored.body as { archived_at: string | null }).archived_at).toBeNull()
})

test('les notes privées : l’équipe écrit, un autre salon est refusé, chaque rôle interne est tracé', async () => {
  const customerId = seedCustomer('Notes', 0)

  const written = await rpc('add_customer_note', { p_customer_id: customerId, p_body: 'Préfère le dégradé court.' }, barberToken)
  expect(written.status).toBe(200)

  const read = await rpc('list_customer_notes', { p_customer_id: customerId }, ownerToken)
  expect(read.status).toBe(200)
  expect((read.body as unknown[]).length).toBe(1)

  // Un client d'un AUTRE salon : refusé, sans dire s'il existe.
  const foreignCustomer = sql(
    `select id from public.customers where organization_id <> '${ORG_ID}' order by created_at limit 1`,
  )
  expect(foreignCustomer).not.toBe('')
  const foreign = await rpc('list_customer_notes', { p_customer_id: foreignCustomer }, barberToken)
  expect(foreign.status).toBe(403)
  expect(refusal(foreign.body)).toBe('fadeup_customer_notes_refusal=not_authorized')

  // Commercial et stagiaire : refusés. Ils n'ont pas le CRM client.
  for (const email of [PLAT_SALES_EMAIL, PLAT_INTERN_EMAIL]) {
    const token = await passwordToken(email, PLAT_PASSWORD)
    const denied = await rpc('list_customer_notes', { p_customer_id: customerId }, token)
    expect(denied.status, `${email} doit être refusé`).toBe(403)
  }

  // Le support lit — et la consultation est tracée.
  const before = Number(
    sql(`select count(*) from public.platform_audit_log where action='customer_notes_read' and target_id='${customerId}'`),
  )
  const supportToken = await passwordToken(PLAT_SUPPORT_EMAIL, PLAT_PASSWORD)
  const supportRead = await rpc('list_customer_notes', { p_customer_id: customerId }, supportToken)
  expect(supportRead.status).toBe(200)
  expect((supportRead.body as unknown[]).length).toBe(1)
  const after = Number(
    sql(`select count(*) from public.platform_audit_log where action='customer_notes_read' and target_id='${customerId}'`),
  )
  expect(after).toBe(before + 1)
  expect(
    sql(`select metadata->>'note_count' from public.platform_audit_log
         where action='customer_notes_read' and target_id='${customerId}' order by created_at desc limit 1`),
  ).toBe('1')

  // Une lecture par l'ÉQUIPE ne trace rien : ce sont ses notes.
  await rpc('list_customer_notes', { p_customer_id: customerId }, ownerToken)
  const afterTeam = Number(
    sql(`select count(*) from public.platform_audit_log where action='customer_notes_read' and target_id='${customerId}'`),
  )
  expect(afterTeam).toBe(after)

  // Un rôle interne n'écrit pas.
  expect((await rpc('add_customer_note', { p_customer_id: customerId, p_body: 'support' }, supportToken)).status).toBe(403)

  // Aucun accès de TABLE : PostgREST ne sert pas de lecture en masse à côté
  // de la RPC tracée, même au propriétaire du salon.
  const bulk = await fetch(`${kongBase()}/rest/v1/customer_notes?select=body`, {
    headers: { apikey: envValue('ANON_KEY'), Authorization: `Bearer ${ownerToken}` },
  })
  expect(bulk.status).toBeGreaterThanOrEqual(400)
})

test('l’invitation : jeton serveur, sept jours, usage unique, le renvoi révoque', async () => {
  const email = `${QA_MARK}-invite@fadeup.test`
  sql(`delete from public.invitations where organization_id='${ORG_ID}' and email='${email}'`)

  const first = await rpc(
    'invite_team_member',
    { p_organization_id: ORG_ID, p_email: email.toUpperCase(), p_role: 'barber' },
    ownerToken,
  )
  expect(first.status).toBe(200)
  const firstRow = (first.body as Array<{ id: string; email: string; expires_at: string; replaced_previous: boolean }>)[0]!
  expect(firstRow.email).toBe(email)
  expect(firstRow.replaced_previous).toBe(false)

  // Le jeton est fabriqué côté serveur (32 octets hexadécimaux) et n'est jamais rendu.
  expect(sql(`select length(token) from public.invitations where id='${firstRow.id}'`)).toBe('64')
  expect(JSON.stringify(first.body)).not.toContain('token')

  // L'e-mail part par email_outbox, avec le gabarit existant. Pas de second système.
  expect(
    sql(`select count(*) from public.email_outbox where template='team_invitation' and to_email='${email}'`),
  ).toBe('1')

  // Sept jours.
  const days = Number(sql(`select round(extract(epoch from (expires_at - now()))/86400) from public.invitations where id='${firstRow.id}'`))
  expect(days).toBe(7)

  // Le renvoi révoque le précédent : le lien fuité devient inoffensif.
  const second = await rpc('invite_team_member', { p_organization_id: ORG_ID, p_email: email, p_role: 'barber' }, ownerToken)
  const secondRow = (second.body as Array<{ id: string; replaced_previous: boolean }>)[0]!
  expect(secondRow.replaced_previous).toBe(true)
  expect(sql(`select revoked_at is not null from public.invitations where id='${firstRow.id}'`)).toBe('t')
  const oldToken = sql(`select token from public.invitations where id='${firstRow.id}'`)
  const oldLookup = await rpc('get_invitation_by_token', { p_token: oldToken })
  expect((oldLookup.body as Array<{ is_revoked: boolean }>)[0]!.is_revoked).toBe(true)

  // Expirée : la consultation publique le dit, et l'acceptation refuse.
  sql(`update public.invitations set expires_at = now() - interval '1 hour' where id='${secondRow.id}'`)
  const newToken = sql(`select token from public.invitations where id='${secondRow.id}'`)
  const lookup = await rpc('get_invitation_by_token', { p_token: newToken })
  expect((lookup.body as Array<{ is_expired: boolean }>)[0]!.is_expired).toBe(true)
  const accepted = await rpc('accept_invitation', { p_token: newToken }, barberToken)
  expect(accepted.status).toBeGreaterThanOrEqual(400)

  // Un barber n'invite pas, et ne lit pas l'équipe.
  expect((await rpc('invite_team_member', { p_organization_id: ORG_ID, p_email: email, p_role: 'barber' }, barberToken)).status).toBe(403)
  expect((await rpc('list_team_members', { p_organization_id: ORG_ID }, barberToken)).status).toBe(403)
})

test('retirer un barber ne supprime pas son profil public', async () => {
  // Le REMPLAÇANT : un fauteuil jetable, sans compte.
  const standInStaff = sql(`with created as (
      insert into public.staff_profiles (organization_id, user_id, location_id, display_name, is_public, is_active)
      values ('${ORG_ID}', null, '${fixture.locationId}', 'QA OS2 Remplacant', true, true) returning id
    ) select id from created`)
  const standIn = sql(`with created as (
      insert into public.barbers (organization_id, staff_profile_id, is_bookable, queue_enabled)
      values ('${ORG_ID}', '${standInStaff}', true, true) returning id
    ) select id from created`)

  // LE PARTANT : le compte barber QA, qui porte une VRAIE identité
  // professionnelle (professionals) — c'est elle qui doit survivre.
  const leavingUser = sql(`select user_id from public.staff_profiles sp join auth.users u on u.id = sp.user_id
    where sp.organization_id='${ORG_ID}' and u.email='${QA_BARBER_EMAIL}'`)
  expect(leavingUser).not.toBe('')
  const membershipId = sql(`select id from public.memberships where organization_id='${ORG_ID}' and user_id='${leavingUser}'`)
  const leavingBarber = sql(`select b.id from public.barbers b join public.staff_profiles sp on sp.id=b.staff_profile_id
    where sp.organization_id='${ORG_ID}' and sp.user_id='${leavingUser}'`)
  const professionalId = sql(`select professional_id from public.barbers where id='${leavingBarber}'`)
  expect(professionalId).not.toBe('')

  const serviceId = fixture.services[0]!.id
  sql(`insert into public.appointments
         (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, status, notes)
       values ('${ORG_ID}','${fixture.locationId}','${leavingBarber}','${serviceId}','QA OS2 Client Repris',
               now() + interval '4 days', now() + interval '4 days' + interval '30 minutes', 'confirmed', '${QA_MARK}')`)
  sql(`insert into public.queue_entries (organization_id, location_id, barber_id, customer_name, status)
       values ('${ORG_ID}','${fixture.locationId}','${leavingBarber}','QA OS2 File Un','waiting')`)

  try {
    // Un membership inconnu reçoit le même refus qu'un membership d'autrui :
    // pas d'oracle d'existence.
    const unknown = await rpc('remove_team_member', { p_membership_id: crypto.randomUUID() }, ownerToken)
    expect(unknown.status).toBe(403)

    // Sans repreneur, la RPC refuse en donnant le nombre.
    const refused = await rpc('remove_team_member', { p_membership_id: membershipId }, ownerToken)
    expect(refused.status).toBe(400)
    expect(refusal(refused.body)).toContain('fadeup_team_refusal=has_future_appointments')
    expect(sql(`select count(*) from public.memberships where id='${membershipId}'`)).toBe('1')

    // Le compte exact vient de la base, pas d'une constante : les tests
    // précédents du fichier ont pu poser d'autres rendez-vous sur ce siège.
    const futureBefore = Number(
      sql(`select count(*) from public.appointments
           where barber_id='${leavingBarber}' and starts_at > now() and status in ('pending','confirmed')`),
    )
    expect(futureBefore).toBeGreaterThanOrEqual(1)

    const removed = await rpc(
      'remove_team_member',
      { p_membership_id: membershipId, p_reassign_to_barber_id: standIn },
      ownerToken,
    )
    expect(removed.status).toBe(200)
    const summary = (removed.body as Array<{ reassigned_appointments: number; moved_queue_entries: number }>)[0]!
    expect(summary.reassigned_appointments).toBe(futureBefore)
    expect(summary.moved_queue_entries).toBe(1)

    // LA loi produit : l'identité publique survit au départ.
    expect(sql(`select count(*) from public.professionals where id='${professionalId}'`)).toBe('1')
    // Le lien d'emploi reste en base (l'historique s'y accroche), fermé.
    expect(sql(`select count(*) from public.barbers where id='${leavingBarber}'`)).toBe('1')
    expect(sql(`select is_bookable from public.barbers where id='${leavingBarber}'`)).toBe('f')
    expect(sql(`select is_active from public.staff_profiles where id=(select staff_profile_id from public.barbers where id='${leavingBarber}')`)).toBe('f')
    // L'accès, lui, est retiré.
    expect(sql(`select count(*) from public.memberships where id='${membershipId}'`)).toBe('0')
    // Les rendez-vous et la file ont suivi le repreneur.
    expect(Number(sql(`select count(*) from public.appointments where barber_id='${standIn}'`))).toBe(futureBefore)
    expect(sql(`select count(*) from public.queue_entries where barber_id='${standIn}' and customer_name='QA OS2 File Un'`)).toBe('1')
    expect(sql(`select count(*) from public.queue_entry_moves where to_barber_id='${standIn}'`)).not.toBe('0')
  } finally {
    // Remise en état : le compte barber QA doit repartir membre pour les
    // campagnes suivantes (organisation partagée, QA_DATA règle 4).
    sql(`insert into public.memberships (organization_id, user_id, role) values ('${ORG_ID}','${leavingUser}','barber')
         on conflict (organization_id, user_id) do update set role='barber'`)
    sql(`update public.staff_profiles set is_active=true, is_public=true
         where organization_id='${ORG_ID}' and user_id='${leavingUser}'`)
    sql(`update public.barbers set is_bookable=true, queue_enabled=true where id='${leavingBarber}'`)
    sql(`delete from public.queue_entry_moves where to_barber_id='${standIn}' or from_barber_id='${standIn}'`)
    sql(`delete from public.queue_entries where organization_id='${ORG_ID}' and customer_name like 'QA OS2%'`)
    sql(`delete from public.appointments where organization_id='${ORG_ID}' and notes='${QA_MARK}' and barber_id='${standIn}'`)
    sql(`delete from public.barbers where id='${standIn}'`)
    sql(`delete from public.staff_profiles where id='${standInStaff}'`)
  }
})

test('les clients non revenus sont identifiables, et un salon ne voit que les siens', async () => {
  // Un régulier : 4 prestations tous les 28 jours, la dernière il y a 100 jours.
  const lapsed = seedCustomer('Regulier', 4, 100, 28)
  // Un client d'une seule visite : ni cycle, ni retard.
  const once = seedCustomer('Unique', 1, 5, 0)

  const all = await rpc('list_organization_customers', { p_organization_id: ORG_ID }, ownerToken)
  expect(all.status).toBe(200)
  const rows = all.body as Array<{
    customer_id: string
    completed_count: number
    average_interval_days: number | null
    is_lapsed: boolean
  }>
  const lapsedRow = rows.find((r) => r.customer_id === lapsed)!
  expect(lapsedRow.completed_count).toBe(4)
  expect(lapsedRow.average_interval_days).toBeGreaterThanOrEqual(26)
  expect(lapsedRow.average_interval_days).toBeLessThanOrEqual(30)
  expect(lapsedRow.is_lapsed).toBe(true)

  const onceRow = rows.find((r) => r.customer_id === once)!
  expect(onceRow.completed_count).toBe(1)
  expect(onceRow.average_interval_days).toBeNull()
  expect(onceRow.is_lapsed).toBe(false)

  const segment = await rpc('list_organization_customers', { p_organization_id: ORG_ID, p_segment: 'lapsed' }, ownerToken)
  const lapsedIds = (segment.body as Array<{ customer_id: string }>).map((r) => r.customer_id)
  expect(lapsedIds).toContain(lapsed)
  expect(lapsedIds).not.toContain(once)

  // Minimisation : une autre organisation est refusée, son client aussi.
  const otherOrg = sql(`select id from public.organizations where id <> '${ORG_ID}' order by created_at limit 1`)
  expect((await rpc('list_organization_customers', { p_organization_id: otherOrg }, ownerToken)).status).toBe(403)
  const foreignCustomer = sql(`select id from public.customers where organization_id <> '${ORG_ID}' limit 1`)
  expect((await rpc('get_organization_customer', { p_customer_id: foreignCustomer }, ownerToken)).status).toBe(403)
})

test('le réglage de file par barber se répercute côté client', async () => {
  const barberId = fixture.barbers[0]!.id
  const visible = async () => {
    const { body } = await rpc('list_public_queues', { p_organization_slug: ORG_SLUG, p_location_id: fixture.locationId })
    return (body as Array<{ barber_id: string }>).some((q) => q.barber_id === barberId)
  }
  expect(await visible()).toBe(true)

  expect((await rpc('set_barber_queue_enabled', { p_barber_id: barberId, p_enabled: false }, ownerToken)).status).toBe(200)
  expect(await visible()).toBe(false)

  expect((await rpc('set_barber_queue_enabled', { p_barber_id: barberId, p_enabled: true }, ownerToken)).status).toBe(200)
  expect(await visible()).toBe(true)
})

test('les seuils de file sont lus et écrits en base, jamais codés en dur', async () => {
  const read = async () =>
    sql(`select queue_capacity_per_barber || '/' || queue_call_grace_minutes || '/' || queue_geofence_meters
         from public.location_service_settings where location_id='${fixture.locationId}'`)
  expect(await read()).toBe('20/5/150')

  const saved = await rpc(
    'set_location_queue_thresholds',
    { p_location_id: fixture.locationId, p_capacity_per_barber: 12, p_call_grace_minutes: 9 },
    ownerToken,
  )
  expect(saved.status).toBe(200)
  // Le rayon n'a pas été envoyé : il ne bouge pas.
  expect(await read()).toBe('12/9/150')

  const outOfRange = await rpc(
    'set_location_queue_thresholds',
    { p_location_id: fixture.locationId, p_capacity_per_barber: 500 },
    ownerToken,
  )
  expect(outOfRange.status).toBe(400)
  expect(refusal(outOfRange.body)).toBe('fadeup_queue_refusal=capacity_out_of_range')

  const byBarber = await rpc(
    'set_location_queue_thresholds',
    { p_location_id: fixture.locationId, p_capacity_per_barber: 5 },
    barberToken,
  )
  expect(byBarber.status).toBe(403)
  expect(refusal(byBarber.body)).toBe('fadeup_queue_refusal=not_authorized')

  // Le seuil écrit est bien celui que la file applique.
  expect(
    sql(`select private.queue_capacity('${fixture.locationId}', '${fixture.barbers[0]!.id}')`),
  ).toBe('12')
})
