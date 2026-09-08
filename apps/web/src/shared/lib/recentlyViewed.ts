/**
 * D1 §7 — les profils CONSULTÉS RÉCEMMENT, mémorisés localement.
 *
 * C'est la réponse au tableau de bord du visiteur sans compte : une donnée
 * VRAIE (les profils réellement ouverts), qui n'exige aucun compte et qui
 * NE QUITTE JAMAIS L'APPAREIL — localStorage uniquement, aucun suivi
 * serveur de la navigation anonyme (position RGPD du produit).
 *
 * Écrit par les deux pages de profil public au moment où le profil résout ;
 * lu par l'accueil dès la deuxième visite. Toute erreur de stockage
 * (quota, navigation privée) est silencieuse : cette mémoire est un
 * confort, jamais une dépendance.
 */

export interface RecentProfile {
  /** `shop` -> /shop/:slug · `pro` -> /pro/:handle */
  kind: 'shop' | 'pro'
  /** slug (shop) ou handle (pro). */
  key: string
  name: string
  city: string | null
  avatarUrl: string | null
  /** slug d'organisation pour la bannière de démonstration éventuelle. */
  organizationSlug: string | null
  viewedAt: number
}

const STORAGE_KEY = 'fu.recentProfiles.v1'
const MAX_ENTRIES = 8

export function readRecentProfiles(): RecentProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is RecentProfile =>
        typeof entry === 'object' &&
        entry !== null &&
        ((entry as RecentProfile).kind === 'shop' || (entry as RecentProfile).kind === 'pro') &&
        typeof (entry as RecentProfile).key === 'string' &&
        typeof (entry as RecentProfile).name === 'string',
    )
  } catch {
    return []
  }
}

export function recordRecentProfile(entry: Omit<RecentProfile, 'viewedAt'>): void {
  try {
    const rest = readRecentProfiles().filter((row) => !(row.kind === entry.kind && row.key === entry.key))
    const next = [{ ...entry, viewedAt: Date.now() }, ...rest].slice(0, MAX_ENTRIES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* stockage indisponible : tant pis, jamais bloquant */
  }
}

/* ----------------------------------------------------------------------------
 * Compteur de visites de l'accueil — pour l'invitation DISCRÈTE à créer un
 * compte (bannière fermable, jamais une modale), après plusieurs visites.
 * Une visite = une session de navigation (sessionStorage comme garde).
 * ------------------------------------------------------------------------- */

const VISITS_KEY = 'fu.homeVisits.v1'
const VISIT_SESSION_KEY = 'fu.homeVisited.session'
const INVITE_DISMISSED_KEY = 'fu.accountInvite.dismissed.v1'
/** L'invitation n'apparaît qu'à partir de la troisième visite. */
export const INVITE_MIN_VISITS = 3

export function countHomeVisit(): number {
  try {
    const visits = Number(localStorage.getItem(VISITS_KEY) ?? '0') || 0
    if (sessionStorage.getItem(VISIT_SESSION_KEY)) return visits
    sessionStorage.setItem(VISIT_SESSION_KEY, '1')
    const next = visits + 1
    localStorage.setItem(VISITS_KEY, String(next))
    return next
  } catch {
    return 0
  }
}

export function isInviteDismissed(): boolean {
  try {
    return localStorage.getItem(INVITE_DISMISSED_KEY) === '1'
  } catch {
    return true
  }
}

export function dismissInvite(): void {
  try {
    localStorage.setItem(INVITE_DISMISSED_KEY, '1')
  } catch {
    /* silencieux */
  }
}
