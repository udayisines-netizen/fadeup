import { expect, test } from '@playwright/test'
import {
  ensureFixture,
  neutralize,
  ORG_ID,
  QA_BARBER_EMAIL,
  QA_EMAIL_PREFIX,
  QA_OWNER_EMAIL,
  QA_PASSWORD,
  passwordToken,
  refusal,
  restGet,
  rpc,
  sql,
  type Fixture,
} from './helpers'

/**
 * OS-3 — LES VÉRITÉS SERVEUR, par HTTP RÉEL à travers Kong, sans DOM.
 *
 * Un test psql en `postgres` ne voit jamais un GRANT manquant (leçon F1b,
 * re-signée par OS-2 §12.8) : ces assertions passent par PostgREST avec un
 * VRAI jeton GoTrue, donc par le rôle `authenticated` et la RLS.
 *
 * `mode: serial` et un seul passage : ces tests ÉCRIVENT (des campagnes, des
 * lignes email_outbox), et le second navigateur ne doit pas les rejouer.
 */
test.describe.configure({ mode: 'serial' })

let fixture: Fixture
let ownerToken = ''
let barberToken = ''

test.beforeAll(async () => {
  fixture = ensureFixture()
  ownerToken = await passwordToken(QA_OWNER_EMAIL, QA_PASSWORD)
  barberToken = await passwordToken(QA_BARBER_EMAIL, QA_PASSWORD)
})

test.afterAll(() => {
  neutralize()
})

