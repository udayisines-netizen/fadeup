import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

/**
 * Harnais OS-2 — mêmes canaux que OS-1/P1PRO/F1b : SQL d'administration par
 * le conteneur Postgres, API RÉELLE par Kong (session GoTrue par mot de
 * passe), connexion par l'écran réel dans le navigateur.
 *
 * Organisation partagée `qa-f1b-shared` (QA_DATA règle 3) : réactivée en
 * début de campagne, neutralisée à la fin — AUCUNE organisation nouvelle.
 * Toute donnée créée est marquée AVANT création : services « QA OS2 … »,
 * clients « QA OS2 … », invitations `qa-os2-…@fadeup.test`, notes de
 * rendez-vous « qa-os2 ».
 *
 * Les comptes de rôle interne sont ceux de PLAT-1 (`qa-plat1-*`), déjà en
 * base : ce lot ne crée aucun compte plateforme.
 */

export const ORG_SLUG = 'qa-f1b-shared'
export const ORG_ID = '1542ea38-5585-4f84-99ba-195ff407b719'
export const QA_OWNER_EMAIL = 'qa-f1b-shared@fadeup.test'
export const QA_BARBER_EMAIL = 'qa-f1b-barber@fadeup.test'
export const QA_PASSWORD = 'QaF1b!passw0rd'
export const QA_MARK = 'qa-os2'

/** Comptes de rôle interne posés par PLAT-1 (jamais créés ni modifiés ici). */
export const PLAT_PASSWORD = 'Plat1-QA!2026'
export const PLAT_SUPPORT_EMAIL = 'qa-plat1-support@fadeup.test'
export const PLAT_SALES_EMAIL = 'qa-plat1-sales@fadeup.test'
export const PLAT_INTERN_EMAIL = 'qa-plat1-intern@fadeup.test'

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
  barbers: Array<{ id: string; name: string; userEmail: string | null; membershipId: string | null }>
  barberOfAccount: string
  services: Array<{ id: string; name: string; duration: number; price: number }>
}

/**
 * Réactive l'organisation partagée pour une campagne OS-2 : lieu actif,
 * file OUVERTE, seuils au défaut, horaires 00:00–23:59, tous les fauteuils
 * réservables et aptes à tout. Le business_type est remis à `barbershop` —
 * le test « solo ne voit pas l'équipe » le bascule puis le restaure, et un
 * crash au milieu ne doit pas empoisonner la campagne suivante.
 */
