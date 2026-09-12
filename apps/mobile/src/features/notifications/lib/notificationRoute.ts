/**
 * M1c-a — où mène une notification touchée.
 *
 * Le serveur ne met dans `data` que de quoi ROUTER : un genre et un
 * identifiant (migration 20260912100100, colonne `push_outbox.data`). Aucune
 * donnée opérationnelle n'y voyage — l'application relit la base en s'ouvrant,
 * parce qu'une position de file vieille de dix minutes est un mensonge.
 *
 * Module PUR : aucune dépendance au routeur, testable sous Node. Le liant
 * `expo-router` vit dans `usePushRouting.ts`.
 */

export interface NotificationData {
  kind?: unknown
  entry_id?: unknown
  appointment_id?: unknown
  organization_id?: unknown
  post_id?: unknown
  slug?: unknown
}

/**
 * La route à ouvrir, ou `null` quand rien n'est sûr. `null` ouvre l'accueil :
 * c'est ce que M1b fait déjà pour un lien profond inconnu — jamais un écran
 * vide, jamais un identifiant inventé.
 *
 * L'appel de file mène au SUIVI du salon, pas à une route par entrée : le
 * suivi est retrouvé par la trace locale (AsyncStorage) ou par le compte, et
 * c'est déjà le contrat de `/q/[slug]` posé en M1b. Sans le slug, on ne
 * fabrique pas d'URL — on ouvre l'accueil et le client voit sa place depuis là.
 */
export function routeForNotification(data: NotificationData | null | undefined): string | null {
  if (!data || typeof data !== 'object') return null
  const kind = typeof data.kind === 'string' ? data.kind : null

  switch (kind) {
    case 'queue_entry': {
      const slug = typeof data.slug === 'string' && data.slug.length > 0 ? data.slug : null
      return slug ? `/q/${encodeURIComponent(slug)}` : null
    }
    case 'appointment':
      // Mes réservations : l'onglet porte la demande ET le rendez-vous, et
      // c'est là que le client agit (annuler, reporter, répondre).
      return '/bookings'
    case 'post': {
      // Le fil, pas un viewer de post : M1b a laissé le viewer plein écran à
      // ratifier (rapport M1b §12.4). On n'invente pas la destination.
      return '/feed'
    }
    default:
      return null
  }
}
