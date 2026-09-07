import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

/**
 * Aides F4 — mêmes conventions que e2e/f1b/helpers.ts : psql via docker,
 * clés lues dans l'env de production (jamais imprimées), données marquées
 * AVANT création (QA_DATA règle 2 : e-mails qa-f4-…@fadeup.test).
 *
 * F4 ne crée AUCUNE organisation : les deux chemins du tunnel s'exercent sur
 * le jeu de démonstration B1/F2 (demo-maison-kais : plan accordé, capacité
 * booking → confirmed ; demo-atelier-fadel : Free → pending), et la demande
 * d'intérêt sur l'identité non revendiquée demo.moussa.diakite.
 */

export const CONFIRMED_ORG = 'demo-maison-kais'
export const PENDING_ORG = 'demo-atelier-fadel'
export const UNCLAIMED_HANDLE = 'demo.moussa.diakite'

export const QA_CUSTOMER_EMAIL = 'qa-f4-customer@fadeup.test'
export const QA_CUSTOMER_PASSWORD = 'QaF4!passw0rd'
export const QA_CUSTOMER_NAME = 'QA F4 Client'

export function sql(query: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', 'fadeup-supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', query],
    { encoding: 'utf8' },
  ).trim()
}

function envValue(name: string): string {
  const env = readFileSync('/opt/fadeup/infra/supabase/.env', 'utf8')
  const line = env.split('\n').find((row) => row.startsWith(`${name}=`))
  if (!line) throw new Error(`${name} introuvable dans l'env Supabase`)
  return line.slice(name.length + 1).trim()
}

export function kongBase(): string {
  const out = execFileSync('docker', ['port', 'fadeup-supabase-kong', '8000/tcp'], { encoding: 'utf8' })
  const port = out.split('\n')[0]?.split(':').pop() ?? '18100'
  return `http://127.0.0.1:${port.trim()}`
}

/**
 * L'OTP e-mail RÉEL du dernier envoi GoTrue, via l'API admin
 * (`generate_link`) — le seul moyen déterministe de vérifier l'inscription
 * légère de bout en bout sans boîte de réception. La clé service_role ne
 * quitte jamais ce process.
 */
export async function fetchEmailOtp(email: string): Promise<string> {
  const serviceKey = envValue('SERVICE_ROLE_KEY')
  const response = await fetch(`${kongBase()}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  if (!response.ok) throw new Error(`generate_link a répondu ${response.status}`)
  const body = (await response.json()) as { email_otp?: string }
  if (!body.email_otp) throw new Error('generate_link sans email_otp')
  return body.email_otp
}

/** Réserve un créneau PAR L'API anonyme (course au créneau, S3). */
export async function anonBook(payload: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const anonKey = envValue('ANON_KEY')
  const response = await fetch(`${kongBase()}/rest/v1/rpc/book_public_appointment`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

/**
 * Le compte client QA — créé UNE fois par l'API admin GoTrue (autoconfirm),
 * puis réutilisé par toutes les campagnes. Pas d'organisation : réutilisable
 * sans neutralisation (QA_DATA règle 3).
 */
export function ensureQaCustomer(): void {
  const existing = sql(`select count(*) from auth.users where email = '${QA_CUSTOMER_EMAIL}'`)
  if (existing === '0') {
    const serviceKey = envValue('SERVICE_ROLE_KEY')
    execFileSync(
      'curl',
      [
        '-s',
        '-X',
        'POST',
        `${kongBase()}/auth/v1/admin/users`,
        '-H',
        `apikey: ${serviceKey}`,
        '-H',
        `Authorization: Bearer ${serviceKey}`,
        '-H',
        'Content-Type: application/json',
        '-d',
        JSON.stringify({ email: QA_CUSTOMER_EMAIL, password: QA_CUSTOMER_PASSWORD, email_confirm: true }),
      ],
      { encoding: 'utf8' },
    )
  }
}

/** Connexion par mot de passe via l'écran réel — jamais un jeton injecté. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/auth/login')
  await page.getByLabel(/e-mail|email/i).fill(QA_CUSTOMER_EMAIL)
  await page.getByLabel(/mot de passe|password/i).fill(QA_CUSTOMER_PASSWORD)
  await page.getByRole('button', { name: /se connecter|sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 20_000 })
}

/** Nettoie les rendez-vous QA F4 restés ouverts (idempotent, marqués avant création). */
export function cancelLeftoverQaBookings(): void {
  sql(`
    update public.appointments a
       set status = 'cancelled', resolution = 'cancelled_by_customer', decided_at = now()
     where a.customer_email like 'qa-f4-%@fadeup.test'
       and a.status in ('pending', 'confirmed')
  `)
}

/** Demain à l'heure demandée, dans le fuseau du lieu (pour les réservations API). */
export function tomorrowAt(hourUtcish: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  d.setUTCHours(hourUtcish, 0, 0, 0)
  return d.toISOString()
}
