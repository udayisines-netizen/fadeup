import type { ProfessionalSearchRow, ResultAvailability } from '@/shared/data/discovery'

/**
 * F3 — LE module de classement. La formule du score FadeUp est une décision
 * fondateur EN ATTENTE (MASTER_SPEC §23) : ce fichier est le point de
 * branchement prévu — les poids vivent ICI, jamais dispersés dans les
 * composants (l'exigence « architecture modulaire » du §8, le motif de la
 * table de poids B4 côté feed).
 *
 * En attendant la formule, le tri par défaut est honnête et explicable :
 *   1. la DISTANCE réelle, calculée serveur (`p_sort: 'recommended'` trie
 *      distance croissante, inconnues en dernier) quand un point existe ;
 *   2. la DISPONIBILITÉ RÉELLE ensuite : sans point de recherche, le serveur
 *      n'a pas de distance à trier — les rangées qui peuvent servir dans
 *      l'heure remontent (tri STABLE : l'ordre serveur est conservé au sein
 *      de chaque groupe).
 *
 * INVARIANT (MASTER_SPEC §8) : payer ne donne pas un meilleur classement
 * organique. Quand la mise en avant sponsorisée existera, elle sera un
 * emplacement SÉPARÉ et marqué — jamais un poids caché dans cette table.
 */

export const SORT_OPTIONS = ['recommended', 'nearest', 'price'] as const
export type SortOption = (typeof SORT_OPTIONS)[number]

/**
 * La table de poids du classement client. La future formule du score FadeUp
 * s'y branchera (et pourra descendre en base, comme les poids du feed B4).
 */
export const RANKING_WEIGHTS = {
  /** Rang de disponibilité, appliqué quand le serveur n'a pas trié par distance. */
  availability: {
    'available-now': 0,
    bookable: 1,
    closed: 2,
    loading: 3,
    unknown: 3,
  } satisfies Record<ResultAvailability, number>,
} as const

/**
 * Classement côté client d'une page de résultats chargée. Ne réordonne
 * JAMAIS un tri serveur par distance ou par prix : il ne s'applique qu'au
 * tri « recommandé » sans point de recherche, où l'ordre serveur est
 * alphabétique — la disponibilité réelle est alors le signal le plus utile.
 */
export function rankResults(
  rows: ProfessionalSearchRow[],
  availabilityByLocation: Record<string, ResultAvailability>,
  sort: SortOption,
  hasSearchPoint: boolean,
): ProfessionalSearchRow[] {
  if (sort !== 'recommended' || hasSearchPoint) return rows
  const rank = (row: ProfessionalSearchRow): number =>
    RANKING_WEIGHTS.availability[availabilityByLocation[row.location_id] ?? 'unknown']
  // toSorted est stable : l'ordre serveur survit au sein de chaque groupe.
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const byAvailability = rank(a.row) - rank(b.row)
    return byAvailability !== 0 ? byAvailability : a.index - b.index
  }).map(({ row }) => row)
}
