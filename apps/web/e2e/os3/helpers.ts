import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

/**
 * Harnais OS-3 — mêmes canaux qu'OS-1/OS-2/P1PRO/F1b : SQL d'administration
 * par le conteneur Postgres, API RÉELLE par Kong (session GoTrue par mot de
 * passe), connexion par l'écran réel dans le navigateur.
 *
 * Organisation partagée `qa-f1b-shared` (QA_DATA règle 3) : réactivée en début
 * de campagne, neutralisée à la fin — AUCUNE organisation nouvelle.
 *
 * DEUX PRÉCAUTIONS PROPRES À CE LOT, parce qu'il envoie des e-mails :
 *
 *  1. TOUTE adresse de client de test est en `@fadeup.test` — un domaine
 *     réservé, sans MX. Le scheduler d'envoi tourne toutes les 60 secondes et
 *     ramassera ces lignes : elles rebondissent sans atteindre personne. Aucun
 *     client réel n'est jamais dans l'audience d'un test, et
 *     `ensureFixture` VÉRIFIE qu'aucune adresse hors `@fadeup.test` ne traîne
 *     dans l'organisation avant d'autoriser un envoi.
 *  2. `neutralize` retire les lignes `email_outbox` de la campagne, remet le
 *     plan et l'essai de l'organisation dans leur état d'origine, et efface
 *     les `do_not_contact` posés par les tests.
 *
 * LA FENÊTRE DE MINUIT (méthode reprise d'OS-2 §12.10 / B5) : la fixture ouvre
 * le lieu 00:00–23:59 les SEPT jours, donc « demain » n'est jamais un jour de
 * fermeture et le modèle « créneaux libres demain » ne dépend pas de l'heure
 * à laquelle la campagne tourne.
 */

export const ORG_SLUG = 'qa-f1b-shared'
export const ORG_ID = '1542ea38-5585-4f84-99ba-195ff407b719'
export const QA_OWNER_EMAIL = 'qa-f1b-shared@fadeup.test'
export const QA_BARBER_EMAIL = 'qa-f1b-barber@fadeup.test'
export const QA_PASSWORD = 'QaF1b!passw0rd'
export const QA_MARK = 'qa-os3'
/** Le préfixe d'adresse de TOUS les clients de test de ce lot. */
export const QA_EMAIL_PREFIX = 'qa-os3-'

export function sql(query: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', 'fadeup-supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', query],
    { encoding: 'utf8' },
  ).trim()
}

