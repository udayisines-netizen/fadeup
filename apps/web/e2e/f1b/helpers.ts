import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Harnais F1b : mêmes canaux que F1 — SQL d'administration via le conteneur
 * Postgres, et pour les CONTRATS de refus (jamais atteignables depuis
 * l'interface, c'est le but), l'API réelle via Kong avec la clé anon.
 *
 * Leçon F1 (29 organisations qa-f1-* indélébiles) : cette suite travaille
 * sur UNE organisation partagée, `qa-f1b-shared`, créée une seule fois par
 * le parcours d'installation réel puis RÉUTILISÉE par tous les tests et
 * toutes les exécutions. Fin de suite : neutralisée (ZZ dead) ; début de
 * suite : réactivée.
 */

export function sql(query: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', 'fadeup-supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', query],
    { encoding: 'utf8' },
  ).trim()
}

export const SHOP_COORDS = { latitude: 48.9876, longitude: 2.34567 }

export const ORG_SLUG = 'qa-f1b-shared'
export const ORG_NAME = 'QA F1b Shared'
export const QA_EMAIL = 'qa-f1b-shared@fadeup.test'
export const QA_BARBER_EMAIL = 'qa-f1b-barber@fadeup.test'
export const QA_PASSWORD = 'QaF1b!passw0rd'

/** Clé anon + port Kong réels — pour appeler les RPC comme le ferait un tiers. */
export function kongRpcBase(): { base: string; anonKey: string } {
  const env = readFileSync('/opt/fadeup/infra/supabase/.env', 'utf8')
  const anonKey = /^ANON_KEY=(.+)$/m.exec(env)?.[1]?.trim().replace(/"/g, '') ?? ''
  const port = execFileSync('docker', ['port', 'fadeup-supabase-kong', '8000/tcp'], { encoding: 'utf8' })
    .split('\n')[0]!.trim().split(':').pop()!
  return { base: `http://127.0.0.1:${port}/rest/v1/rpc`, anonKey }
}

/** Appelle une RPC en anon pur ; retourne le statut HTTP et le corps JSON. */
export async function anonRpc(
  name: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const { base, anonKey } = kongRpcBase()
  const response = await fetch(`${base}/${name}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* corps non JSON : renvoyé brut */
  }
  return { status: response.status, body }
}