export function ensureFixture(): Fixture {
  const locationId = sql(`select id from public.locations where organization_id='${ORG_ID}' limit 1`)
  const timezone = sql(`select timezone from public.locations where id='${locationId}'`)
  sql(`update public.organizations set business_type='barbershop' where id='${ORG_ID}'`)
  sql(`update public.locations set is_active=true where id='${locationId}'`)
  sql(`select private.ensure_location_service_settings('${locationId}')`)
  sql(`update public.location_service_settings
         set default_service_mode='hybrid', queue_open=true,
             queue_capacity_per_barber=20, queue_call_grace_minutes=5, queue_geofence_meters=150,
             queue_grace_sweep_enabled=false
       where location_id='${locationId}'`)
  sql(`update public.staff_profiles set is_active=true, is_public=true, location_id='${locationId}' where organization_id='${ORG_ID}'`)
  sql(`update public.barbers set is_bookable=true, queue_enabled=true where organization_id='${ORG_ID}'`)
  sql(`update public.services set is_active=true, archived_at=null, price_pending=false
       where organization_id='${ORG_ID}' and name not like 'QA OS2%'`)
  sql(`insert into public.service_locations (organization_id, service_id, location_id)
       select '${ORG_ID}', s.id, '${locationId}' from public.services s where s.organization_id='${ORG_ID}' and s.is_active
       on conflict do nothing`)
  sql(`insert into public.barber_services (organization_id, barber_id, service_id)
       select '${ORG_ID}', b.id, s.id from public.barbers b cross join public.services s
       where b.organization_id='${ORG_ID}' and s.organization_id='${ORG_ID}' and s.is_active
       on conflict do nothing`)
  sql(`delete from public.location_hours where location_id='${locationId}'`)
  sql(`delete from public.barber_working_hours where barber_id in (select id from public.barbers where organization_id='${ORG_ID}')`)
  for (let day = 0; day <= 6; day += 1) {
    sql(`insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time) values ('${ORG_ID}','${locationId}',${day},false,'00:00','23:59')`)
    sql(`insert into public.barber_working_hours (organization_id, barber_id, day_of_week, is_off, start_time, end_time)
         select '${ORG_ID}', b.id, ${day}, false, '00:00', '23:59' from public.barbers b where b.organization_id='${ORG_ID}'`)
  }
  sql(`update public.organization_trials set status='active', ends_at=greatest(ends_at, now() + interval '2 days'), expired_at=null where organization_id='${ORG_ID}'`)

  const raw = sql(`select json_agg(json_build_object('id', b.id, 'name', sp.display_name, 'email', u.email, 'membership', m.id) order by sp.display_name)
    from public.barbers b join public.staff_profiles sp on sp.id=b.staff_profile_id
    left join auth.users u on u.id=sp.user_id
    left join public.memberships m on m.user_id=sp.user_id and m.organization_id=b.organization_id
    where b.organization_id='${ORG_ID}'`)
  const barbers = (JSON.parse(raw) as Array<{ id: string; name: string; email: string | null; membership: string | null }>).map((b) => ({
    id: b.id,
    name: b.name,
    userEmail: b.email,
    membershipId: b.membership,
  }))
  const servicesRaw = sql(`select coalesce(json_agg(json_build_object('id', id, 'name', name, 'duration', duration_minutes, 'price', price_cents) order by name), '[]'::json)
    from public.services where organization_id='${ORG_ID}' and is_active`)
  const services = JSON.parse(servicesRaw) as Fixture['services']
  const barberOfAccount = barbers.find((b) => b.userEmail === QA_BARBER_EMAIL)?.id ?? ''
  return { locationId, timezone, barbers, barberOfAccount, services }
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

/** Un client de l'organisation partagée, marqué, avec N prestations terminées. */
export function seedCustomer(name: string, completedCount = 0, daysSinceLast = 7, intervalDays = 28): string {
  const fullName = `QA OS2 ${name}`
  const existing = sql(`select id from public.customers where organization_id='${ORG_ID}' and name='${fullName}' limit 1`)
  // `psql -At -c "insert … returning id"` imprime l'identifiant PUIS l'étiquette
  // de commande (« INSERT 0 1 ») : la CTE rend une ligne et une seule.
  const customerId =
    existing ||
    sql(`with created as (
           insert into public.customers (organization_id, name, phone)
           values ('${ORG_ID}', '${fullName}', null) returning id
         ) select id from created`)
  const locationId = sql(`select id from public.locations where organization_id='${ORG_ID}' limit 1`)
  const barberId = sql(`select id from public.barbers where organization_id='${ORG_ID}' order by id limit 1`)
  const serviceId = sql(`select id from public.services where organization_id='${ORG_ID}' and is_active order by name limit 1`)
  for (let i = 0; i < completedCount; i += 1) {
    const offset = daysSinceLast + i * intervalDays
    sql(`insert into public.appointments
           (organization_id, location_id, barber_id, service_id, customer_name, customer_id,
            starts_at, ends_at, status, completed_at, notes)
         values ('${ORG_ID}','${locationId}','${barberId}','${serviceId}','${fullName}','${customerId}',
                 now() - interval '${offset} days',
                 now() - interval '${offset} days' + interval '30 minutes',
                 'completed',
                 now() - interval '${offset} days' + interval '30 minutes',
                 '${QA_MARK}')`)
  }
  return customerId
}

/** Fin de campagne : tout ce que la campagne a écrit est retiré, l'organisation est remise au repos. */
export function neutralize(): void {
  sql(`update public.organizations set business_type='barbershop' where id='${ORG_ID}'`)
  sql(`delete from public.service_duration_samples where source='appointment' and source_entry_id in
       (select id from public.appointments where organization_id='${ORG_ID}' and notes='${QA_MARK}')`)
  sql(`delete from public.notifications where appointment_id in
       (select id from public.appointments where organization_id='${ORG_ID}' and notes='${QA_MARK}')`)
  sql(`delete from public.appointments where organization_id='${ORG_ID}' and notes='${QA_MARK}'`)
  sql(`delete from public.queue_entries where organization_id='${ORG_ID}' and customer_name like 'QA OS2%'`)
  sql(`delete from public.customer_notes where organization_id='${ORG_ID}'`)
  sql(`delete from public.customers where organization_id='${ORG_ID}' and name like 'QA OS2%'`)
  sql(`delete from public.barber_services where service_id in
       (select id from public.services where organization_id='${ORG_ID}' and name like 'QA OS2%')`)
  sql(`delete from public.service_locations where service_id in
       (select id from public.services where organization_id='${ORG_ID}' and name like 'QA OS2%')`)
  sql(`delete from public.services where organization_id='${ORG_ID}' and name like 'QA OS2%'`)
  sql(`delete from public.service_categories where organization_id='${ORG_ID}' and name like 'QA OS2%'`)
  sql(`delete from public.email_outbox where to_email like '${QA_MARK}-%@fadeup.test'`)
  sql(`delete from public.invitations where organization_id='${ORG_ID}' and email like '${QA_MARK}-%@fadeup.test'`)
  sql(`update public.services set is_active=true, archived_at=null, price_pending=false where organization_id='${ORG_ID}'`)
  sql(`update public.barbers set is_bookable=true, queue_enabled=true where organization_id='${ORG_ID}'`)
  sql(`update public.memberships set can_view_revenue=false where organization_id='${ORG_ID}'`)
  sql(`update public.location_service_settings
         set queue_capacity_per_barber=20, queue_call_grace_minutes=5, queue_geofence_meters=150,
             queue_grace_sweep_enabled=false
       where organization_id='${ORG_ID}'`)
}