export function envValue(key: string): string {
  const env = readFileSync('/opt/fadeup/infra/supabase/.env', 'utf8')
  return new RegExp(`^${key}=(.+)$`, 'm').exec(env)?.[1]?.trim().replace(/"/g, '') ?? ''
}

export function kongBase(): string {
  const port = execFileSync('docker', ['port', 'fadeup-supabase-kong', '8000/tcp'], { encoding: 'utf8' })
    .split('\n')[0]!
    .trim()
    .split(':')
    .pop()!
  return `http://127.0.0.1:${port}`
}

export interface Fixture {
  locationId: string
  timezone: string
  barberId: string
  barberMembershipId: string
  serviceId: string
  servicePriceCents: number
  /** Une SECONDE organisation, pour prouver qu'un pro n'atteint pas ses clients. */
  otherOrgId: string
  otherCustomerId: string
  /** Les clients marqués créés par la fixture. */
  lapsedCustomerId: string
  regularCustomerId: string
  dncCustomerId: string
}

/** L'essai d'origine, restauré par `neutralize`. */
let originalTrialStatus = ''
let originalTrialEnds = ''

/**
 * L'organisation partagée est assignée au plan `free` et tire ses capacités
 * de son ESSAI. Un test qui supprime la ligne d'essai (le démarrage d'essai)
 * doit pouvoir échouer sans laisser l'organisation sans capacités pour les
 * campagnes suivantes : cette fonction la RECRÉE si elle manque, et elle est
 * appelée aussi bien par `ensureFixture` que par `neutralize`.
 */
export function ensureActiveTrial(): void {
  const exists = sql(`select count(*) from public.organization_trials where organization_id='${ORG_ID}'`)
  if (exists === '0') {
    sql(`insert into public.organization_trials
           (organization_id, plan_key, started_at, ends_at, status, started_from)
         values ('${ORG_ID}', 'salon_pro', now() - interval '12 days', now() + interval '2 days', 'active', 'onboarding')`)
    return
  }
  sql(`update public.organization_trials
         set status='active', ends_at=greatest(ends_at, now() + interval '2 days'), expired_at=null
       where organization_id='${ORG_ID}'`)
}

export function ensureFixture(): Fixture {
  const locationId = sql(`select id from public.locations where organization_id='${ORG_ID}' order by created_at limit 1`)
  sql(`update public.organizations set business_type='barbershop' where id='${ORG_ID}'`)
  sql(`update public.locations set is_active=true where id='${locationId}'`)
  /* LE FUSEAU NE SE TOUCHE PAS. Première version de ce harnais : il forçait
     `Europe/Paris` « pour rendre les heures calmes déterministes ». Le fuseau
     de l'organisation partagée était UTC, la modification n'était PAS
     restaurée par `neutralize`, et trois suites d'autres lots (os1/agenda,
     f4, p1pro) sont tombées ensuite sur un décalage de deux heures. Les
     assertions d'heures calmes d'OS-3 passent un fuseau EXPLICITE à
     `private.marketing_next_attempt_at` : elles n'ont jamais eu besoin de
     celui du lieu. Erreur déclarée au rapport. */
  const timezone = sql(`select timezone from public.locations where id='${locationId}'`)
  sql(`select private.ensure_location_service_settings('${locationId}')`)
  sql(`update public.staff_profiles set is_active=true, is_public=true, location_id='${locationId}' where organization_id='${ORG_ID}'`)
  sql(`update public.barbers set is_bookable=true, queue_enabled=true where organization_id='${ORG_ID}'`)
  sql(`update public.services set is_active=true, archived_at=null, price_pending=false where organization_id='${ORG_ID}'`)

  const barberId = sql(`select b.id from public.barbers b
    join public.staff_profiles sp on sp.id=b.staff_profile_id
    join auth.users u on u.id=sp.user_id
    where b.organization_id='${ORG_ID}' and u.email='${QA_BARBER_EMAIL}' limit 1`)
  const barberMembershipId = sql(`select m.id from public.memberships m
    join auth.users u on u.id=m.user_id
    where m.organization_id='${ORG_ID}' and u.email='${QA_BARBER_EMAIL}' limit 1`)
  const serviceId = sql(`select id from public.services where organization_id='${ORG_ID}' and is_active order by name limit 1`)
  sql(`update public.services set duration_minutes=30, price_cents=3000, buffer_before_minutes=0, buffer_after_minutes=0 where id='${serviceId}'`)
  const servicePriceCents = 3000

  sql(`insert into public.service_locations (organization_id, service_id, location_id)
       select '${ORG_ID}', s.id, '${locationId}' from public.services s
       where s.organization_id='${ORG_ID}' and s.is_active on conflict do nothing`)
  sql(`insert into public.barber_services (organization_id, barber_id, service_id)
       select '${ORG_ID}', b.id, s.id from public.barbers b cross join public.services s
       where b.organization_id='${ORG_ID}' and s.organization_id='${ORG_ID}' and s.is_active
       on conflict do nothing`)

  // 00:00–23:59 les sept jours : « demain » n'est jamais fermé (OS-2 §12.10).
  sql(`delete from public.location_hours where location_id='${locationId}'`)
  sql(`delete from public.barber_working_hours where barber_id in (select id from public.barbers where organization_id='${ORG_ID}')`)
  for (let day = 0; day <= 6; day += 1) {
    sql(`insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
         values ('${ORG_ID}','${locationId}',${day},false,'00:00','23:59')`)
    sql(`insert into public.barber_working_hours (organization_id, barber_id, day_of_week, is_off, start_time, end_time)
         select '${ORG_ID}', b.id, ${day}, false, '00:00', '23:59' from public.barbers b where b.organization_id='${ORG_ID}'`)
  }

  /* LE PLAN ASSIGNÉ NE SE TOUCHE PAS. L'organisation partagée est assignée
     au plan `free` et tire ses capacités de son ESSAI — c'est ce que le
     harnais d'OS-2 fait déjà, et ce dont `e2e/p1pro` dépend (« le monde Free
     (essai expiré) » n'a de sens que si le plan ASSIGNÉ est `free`).
     Première version de ce harnais : elle écrivait `plan_key='salon_pro'` et
     tentait de restaurer l'original — restauration que la garde de capacité
     de R2 REFUSE (« cannot move to free: it covers 1 operational
     professional… »), donc qui n'a jamais eu lieu. Erreur déclarée au
     rapport.
     Il suffit d'un essai ACTIF : `private.effective_plan_key` rend alors le
     plan de l'essai (salon_pro), donc un plafond de 50 campagnes — assez
     pour la campagne — sans rien changer au plan assigné. */
  originalTrialStatus = sql(`select coalesce(status,'') from public.organization_trials where organization_id='${ORG_ID}'`)
  originalTrialEnds = sql(`select coalesce(ends_at::text,'') from public.organization_trials where organization_id='${ORG_ID}'`)
  ensureActiveTrial()
  sql(`update public.memberships set can_view_revenue=false where organization_id='${ORG_ID}'`)

  /* Sans la capacité `booking`, `enforce_booking_service_mode` REFUSE toute
     insertion de rendez-vous : la fixture s'effondrerait plus bas sur une
     erreur de trigger illisible. On le dit ici, une fois. */
  if (sql(`select private.org_has_capability('${ORG_ID}','booking')::text`) !== 'true') {
    throw new Error(`OS-3: ${ORG_SLUG} n'a pas la capacité booking — l'essai n'a pas pu être réactivé`)
  }

  // La SECONDE organisation et son client : la preuve d'isolement.
  const otherOrgId = sql(`select id from public.organizations where id <> '${ORG_ID}'
    and exists (select 1 from public.memberships m where m.organization_id=organizations.id)
    order by slug limit 1`)
  const otherCustomerId = upsertCustomer(otherOrgId, 'Ailleurs', `${QA_EMAIL_PREFIX}ailleurs@fadeup.test`, 0)

  // Les clients de l'organisation. Adresses @fadeup.test uniquement.
  const lapsedCustomerId = upsertCustomer(ORG_ID, 'Lapsed', `${QA_EMAIL_PREFIX}lapsed@fadeup.test`, 4, 120, 28)
  const regularCustomerId = upsertCustomer(ORG_ID, 'Regulier', `${QA_EMAIL_PREFIX}regulier@fadeup.test`, 3, 3, 21)
  const dncCustomerId = upsertCustomer(ORG_ID, 'Desabonne', `${QA_EMAIL_PREFIX}dnc@fadeup.test`, 3, 5, 21)
  sql(`update public.customers set do_not_contact=true where id='${dncCustomerId}'`)

  // LA VÉRIFICATION DE SÛRETÉ : aucune adresse hors @fadeup.test dans
  // l'organisation, sinon un envoi de test atteindrait une vraie personne.
  const foreign = sql(`select count(*) from public.customers
    where organization_id='${ORG_ID}' and email is not null and email not like '%@fadeup.test'`)
  if (foreign !== '0') {
    throw new Error(
      `OS-3: ${foreign} client(s) de ${ORG_SLUG} ont une adresse hors @fadeup.test — campagne refusée pour ne pas leur écrire`,
    )
  }

  return {
    locationId,
    timezone,
    barberId,
    barberMembershipId,
    serviceId,
    servicePriceCents,
    otherOrgId,
    otherCustomerId,
    lapsedCustomerId,
    regularCustomerId,
    dncCustomerId,
  }
}

/**
 * Un client marqué, avec N prestations TERMINÉES espacées, la dernière il y a
 * `daysSinceLast` jours. `created_at` est ANTIDATÉ : les insights lisent la
 * date de création, et une fixture créée « maintenant » ferait croire à une
 * organisation née aujourd'hui.
 */
export function upsertCustomer(
  organizationId: string,
  name: string,
  email: string,
  completedCount: number,
  daysSinceLast = 7,
  intervalDays = 28,
): string {
  const fullName = `QA OS3 ${name}`
  const existing = sql(
    `select id from public.customers where organization_id='${organizationId}' and email='${email}' limit 1`,
  )
  const customerId =
    existing ||
    sql(`with created as (
           insert into public.customers (organization_id, name, email) values ('${organizationId}', '${fullName}', '${email}') returning id
         ) select id from created`)
  if (completedCount === 0) return customerId

  const locationId = sql(`select id from public.locations where organization_id='${organizationId}' order by created_at limit 1`)
  const barberId = sql(`select id from public.barbers where organization_id='${organizationId}' order by id limit 1`)
  const serviceId = sql(`select id from public.services where organization_id='${organizationId}' and is_active order by name limit 1`)
  if (!locationId || !barberId || !serviceId) return customerId

  for (let i = 0; i < completedCount; i += 1) {
    const offset = daysSinceLast + i * intervalDays
    sql(`insert into public.appointments
           (organization_id, location_id, barber_id, service_id, customer_name, customer_id,
            starts_at, ends_at, status, completed_at, created_at, notes)
         values ('${organizationId}','${locationId}','${barberId}','${serviceId}','${fullName}','${customerId}',
                 now() - interval '${offset} days',
                 now() - interval '${offset} days' + interval '30 minutes',
                 'completed',
                 now() - interval '${offset} days' + interval '30 minutes',
                 now() - interval '${offset} days',
                 '${QA_MARK}')`)
  }
  return customerId
}

/** Jeton de session par mot de passe (grant réel GoTrue). */
export async function passwordToken(email: string, password: string): Promise<string> {
  const anonKey = envValue('ANON_KEY')
  const response = await fetch(`${kongBase()}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = (await response.json()) as { access_token?: string }
  if (!body.access_token) throw new Error(`password grant failed for ${email}: ${response.status}`)
  return body.access_token
}

export async function rpc(
  name: string,
  payload: Record<string, unknown>,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  const anonKey = envValue('ANON_KEY')
  const response = await fetch(`${kongBase()}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token ?? anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* texte brut */
  }
  return { status: response.status, body }
}

/** Une lecture PostgREST directe, sous la RLS de l'appelant. */
export async function restGet(path: string, token?: string): Promise<{ status: number; body: unknown }> {
  const anonKey = envValue('ANON_KEY')
  const response = await fetch(`${kongBase()}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token ?? anonKey}` },
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* texte brut */
  }
  return { status: response.status, body }
}

