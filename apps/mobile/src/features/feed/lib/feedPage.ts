/**
 * M1b — logique PURE du feed (première interface du module social, backend
 * B4). Tout ce qui se teste sans React vit ici.
 *
 * Les deux lois structurelles du contrat `get_feed` :
 *
 *  - le CURSEUR de la page suivante est le PLUS PETIT `created_at` de la
 *    page reçue — pas celui de la dernière ligne affichée : la tranche est
 *    sélectionnée par `created_at desc` puis RE-TRIÉE par score à
 *    l'intérieur (comment on function, migration B4) ;
 *  - la déduplication est STRUCTURELLE côté backend (un post = une ligne,
 *    les follows sont des `exists`, testé verify_b4 §773) — le client garde
 *    une défense par `post_id` pour le seul cas théorique de deux posts au
 *    même `created_at` à la frontière de page.
 */
import type { Database } from '@/shared/lib/database.types'
import type { PostMedia } from '@/shared/data/postMedia'

type GeneratedFeedRow = Database['public']['Functions']['get_feed']['Returns'][number]

/**
 * Les types générés déclarent les colonnes non-nullables alors que la RPC
 * renvoie `null` selon `author_kind` (même piège que la file F1b — le web
 * redéclare aussi ses interfaces). On garde les champs mécaniques du généré
 * et on rétablit la nullabilité réelle du contrat B4.
 */
export interface FeedRow
  extends Omit<
    GeneratedFeedRow,
    | 'professional_id'
    | 'professional_display_name'
    | 'professional_handle'
    | 'professional_avatar_url'
    | 'organization_id'
    | 'organization_name'
    | 'organization_slug'
    | 'posted_at_organization_id'
    | 'posted_at_organization_name'
    | 'posted_at_organization_slug'
    | 'caption'
  > {
  professional_id: string | null
  professional_display_name: string | null
  professional_handle: string | null
  professional_avatar_url: string | null
  organization_id: string | null
  organization_name: string | null
  organization_slug: string | null
  posted_at_organization_id: string | null
  posted_at_organization_name: string | null
  posted_at_organization_slug: string | null
  caption: string | null
}

export const FEED_PAGE_SIZE = 20

export interface FeedService {
  id: string
  name: string
  price_cents: number | null
  duration_minutes: number | null
  is_active: boolean
}

/** `media` jsonb → tableau typé, trié par position (le SQL trie déjà). */
export function parseFeedMedia(raw: FeedRow['media']): PostMedia[] {
  if (!Array.isArray(raw)) return []
  const items: PostMedia[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const m = entry as Record<string, unknown>
    if (typeof m.id !== 'string' || typeof m.storage_path !== 'string' || typeof m.media_type !== 'string') continue
    items.push({
      id: m.id,
      storage_path: m.storage_path,
      media_type: m.media_type,
      width: typeof m.width === 'number' ? m.width : null,
      height: typeof m.height === 'number' ? m.height : null,
      duration_ms: typeof m.duration_ms === 'number' ? m.duration_ms : null,
      position: typeof m.position === 'number' ? m.position : 0,
    })
  }
  return items
}

/** `services` jsonb → tableau typé. NON trié par le SQL — ordre d'agrégat. */
export function parseFeedServices(raw: FeedRow['services']): FeedService[] {
  if (!Array.isArray(raw)) return []
  const items: FeedService[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const s = entry as Record<string, unknown>
    if (typeof s.id !== 'string' || typeof s.name !== 'string') continue
    items.push({
      id: s.id,
      name: s.name,
      price_cents: typeof s.price_cents === 'number' ? s.price_cents : null,
      duration_minutes: typeof s.duration_minutes === 'number' ? s.duration_minutes : null,
      is_active: s.is_active === true,
    })
  }
  return items
}

/**
 * Le curseur de la page SUIVANTE : min(created_at) de la page reçue.
 * `null` = plus rien à charger (page vide ou incomplète).
 */
export function nextFeedCursor(rows: readonly FeedRow[], pageSize: number = FEED_PAGE_SIZE): string | null {
  if (rows.length < pageSize) return null
  let min: string | null = null
  for (const row of rows) {
    if (row.created_at && (min === null || row.created_at < min)) min = row.created_at
  }
  return min
}

/** Aplatit les pages en dédupliquant par post_id (défense de frontière). */
export function dedupeFeedPages(pages: readonly (readonly FeedRow[])[]): FeedRow[] {
  const seen = new Set<string>()
  const out: FeedRow[] = []
  for (const page of pages) {
    for (const row of page) {
      if (seen.has(row.post_id)) continue
      seen.add(row.post_id)
      out.push(row)
    }
  }
  return out
}

/** Le nom affiché de l'auteur, selon `author_kind` (contrat B4). */
export function feedAuthorName(row: FeedRow): string | null {
  return row.author_kind === 'organization' ? row.organization_name : row.professional_display_name
}

export function feedAuthorAvatar(row: FeedRow): string | null {
  return row.author_kind === 'organization' ? null : row.professional_avatar_url
}

/** Le lieu d'attribution : l'org auteure, ou le salon FIGÉ du post pro. */
export function feedAttribution(row: FeedRow): { name: string | null; slug: string | null } {
  if (row.author_kind === 'organization') return { name: null, slug: row.organization_slug }
  return { name: row.posted_at_organization_name, slug: row.posted_at_organization_slug }
}

export interface BookTarget {
  slug: string
  serviceId: string
}

/**
 * LE chemin vers la réservation — la seule justification du module (prompt
 * §7) : un post avec service actif ET salon attribuable mène au tunnel avec
 * le service prérempli. Sans les deux, PAS de CTA (jamais un bouton mort).
 */
export function bookTargetForPost(row: FeedRow, services: readonly FeedService[]): BookTarget | null {
  const slug = row.author_kind === 'organization' ? row.organization_slug : row.posted_at_organization_slug
  if (!slug) return null
  const service = services.find((s) => s.is_active)
  if (!service) return null
  return { slug, serviceId: service.id }
}

/** Le chemin de profil de l'auteur (pro → /pro/handle, org → /shop/slug). */
export function feedAuthorRoute(row: FeedRow): string | null {
  if (row.author_kind === 'organization') {
    return row.organization_slug ? `/shop/${row.organization_slug}` : null
  }
  return row.professional_handle ? `/pro/${row.professional_handle}` : null
}
