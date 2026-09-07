import { execFileSync } from 'node:child_process'

/**
 * Harnais F1 : lectures/écritures SQL de test via le conteneur Postgres —
 * même canal d'administration que le reste de l'outillage FadeUp. Les tests
 * tournent contre la base RÉELLE (le contrat P1b : aucune donnée simulée) ;
 * tout ce que la suite crée est marqué `qa-f1-*` et neutralisé en fin de
 * suite selon la convention « ZZ dead » établie après B1.
 */
export function sql(query: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', 'fadeup-supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', query],
    { encoding: 'utf8' },
  ).trim()
}

/** Coordonnées « salon » de la suite — Île-de-France, rien de réel à 150 m. */
export const SHOP_COORDS = { latitude: 48.9876, longitude: 2.34567 }
/** Loin du salon (Marseille) — au-delà de toute géofence plausible. */
export const FAR_COORDS = { latitude: 43.2965, longitude: 5.3698 }