/** Le motif de refus nommé porté par `details`, ou null. */
export function refusal(body: unknown): string | null {
  const details = (body as { details?: unknown } | null)?.details
  return typeof details === 'string' ? details : null
}

/** Connexion par l'écran réel — jamais un jeton injecté dans le navigateur. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth/login')
  await page.getByLabel(/e-?mail/i).first().fill(email)
  await page.getByLabel(/mot de passe|password/i).first().fill(password)
  await page.getByRole('button', { name: /se connecter|sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 20_000 })
}

/** Fin de campagne : tout ce que la campagne a écrit est retiré. */
export function neutralize(): void {
  sql(`update public.organizations set business_type='barbershop' where id='${ORG_ID}'`)
  // Les sollicitations de test : d'abord les destinataires (FK), puis les
  // campagnes, puis les lignes d'envoi.
  sql(`delete from public.notification_campaign_recipients where campaign_id in
       (select id from public.notification_campaigns where organization_id='${ORG_ID}')`)
  sql(`delete from public.notification_campaigns where organization_id='${ORG_ID}'`)
  sql(`delete from public.email_outbox where stream='marketing' and to_email like '${QA_EMAIL_PREFIX}%@fadeup.test'`)
  sql(`delete from public.service_duration_samples where source='appointment' and source_entry_id in
       (select id from public.appointments where organization_id='${ORG_ID}' and notes='${QA_MARK}')`)
  sql(`delete from public.notifications where appointment_id in
       (select id from public.appointments where organization_id='${ORG_ID}' and notes='${QA_MARK}')`)
  sql(`delete from public.appointments where organization_id='${ORG_ID}' and notes='${QA_MARK}'`)
  sql(`delete from public.appointments where notes='${QA_MARK}'`)
  sql(`delete from public.customers where name like 'QA OS3 %'`)
  sql(`update public.customers set do_not_contact=false where organization_id='${ORG_ID}'`)
  sql(`update public.memberships set can_view_revenue=false where organization_id='${ORG_ID}'`)
  sql(`update public.services set is_active=true, archived_at=null, price_pending=false where organization_id='${ORG_ID}'`)
  sql(`delete from public.billing_quote_requests where organization_id='${ORG_ID}'`)
  // Le test de plafond abaisse le plafond du plan Pro en base : filet de
  // sécurité si le test tombe avant sa propre restauration.
  sql(`update public.commercial_plans set monthly_campaign_allowance=50 where plan_key='salon_pro'`)
  // La ligne d'essai existe TOUJOURS à la sortie : c'est elle qui porte les
  // capacités de l'organisation partagée (plan assigné `free`).
  ensureActiveTrial()
  if (originalTrialStatus && originalTrialEnds && originalTrialStatus !== 'active') {
    sql(`update public.organization_trials set status='${originalTrialStatus}', ends_at='${originalTrialEnds}',
           expired_at = case when '${originalTrialStatus}'='expired' then coalesce(expired_at, now()) else null end
         where organization_id='${ORG_ID}'`)
  }
}