test.describe('OS-3 contrats serveur', () => {
  test('le plafond mensuel vit EN BASE, aux valeurs du fondateur', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    const rows = sql(`select plan_key || '=' || coalesce(monthly_campaign_allowance::text,'illimite')
                      from public.commercial_plans order by plan_key`).split('\n')
    expect(rows).toContain('free=3')
    expect(rows).toContain('solo=10')
    expect(rows).toContain('salon_essential=20')
    expect(rows).toContain('salon_pro=50')
    expect(rows).toContain('salon_business=100')
    expect(rows).toContain('multi_growth=illimite')
    expect(rows).toContain('multi_pro=illimite')
    expect(rows).toContain('multi_scale=illimite')
  })

  test('un barber sans droit reçoit un revenu NULL — jamais zéro — et le réglage d’OS-1 l’ouvre', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    const masked = await rpc('get_organization_insights', { p_organization_id: ORG_ID }, barberToken)
    expect(masked.status).toBe(200)
    const maskedRow = (masked.body as Array<Record<string, unknown>>)[0]!
    expect(maskedRow.revenue_visible).toBe(false)
    expect(maskedRow.revenue_cents).toBeNull()
    expect(maskedRow.average_ticket_cents).toBeNull()
    expect(maskedRow.no_show_cost_cents).toBeNull()
    expect(maskedRow.previous_revenue_cents).toBeNull()
    // Les chiffres NON monétaires restent lisibles : masquer le revenu ne
    // ferme pas l'écran à un barber.
    expect(typeof maskedRow.services_delivered).toBe('number')

    // Le patron l'ouvre — et SEUL le patron peut le faire.
    const byBarber = await rpc(
      'set_membership_revenue_visibility',
      { p_membership_id: fixture.barberMembershipId, p_visible: true },
      barberToken,
    )
    expect(byBarber.status).toBe(403)

    const byOwner = await rpc(
      'set_membership_revenue_visibility',
      { p_membership_id: fixture.barberMembershipId, p_visible: true },
      ownerToken,
    )
    expect(byOwner.status).toBe(200)

    const opened = await rpc('get_organization_insights', { p_organization_id: ORG_ID }, barberToken)
    const openedRow = (opened.body as Array<Record<string, unknown>>)[0]!
    expect(openedRow.revenue_visible).toBe(true)
    expect(openedRow.revenue_cents).not.toBeNull()

    sql(`update public.memberships set can_view_revenue=false where id='${fixture.barberMembershipId}'`)
  })

  test('les insights refusent un étranger et une organisation nulle du MÊME refus', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    const anon = await rpc('get_organization_insights', { p_organization_id: ORG_ID })
    expect(anon.status).toBe(401)
    const nul = await rpc('get_organization_insights', { p_organization_id: null }, barberToken)
    expect(nul.status).toBe(403)
    expect(refusal(nul.body)).toBe('fadeup_insights_refusal=not_authorized')
    const other = await rpc('get_organization_insights', { p_organization_id: fixture.otherOrgId }, ownerToken)
    // L'organisation existe, mais pas pour cet appelant : le même refus.
    expect([401, 403]).toContain(other.status)
  })

  test('aucune tendance sans période de comparaison réelle', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    const short = await rpc(
      'get_organization_insights',
      {
        p_organization_id: ORG_ID,
        p_from: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        p_to: new Date().toISOString(),
      },
      ownerToken,
    )
    expect(((short.body as Array<Record<string, unknown>>)[0] as { comparison_available: boolean }).comparison_available).toBe(
      false,
    )
  })

  test('un pro n’écrit QU’À ses clients — la RPC directe le refuse', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    // 1. Viser l'autre organisation : refus d'autorisation.
    const foreign = await rpc(
      'send_notification_campaign',
      {
        p_organization_id: fixture.otherOrgId,
        p_kind: 'promotion',
        p_headline: 'Offre du mois',
        p_params: { offer: '-10%', valid_until: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) },
      },
      ownerToken,
    )
    expect(foreign.status).toBe(403)
    expect(refusal(foreign.body)).toBe('fadeup_campaign_refusal=not_authorized')

    // 2. Un barber et un anonyme sont refusés sur SA PROPRE organisation.
    const byBarber = await rpc(
      'send_notification_campaign',
      {
        p_organization_id: ORG_ID,
        p_kind: 'promotion',
        p_headline: 'Offre du mois',
        p_params: { offer: '-10%', valid_until: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10) },
      },
      barberToken,
    )
    expect(byBarber.status).toBe(403)
    const byAnon = await rpc('send_notification_campaign', {
      p_organization_id: ORG_ID,
      p_kind: 'promotion',
      p_headline: 'Offre du mois',
      p_params: { offer: '-10%' },
    })
    expect(byAnon.status).toBe(401)

    // 3. Et l'envoi LÉGITIME n'atteint jamais le client de l'autre salon,
    //    ni le désabonné.
    const sent = await rpc(
      'send_notification_campaign',
      {
        p_organization_id: ORG_ID,
        p_kind: 'promotion',
        p_headline: 'Dix pour cent sur la coupe',
        p_params: { offer: '-10% sur la coupe', valid_until: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10) },
      },
      ownerToken,
    )
    expect(sent.status).toBe(200)
    const campaign = (sent.body as Array<{ campaign_id: string; recipient_count: number }>)[0]!
    expect(campaign.recipient_count).toBeGreaterThan(0)

    const reached = sql(`select coalesce(string_agg(to_email, ',' order by to_email), '')
                         from public.notification_campaign_recipients where campaign_id='${campaign.campaign_id}'`)
    expect(reached).toContain(`${QA_EMAIL_PREFIX}lapsed@fadeup.test`)
    expect(reached).not.toContain(`${QA_EMAIL_PREFIX}ailleurs@fadeup.test`)
    expect(reached).not.toContain(`${QA_EMAIL_PREFIX}dnc@fadeup.test`)

    // 4. AUCUN SYSTÈME D'ENVOI PARALLÈLE : chaque destinataire a sa ligne
    //    email_outbox, du bon flux et du bon gabarit.
    const outbox = sql(`select count(*) from public.email_outbox o
      join public.notification_campaign_recipients r on r.outbox_id=o.id
      where r.campaign_id='${campaign.campaign_id}'
        and o.stream='marketing' and o.template='campaign_promotion'
        and o.dedupe_key like 'campaign:${campaign.campaign_id}:%'`)
    expect(Number(outbox)).toBe(campaign.recipient_count)
  })

  test('un client en do_not_contact n’est JAMAIS destinataire, et le désabonnement est global', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    // La même adresse dans DEUX organisations.
    sql(`update public.customers set email='${QA_EMAIL_PREFIX}shared@fadeup.test', do_not_contact=false
         where id in ('${fixture.regularCustomerId}','${fixture.otherCustomerId}')`)
    const token = sql(`select marketing_unsubscribe_token from public.customers where id='${fixture.regularCustomerId}'`)
    expect(token).toMatch(/^[0-9a-f]{32}$/)

    const done = await rpc('unsubscribe_customer_marketing', { p_token: token })
    expect(done.status).toBe(200)
    expect((done.body as Array<{ unsubscribed: boolean }>)[0]?.unsubscribed).toBe(true)

    const flags = sql(`select count(*) from public.customers
      where email='${QA_EMAIL_PREFIX}shared@fadeup.test' and do_not_contact`)
    expect(Number(flags)).toBe(2)

    // Un jeton inventé reçoit la MÊME réponse : aucun oracle d'existence.
    const unknown = await rpc('unsubscribe_customer_marketing', { p_token: '0'.repeat(31) + 'f' })
    expect(unknown.status).toBe(200)
    expect((unknown.body as Array<{ unsubscribed: boolean }>)[0]?.unsubscribed).toBe(true)

    // L'aperçu compte l'exclusion plutôt que de la taire.
    const preview = await rpc(
      'preview_notification_campaign',
      { p_organization_id: ORG_ID, p_kind: 'promotion', p_params: {} },
      ownerToken,
    )
    const row = (preview.body as Array<Record<string, number>>)[0]!
    expect(row.do_not_contact_count).toBeGreaterThanOrEqual(2)
  })

  test('les heures calmes PROGRAMMENT l’envoi, elles ne l’annulent pas', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    // La fonction, sur des instants déterministes (pas l'heure de la
    // campagne, qui ferait un test vert le jour et rouge le soir).
    const at21 = sql(`select private.marketing_next_attempt_at('Europe/Paris', timestamptz '2026-06-15 21:30:00+02')
                      at time zone 'Europe/Paris'`)
    expect(at21).toContain('2026-06-16 08:00:00')
    const at4 = sql(`select private.marketing_next_attempt_at('Europe/Paris', timestamptz '2026-06-15 04:30:00+02')
                     at time zone 'Europe/Paris'`)
    expect(at4).toContain('2026-06-15 08:00:00')
    const at14 = sql(`select private.marketing_next_attempt_at('Europe/Paris', timestamptz '2026-06-15 14:00:00+02')
                      = timestamptz '2026-06-15 14:00:00+02'`)
    expect(at14).toBe('t')

    // Et chaque ligne d'envoi porte l'instant programmé de sa campagne.
    const mismatched = sql(`select count(*) from public.email_outbox o
      join public.notification_campaign_recipients r on r.outbox_id=o.id
      join public.notification_campaigns c on c.id=r.campaign_id
      where c.organization_id='${ORG_ID}' and o.next_attempt_at <> c.scheduled_at`)
    expect(Number(mismatched)).toBe(0)
  })

  test('le compteur s’incrémente, et AU PLAFOND l’envoi est refusé côté serveur', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    // On remet une audience joignable (le test précédent a désabonné).
    sql(`update public.customers set do_not_contact=false where organization_id='${ORG_ID}'`)

    const before = await rpc('get_campaign_quota', { p_organization_id: ORG_ID }, ownerToken)
    const beforeRow = (before.body as Array<{ used: number; monthly_allowance: number | null }>)[0]!

    const sent = await rpc(
      'send_notification_campaign',
      { p_organization_id: ORG_ID, p_kind: 'lapsed_customers', p_headline: 'Ça fait un moment', p_params: { threshold_days: 60 } },
      ownerToken,
    )
    expect(sent.status).toBe(200)

    const after = await rpc('get_campaign_quota', { p_organization_id: ORG_ID }, ownerToken)
    const afterRow = (after.body as Array<{ used: number }>)[0]!
    expect(afterRow.used).toBe(beforeRow.used + 1)
    expect(beforeRow.monthly_allowance).toBe(50)

    /* On amène l'organisation au plafond en ABAISSANT le plafond du plan en
       BASE, pas en changeant son plan : basculer l'organisation sur `free`
       est refusé par la garde de capacité de R2 (elle rassemble trois
       professionnels, et FadeUp ne supprime personne pour satisfaire un
       changement de plan — refus vérifié en passant). Abaisser la colonne
       `commercial_plans.monthly_campaign_allowance` est d'ailleurs la
       meilleure preuve que le plafond vit EN BASE : aucun code ne le porte.
       La valeur d'origine est restaurée à la fin du test ET par
       `neutralize`. */
    const originalAllowance = sql(
      `select monthly_campaign_allowance from public.commercial_plans where plan_key='salon_pro'`,
    )
    sql(`update public.commercial_plans set monthly_campaign_allowance=${afterRow.used} where plan_key='salon_pro'`)
    const capped = await rpc('get_campaign_quota', { p_organization_id: ORG_ID }, ownerToken)
    const cappedRow = (capped.body as Array<{
      monthly_allowance: number
      remaining: number
      next_plan_key: string | null
      next_plan_allowance: number | null
    }>)[0]!
    expect(cappedRow.monthly_allowance).toBe(afterRow.used)
    // Le reste ne devient jamais négatif, et un plan supérieur est proposé.
    expect(cappedRow.remaining).toBe(0)
    expect(cappedRow.next_plan_key).not.toBeNull()
    expect(cappedRow.next_plan_allowance).toBeGreaterThan(afterRow.used)

    const campaignsBefore = sql(`select count(*) from public.notification_campaigns where organization_id='${ORG_ID}'`)
    const refused = await rpc(
      'send_notification_campaign',
      { p_organization_id: ORG_ID, p_kind: 'loyalty_reminder', p_headline: 'Encore une' },
      ownerToken,
    )
    expect(refused.status).toBe(400)
    expect(refusal(refused.body)).toBe('fadeup_campaign_refusal=allowance_reached')
    const campaignsAfter = sql(`select count(*) from public.notification_campaigns where organization_id='${ORG_ID}'`)
    expect(campaignsAfter).toBe(campaignsBefore)

    sql(`update public.commercial_plans set monthly_campaign_allowance=${originalAllowance} where plan_key='salon_pro'`)
    expect(sql(`select monthly_campaign_allowance from public.commercial_plans where plan_key='salon_pro'`)).toBe('50')
  })

  test('pas de message libre : cinq refus nommés sur l’accroche', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    const until = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    const cases: Array<[string, string]> = [
      ['   ', 'fadeup_campaign_refusal=missing_headline'],
      ['a'.repeat(200), 'fadeup_campaign_refusal=too_long_headline'],
      ['deux\nlignes', 'fadeup_campaign_refusal=multiline_headline'],
      ['venez sur https://ailleurs.example', 'fadeup_campaign_refusal=link_in_headline'],
      ['bonjour {{unsubscribe_url}}', 'fadeup_campaign_refusal=template_token_in_headline'],
    ]
    for (const [headline, expected] of cases) {
      const response = await rpc(
        'send_notification_campaign',
        { p_organization_id: ORG_ID, p_kind: 'promotion', p_headline: headline, p_params: { offer: '-10%', valid_until: until } },
        ownerToken,
      )
      expect(response.status, headline.slice(0, 20)).toBe(400)
      expect(refusal(response.body), headline.slice(0, 20)).toBe(expected)
    }
  })

  test('le modèle « créneaux libres demain » n’annonce rien qui n’existe pas', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    // Sans prestation choisie : refus nommé.
    const noService = await rpc(
      'send_notification_campaign',
      { p_organization_id: ORG_ID, p_kind: 'free_slots_tomorrow', p_headline: 'Demain' },
      ownerToken,
    )
    expect(refusal(noService.body)).toBe('fadeup_campaign_refusal=missing_service')

    // Une prestation d'un AUTRE salon : refus nommé.
    const foreignService = sql(`select id from public.services where organization_id='${fixture.otherOrgId}' limit 1`)
    if (foreignService) {
      const wrong = await rpc(
        'send_notification_campaign',
        { p_organization_id: ORG_ID, p_kind: 'free_slots_tomorrow', p_headline: 'Demain', p_params: { service_id: foreignService } },
        ownerToken,
      )
      expect(refusal(wrong.body)).toBe('fadeup_campaign_refusal=unknown_service')
    }

    // Avec une prestation réelle : le nombre annoncé est strictement positif.
    const ok = await rpc(
      'send_notification_campaign',
      {
        p_organization_id: ORG_ID,
        p_kind: 'free_slots_tomorrow',
        p_headline: 'Il reste de la place demain',
        p_params: { service_id: fixture.serviceId },
      },
      ownerToken,
    )
    expect(ok.status).toBe(200)
    const campaign = (ok.body as Array<{ campaign_id: string }>)[0]!
    const slots = sql(`select min((o.payload->>'slot_count')::integer) from public.email_outbox o
      join public.notification_campaign_recipients r on r.outbox_id=o.id
      where r.campaign_id='${campaign.campaign_id}'`)
    expect(Number(slots)).toBeGreaterThan(0)

    // Lieu fermé demain : refus nommé plutôt qu'un e-mail mensonger.
    // « Demain » se calcule dans le fuseau RÉEL du lieu — celui que la RPC
    // utilise — et non dans un fuseau imposé par le test.
    const dow = sql(`select extract(dow from ((now() at time zone l.timezone)::date + 1))::integer
                     from public.locations l where l.id='${fixture.locationId}'`)
    sql(`update public.location_hours set is_closed=true where location_id='${fixture.locationId}' and day_of_week=${dow}`)
    const closed = await rpc(
      'send_notification_campaign',
      {
        p_organization_id: ORG_ID,
        p_kind: 'free_slots_tomorrow',
        p_headline: 'Demain',
        p_params: { service_id: fixture.serviceId },
      },
      ownerToken,
    )
    expect(refusal(closed.body)).toBe('fadeup_campaign_refusal=no_free_slot')
    sql(`update public.location_hours set is_closed=false where location_id='${fixture.locationId}'`)
  })

  test('le rappel de fidélité n’invente AUCUNE cadence', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    // Aucun client de la fixture n'a de cadence déclarée (pas de compte
    // FadeUp) : l'audience du rappel est donc vide, et l'envoi est refusé
    // plutôt que de plaquer une moyenne de salon sur tout le monde.
    const response = await rpc(
      'send_notification_campaign',
      { p_organization_id: ORG_ID, p_kind: 'loyalty_reminder', p_headline: 'C’est bientôt l’heure' },
      ownerToken,
    )
    expect(response.status).toBe(400)
    expect(refusal(response.body)).toBe('fadeup_campaign_refusal=no_recipient')
    // Et le plafond n'a pas été consommé.
    const ghost = sql(`select count(*) from public.notification_campaigns
      where organization_id='${ORG_ID}' and kind='loyalty_reminder'`)
    expect(ghost).toBe('0')
  })

  test('le billing est au PROPRIÉTAIRE seul — un manager ne lit rien et n’écrit rien', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    // Le compte barber de la fixture sert de non-propriétaire : on le
    // promeut MANAGER le temps du test, puis on le remet.
    sql(`update public.memberships set role='manager' where id='${fixture.barberMembershipId}'`)
    const managerToken = await passwordToken(QA_BARBER_EMAIL, QA_PASSWORD)

    // Lecture : zéro ligne, par la RLS — pas par un filtre d'écran.
    const billing = await restGet(`organization_billing?organization_id=eq.${ORG_ID}&select=plan_key`, managerToken)
    expect(billing.status).toBe(200)
    expect(billing.body).toEqual([])
    const trials = await restGet(`organization_trials?organization_id=eq.${ORG_ID}&select=plan_key`, managerToken)
    expect(trials.body).toEqual([])

    // Écriture : la garde propriétaire de B3 refuse.
    const quote = await rpc('request_billing_quote', { p_organization_id: ORG_ID, p_establishments: 20 }, managerToken)
    expect(quote.status).toBe(403)
    const trial = await rpc('start_organization_trial', { p_organization_id: ORG_ID }, managerToken)
    expect(trial.status).toBe(403)

    // Le propriétaire, lui, lit sa ligne.
    const ownerRead = await restGet(
      `organization_trials?organization_id=eq.${ORG_ID}&select=plan_key,status`,
      ownerToken,
    )
    expect(Array.isArray(ownerRead.body)).toBe(true)

    sql(`update public.memberships set role='barber' where id='${fixture.barberMembershipId}'`)
  })

  test('la grille tarifaire vient de la BASE, annuel compris', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    const catalog = await rpc('get_billing_catalog', {}, ownerToken)
    expect(catalog.status).toBe(200)
    const plans = catalog.body as Array<{
      plan_key: string
      price_minor: number
      annual_price_minor: number
      annual_months_charged: number
      monthly_stripe_price_id: string | null
      annual_stripe_price_id: string | null
      min_establishments: number
      max_establishments: number
    }>
    const pro = plans.find((plan) => plan.plan_key === 'salon_pro')!
    expect(pro.price_minor).toBe(4900)
    // Dix mois payés, douze servis : la colonne est GÉNÉRÉE, pas calculée.
    expect(pro.annual_months_charged).toBe(10)
    expect(pro.annual_price_minor).toBe(49000)
    expect(pro.monthly_stripe_price_id).toMatch(/^price_/)
    expect(pro.annual_stripe_price_id).toMatch(/^price_/)

    // Les paliers multi-établissements, jamais un blocage.
    const tiers = plans
      .filter((plan) => plan.plan_key.startsWith('multi_'))
      .map((plan) => `${plan.min_establishments}-${plan.max_establishments}`)
      .sort()
    expect(tiers).toEqual(['2-3', '4-6', '7-15'])
  })

  test('AUCUN objet Stripe en mode réel', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    expect(sql('select private.billing_livemode()::text')).toBe('false')
    expect(sql('select count(*) from public.billing_stripe_prices where livemode')).toBe('0')
    expect(sql('select count(*) from public.billing_stripe_products where livemode')).toBe('0')
    expect(sql('select count(*) from public.organization_billing where livemode')).toBe('0')
    expect(sql("select count(*) from public.stripe_webhook_events where livemode and status <> 'rejected'")).toBe('0')
  })

  test('les tables de sollicitation sont muettes pour anon et en lecture seule pour authenticated', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'contrat serveur : une seule exécution')
    const anon = await restGet('notification_campaigns?select=id')
    expect([401, 404, 200]).toContain(anon.status)
    if (anon.status === 200) expect(anon.body).toEqual([])

    // Un barber ne lit pas les campagnes du salon (RLS owner/manager).
    const byBarber = await restGet(`notification_campaigns?organization_id=eq.${ORG_ID}&select=id`, barberToken)
    expect(byBarber.body).toEqual([])

    // Et personne n'écrit directement : l'INSERT est révoqué.
    const anonKey = (await import('./helpers')).envValue('ANON_KEY')
    const kong = (await import('./helpers')).kongBase()
    const write = await fetch(`${kong}/rest/v1/notification_campaigns`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organization_id: ORG_ID, kind: 'promotion', headline: 'x', period_month: '2026-09-01', scheduled_at: new Date().toISOString() }),
    })
    expect(write.status).toBeGreaterThanOrEqual(400)
  })
})
