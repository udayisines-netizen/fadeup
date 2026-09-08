import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

/**
 * Harnais P1PRO — mêmes canaux que F1b/F4 : SQL d'administration via le
 * conteneur Postgres, API réelle via Kong (anon ou session par mot de
 * passe). Organisation partagée `qa-f1b-shared` (QA_DATA règle 3),
 * réactivée en début de campagne, neutralisée à la fin. Toute donnée créée
 * est marquée AVANT création : e-mails `qa-p1pro-…@fadeup.test`.
 *
 * L'état d'essai de l'organisation est SAUVÉ puis RESTAURÉ : la branche
 * `pending` exige l'absence de capacité booking (essai expiré), la file et
 * l'agenda l'exigent présente — la campagne bascule et remet en place.
 */

export const ORG_SLUG = 'qa-f1b-shared'
export const ORG_ID = '1542ea38-5585-4f84-99ba-195ff407b719'
export const QA_OWNER_EMAIL = 'qa-f1b-shared@fadeup.test'
export const QA_BARBER_EMAIL = 'qa-f1b-barber@fadeup.test'
export const QA_PASSWORD = 'QaF1b!passw0rd'
export const QA_CUSTOMER_EMAIL = 'qa-p1pro-client@fadeup.test'
export const QA_CUSTOMER_PASSWORD = 'QaP1pro!passw0rd'

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
  barberId: string
  serviceId: string
}

/** Réactive l'organisation partagée et rend ses horaires déterministes (00:00–23:59). */
export function ensureFixture(): Fixture {
  const locationId = sql(`select id from public.locations where organization_id='${ORG_ID}' limit 1`)
  const barberId = sql(`select id from public.barbers where organization_id='${ORG_ID}' limit 1`)
  const serviceId = sql(`select id from public.services where organization_id='${ORG_ID}' and is_active limit 1`)
  sql(`update public.locations set is_active=true where id='${locationId}'`)
  sql(`select private.ensure_location_service_settings('${locationId}')`)
  sql(`update public.location_service_settings set default_service_mode='hybrid', queue_open=true where location_id='${locationId}'`)
  sql(`update public.staff_profiles set is_active=true, is_public=true where id=(select staff_profile_id from public.barbers where id='${barberId}')`)
  sql(`update public.barbers set is_bookable=true where id='${barberId}'`)
  sql(`insert into public.service_locations (organization_id, service_id, location_id) values ('${ORG_ID}','${serviceId}','${locationId}') on conflict do nothing`)
  sql(`insert into public.barber_services (organization_id, barber_id, service_id) values ('${ORG_ID}','${barberId}','${serviceId}') on conflict do nothing`)
  sql(`delete from public.location_hours where location_id='${locationId}'`)
  sql(`delete from public.barber_working_hours where barber_id='${barberId}'`)
  for (let day = 0; day <= 6; day += 1) {
    sql(`insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time) values ('${ORG_ID}','${locationId}',${day},false,'00:00','23:59')`)
    sql(`insert into public.barber_working_hours (organization_id, barber_id, day_of_week, is_off, start_time, end_time) values ('${ORG_ID}','${barberId}',${day},false,'00:00','23:59')`)
  }
  return { locationId, barberId, serviceId }
}

export interface TrialState {
  status: string
  endsAt: string
  expiredAt: string
}

export function saveTrialState(): TrialState {
  const raw = sql(`select status||'|'||ends_at||'|'||coalesce(expired_at::text,'') from public.organization_trials where organization_id='${ORG_ID}'`)
  const [status = '', endsAt = '', expiredAt = ''] = raw.split('|')
  return { status, endsAt, expiredAt }
}

/** Sans capacité booking, une réservation part en `pending` (B2). */
export function expireTrial(): void {
  sql(`update public.organization_trials set status='expired', ends_at=now()-interval '1 hour', expired_at=now() where organization_id='${ORG_ID}'`)
}

export function restoreTrial(state: TrialState): void {
  const expired = state.expiredAt ? `'${state.expiredAt}'` : 'null'
  sql(`update public.organization_trials set status='${state.status}', ends_at='${state.endsAt}', expired_at=${expired} where organization_id='${ORG_ID}'`)
}

