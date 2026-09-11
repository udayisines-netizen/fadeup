import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

/**
 * Harnais OS-1 — mêmes canaux que P1PRO/F1b : SQL d'administration via le
 * conteneur Postgres, API réelle via Kong (session par mot de passe).
 * Organisation partagée `qa-f1b-shared` (QA_DATA règle 3) : réactivée en
 * début de campagne, neutralisée à la fin. Toute donnée créée est marquée
 * AVANT création : e-mails `qa-os1-…@fadeup.test`, notes « qa-os1 ».
 * Les TROIS fauteuils de l'organisation reçoivent des horaires
 * déterministes (00:00–23:59) et l'aptitude à tous les services actifs.
 */

export const ORG_SLUG = 'qa-f1b-shared'
export const ORG_ID = '1542ea38-5585-4f84-99ba-195ff407b719'
export const QA_OWNER_EMAIL = 'qa-f1b-shared@fadeup.test'
export const QA_BARBER_EMAIL = 'qa-f1b-barber@fadeup.test'
export const QA_PASSWORD = 'QaF1b!passw0rd'
export const QA_MARK = 'qa-os1'

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
  /** Les barbers, triés par nom d'affichage (l'ordre des colonnes). */
  barbers: Array<{ id: string; name: string; userEmail: string | null; membershipId: string | null }>
  /** Le barber rattaché au compte barber QA. */
  barberOfAccount: string
  services: Array<{ id: string; name: string; duration: number; price: number }>
}

/** Réactive l'organisation partagée : horaires 00:00–23:59, tous aptes à tout. */
export function ensureFixture(): Fixture {
  const locationId = sql(`select id from public.locations where organization_id='${ORG_ID}' limit 1`)
  const timezone = sql(`select timezone from public.locations where id='${locationId}'`)
  sql(`update public.locations set is_active=true where id='${locationId}'`)
  sql(`select private.ensure_location_service_settings('${locationId}')`)
  sql(`update public.location_service_settings set default_service_mode='hybrid' where location_id='${locationId}'`)
  sql(`update public.staff_profiles set is_active=true, is_public=true, location_id='${locationId}' where organization_id='${ORG_ID}'`)
  sql(`update public.barbers set is_bookable=true where organization_id='${ORG_ID}'`)
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
  // L'essai actif = la capacité booking (l'agenda vit derrière elle).
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
  const servicesRaw = sql(`select json_agg(json_build_object('id', id, 'name', name, 'duration', duration_minutes, 'price', price_cents) order by name)
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

export async function rpc(name: string, payload: Record<string, unknown>, token?: string): Promise<{ status: number; body: unknown }> {
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

/** Le jour QA : demain (le lieu QA est en UTC), pour ne jamais tomber dans le passé. */
export function qaDay(offsetDays = 1): string {
  const d = new Date(Date.now() + offsetDays * 24 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

export function atUtc(day: string, hour: number, minute = 0): string {
  return `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`
}

export interface CreatedRow {
  id: string
  starts_at: string
  ends_at: string
  status: string
  barber_id: string
  overlap_forced_at: string | null
}

/** Création RÉELLE par la RPC du comptoir, marquée qa-os1. */
export async function createAppointment(
  token: string,
  fixture: Fixture,
  barberId: string,
  serviceId: string,
  startsAtIso: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<CreatedRow> {
  const { status, body } = await rpc(
    'create_appointment_as_business',
    {
      p_location_id: fixture.locationId,
      p_barber_id: barberId,
      p_service_id: serviceId,
      p_starts_at: startsAtIso,
      p_customer_name: name,
      p_customer_email: `${QA_MARK}-${name.toLowerCase().replace(/[^a-z]/g, '')}@fadeup.test`,
      p_notes: QA_MARK,
      ...extra,
    },
    token,
  )
  if (status !== 200) throw new Error(`create_appointment_as_business ${status}: ${JSON.stringify(body).slice(0, 300)}`)
  return body as CreatedRow
}

/** Connexion par l'écran réel — jamais un jeton injecté dans le navigateur. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth/login')
  await page.getByLabel(/e-?mail/i).first().fill(email)
  await page.getByLabel(/mot de passe|password/i).first().fill(password)
  await page.getByRole('button', { name: /se connecter|sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 20_000 })
}

/** Fin de campagne : les lignes qa-os1 sont closes puis retirées, les blocages qa-os1 aussi, le réglage de revenu remis au défaut. */
export function neutralize(): void {
  sql(`delete from public.appointment_overlap_forces where appointment_id in
       (select id from public.appointments where organization_id='${ORG_ID}' and (notes='${QA_MARK}' or customer_email like '${QA_MARK}-%'))`)
  sql(`delete from public.notifications where appointment_id in
       (select id from public.appointments where organization_id='${ORG_ID}' and (notes='${QA_MARK}' or customer_email like '${QA_MARK}-%'))`)
  sql(`delete from public.email_outbox where dedupe_key like any (select id::text || '%' from public.appointments where organization_id='${ORG_ID}' and (notes='${QA_MARK}' or customer_email like '${QA_MARK}-%'))`)
  sql(`delete from public.service_duration_samples where source='appointment' and source_entry_id in
       (select id from public.appointments where organization_id='${ORG_ID}' and (notes='${QA_MARK}' or customer_email like '${QA_MARK}-%'))`)
  // Les lignes TERMINÉES retiennent leur créneau (piège P1PRO) et les
  // autres encombreraient la campagne suivante : données QA marquées,
  // organisation QA, jamais un historique réel.
  sql(`delete from public.appointments where organization_id='${ORG_ID}' and (notes='${QA_MARK}' or customer_email like '${QA_MARK}-%')`)
  sql(`delete from public.time_blocks where organization_id='${ORG_ID}' and reason like '${QA_MARK}%'`)
  sql(`update public.memberships set can_view_revenue=false where organization_id='${ORG_ID}'`)
}
