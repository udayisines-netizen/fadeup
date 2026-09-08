import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * D1 §7 transposé — les profils CONSULTÉS RÉCEMMENT, mémorisés localement.
 *
 * Même contrat que apps/web/src/shared/lib/recentlyViewed.ts (même clé, même
 * forme, même plafond), réécrit sur AsyncStorage : le stockage natif est
 * ASYNCHRONE, la version web (localStorage synchrone) ne se copie pas.
 *
 * La donnée ne quitte JAMAIS l'appareil — aucun suivi serveur de la
 * navigation anonyme (position RGPD du produit). Toute erreur de stockage
 * est silencieuse : cette mémoire est un confort, jamais une dépendance.
 */

export interface RecentProfile {
  /** `shop` -> /shop/[slug] · `pro` -> /pro/[handle] */
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

export async function readRecentProfiles(): Promise<RecentProfile[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
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

export async function recordRecentProfile(entry: Omit<RecentProfile, 'viewedAt'>): Promise<void> {
  try {
    const rest = (await readRecentProfiles()).filter(
      (row) => !(row.kind === entry.kind && row.key === entry.key),
    )
    const next = [{ ...entry, viewedAt: Date.now() }, ...rest].slice(0, MAX_ENTRIES)
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* stockage indisponible : tant pis, jamais bloquant */
  }
}