/** Le compte client QA — créé une fois par l'API admin GoTrue (motif F4). */
export function ensureQaCustomer(): void {
  const existing = sql(`select count(*) from auth.users where email = '${QA_CUSTOMER_EMAIL}'`)
  if (existing === '0') {
    const serviceKey = envValue('SERVICE_ROLE_KEY')
    execFileSync('curl', [
      '-s', '-X', 'POST', `${kongBase()}/auth/v1/admin/users`,
      '-H', `apikey: ${serviceKey}`,
      '-H', `Authorization: Bearer ${serviceKey}`,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ email: QA_CUSTOMER_EMAIL, password: QA_CUSTOMER_PASSWORD, email_confirm: true }),
    ], { encoding: 'utf8' })
  }
}

/** Jeton de session par mot de passe (grant réel GoTrue) — pour les RPC « en tant que ». */
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
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token ?? anonKey}`,
      'Content-Type': 'application/json',
    },
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

/** Demain à HH:MM, exprimé en UTC (le lieu QA est en UTC). */
export function tomorrowAtUtc(hour: number, minute = 0): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000)
  d.setUTCHours(hour, minute, 0, 0)
  return d.toISOString()
}

export interface BookedRow {
  id: string
  status: string
  is_request: boolean
}

/** Réservation par le tunnel RÉEL (RPC), anonyme ou au nom d'un compte. */
export async function book(
  fixture: Fixture,
  startsAtIso: string,
  name: string,
  email: string,
  token?: string,
): Promise<BookedRow> {
  const { status, body } = await rpc(
    'book_public_appointment',
    {
      p_organization_slug: ORG_SLUG,
      p_location_id: fixture.locationId,
      p_barber_id: fixture.barberId,
      p_service_id: fixture.serviceId,
      p_starts_at: startsAtIso,
      p_customer_name: name,
      p_customer_email: email,
    },
    token,
  )
  if (status !== 200) throw new Error(`book_public_appointment ${status}: ${JSON.stringify(body).slice(0, 200)}`)
  return (body as BookedRow[])[0]!
}

/** Connexion par l'écran réel — jamais un jeton injecté dans le navigateur. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/auth/login')
  await page.getByLabel(/e-?mail/i).first().fill(email)
  await page.getByLabel(/mot de passe|password/i).first().fill(password)
  await page.getByRole('button', { name: /se connecter|sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 20_000 })
}

/** Fin de campagne : aucune ligne QA ouverte, file vidée, file refermée. */
export function neutralize(): void {
  sql(`update public.appointments set status='cancelled', resolution='cancelled_by_business', decided_at=now()
       where organization_id='${ORG_ID}' and customer_email like 'qa-p1pro-%' and status in ('pending','confirmed')`)
  // Les lignes TERMINÉES retiennent leur créneau (l'exclusion n'exclut que
  // cancelled/no_show) : celles de la campagne précédente sont retirées —
  // données QA marquées, organisation QA, jamais un historique réel.
  sql(`delete from public.notifications where appointment_id in
       (select id from public.appointments where organization_id='${ORG_ID}' and customer_email like 'qa-p1pro-%' and status='completed')`)
  sql(`delete from public.appointments where organization_id='${ORG_ID}' and customer_email like 'qa-p1pro-%' and status='completed'`)
  // Les échantillons de durée nés des prestations QA fausseraient
  // l'estimation apprise de F1b (durée completed_at−starts_at aberrante,
  // plafonnée ±50 %) — retirés avec leurs rendez-vous.
  sql(`delete from public.service_duration_samples where organization_id='${ORG_ID}'
       and source_entry_id in (select id from public.appointments where organization_id='${ORG_ID}' and customer_email like 'qa-p1pro-%')`)
  sql(`delete from public.service_duration_samples where organization_id='${ORG_ID}'
       and source='appointment' and source_entry_id not in (select id from public.appointments)`)
  // Les lignes ANNULÉES de la campagne encombreraient le fil TODAY des
  // captures suivantes — données QA marquées, retirées avec leurs
  // notifications (les journaux append-only ne sont pas touchés).
  sql(`delete from public.notifications where appointment_id in
       (select id from public.appointments where organization_id='${ORG_ID}' and customer_email like 'qa-p1pro-%' and status in ('cancelled','no_show'))`)
  sql(`delete from public.appointments where organization_id='${ORG_ID}' and customer_email like 'qa-p1pro-%' and status in ('cancelled','no_show')`)
  sql(`update public.queue_entries set status='cancelled'
       where organization_id='${ORG_ID}' and status in ('waiting','called','in_service')`)
  sql(`update public.location_service_settings set queue_open=false
       where location_id=(select id from public.locations where organization_id='${ORG_ID}' limit 1)`)
}
