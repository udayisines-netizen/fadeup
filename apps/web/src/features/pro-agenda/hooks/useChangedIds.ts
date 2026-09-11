import { useEffect, useRef } from 'react'

/**
 * OS-1 — « les listes n'animent que l'élément modifié ». Compare la
 * signature de chaque ligne à celle du rendu précédent : ce qui est NOUVEAU
 * ou CHANGÉ reçoit un jeton d'animation (l'élément se remonte avec une clé
 * différente, la classe CSS rejoue) ; le reste ne bouge pas. Le premier
 * chargement n'anime rien, ni le premier rendu d'une nouvelle fenêtre.
 */
export function useChangedIds<T extends { id: string }>(
  rows: readonly T[],
  signature: (row: T) => string,
  /**
   * La fenêtre observée (jour / semaine). Quand elle change, la comparaison
   * repart de zéro : la navigation entre jours n'anime RIEN (contrat §5) —
   * seul un changement à fenêtre constante (realtime, geste) le fait.
   */
  scope = '',
  /**
   * `false` tant que les lignes sont une donnée de SUBSTITUTION (la fenêtre
   * précédente gardée à l'écran pendant le chargement) : elles ne servent ni
   * de référence ni de cible — sinon l'arrivée du nouveau jour animerait tout.
   */
  ready = true,
): Map<string, string> {
  const previous = useRef<Map<string, string> | null>(null)
  const previousScope = useRef(scope)
  const tokens = useRef(new Map<string, string>())
  const current = new Map(rows.map((row) => [row.id, signature(row)]))
  if (previousScope.current !== scope) {
    previousScope.current = scope
    previous.current = null
    tokens.current.clear()
  }

  const changed = new Map<string, string>()
  if (ready && previous.current !== null) {
    for (const [id, sig] of current) {
      const before = previous.current.get(id)
      if (before !== sig) {
        // Jeton stable par changement : la signature elle-même.
        tokens.current.set(id, `${before === undefined ? 'in' : 'up'}:${sig}`)
      }
    }
    for (const [id, token] of tokens.current) {
      if (current.has(id)) changed.set(id, token)
      else tokens.current.delete(id)
    }
  }

  useEffect(() => {
    if (ready) previous.current = current
  })

  return changed
}
