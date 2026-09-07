/**
 * F2 — LE mappage de l'état de service public vers le CTA transactionnel.
 *
 * La sémantique est celle que F1 a établie sur /q/:slug (queueState
 * open/closed/unknown, jamais un état inventé quand la RPC échoue) — étendue
 * ici à la face RÉSERVER des profils publics, qui en ont tous deux besoin
 * (professional-profile et organization-profile ne peuvent pas s'importer
 * l'une l'autre : la loi vit donc dans shared/, comme waitTime).
 *
 * Loi produit (MASTER_SPEC §9, F2 §3) : réservation indisponible = le profil
 * reste ENTIER et le CTA dit l'état réel. Un état inconnu (RPC en échec)
 * n'est JAMAIS remplacé par un état optimiste.
 */

export interface PublicServiceStateRow {
  booking_accepting_new_entries: boolean
  queue_accepting_new_entries: boolean
  effective_service_mode: 'hybrid' | 'reservation_only' | 'queue_only' | 'unavailable'
  /** Fin d'un mode temporaire (override daté), ISO UTC — null sinon. */
  mode_expires_at: string | null
  mode_source: string | null
}

export type ProfileCtaKind =
  /**
   * L'état est EN COURS de résolution (requêtes pending) — rien n'est
   * affirmé, ni panne ni fermeture : le CTA charge, sans note. Confondre ce
   * cas avec `unknown` faisait affirmer « l'état n'a pas pu être vérifié »
   * pendant chaque chargement — un mensonge de quelques secondes sur le
   * chemin d'arrivée mobile (attrapé par la revue F2).
   */
  | 'loading'
  /** L'état n'a pas pu être lu (échec RÉEL) — rien n'est affirmé, Réserver est désactivé. */
  | 'unknown'
  /** La réservation accepte : RÉSERVER est actif. */
  | 'bookable'
  /** Pas de réservation, mais la file accepte : l'alternative réelle est la file. */
  | 'queue-only'
  /** Ni réservation ni file : l'état réel est dit, le profil reste entier. */
  | 'closed'

export interface ProfileCtaState {
  kind: ProfileCtaKind
  /** La file accepte-t-elle ? (badge « File ouverte » + lien /q/:slug). */
  queueOpen: boolean
  /**
   * Échéance ISO d'un mode TEMPORAIRE (set_service_mode_temporary_override).
   * Présente uniquement quand le mode effectif vient d'un override daté —
   * l'interface dit alors « jusqu'à HH:MM » au lieu de laisser croire à un
   * état permanent.
   */
  temporaryUntil: string | null
}

export function deriveProfileCta(
  state: PublicServiceStateRow | null | undefined,
  options: { isError?: boolean; isLoading?: boolean } = {},
): ProfileCtaState {
  if (options.isError) {
    return { kind: 'unknown', queueOpen: false, temporaryUntil: null }
  }
  if (options.isLoading || !state) {
    // Pas encore de réponse (ou pas encore de lieu résolu) : on CHARGE,
    // on n'affirme rien.
    return { kind: 'loading', queueOpen: false, temporaryUntil: null }
  }

  const bookingOpen = Boolean(state.booking_accepting_new_entries)
  const queueOpen = Boolean(state.queue_accepting_new_entries)
  // Une échéance passée n'est plus une échéance — le serveur balaie les
  // overrides expirés, mais un poll de 30 s peut voir la fenêtre morte.
  const expiresAt = state.mode_expires_at
  const temporaryUntil = expiresAt && Date.parse(expiresAt) > Date.now() ? expiresAt : null

  if (bookingOpen) return { kind: 'bookable', queueOpen, temporaryUntil }
  if (queueOpen) return { kind: 'queue-only', queueOpen, temporaryUntil }
  return { kind: 'closed', queueOpen: false, temporaryUntil }
}
