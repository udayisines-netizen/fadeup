/**
 * OS-2 — le regroupement du catalogue par catégorie.
 *
 * `list_organization_services` rend les lignes triées
 * (`archived_at nulls first, name`) mais À PLAT : le regroupement est un
 * choix de présentation, donc il vit ici, pur et testé.
 *
 * Règles : les catégories nommées d'abord, dans l'ordre alphabétique de leur
 * nom (stable quelle que soit la ligne rencontrée en premier) ; les services
 * SANS catégorie forment le dernier groupe. L'ordre des services à
 * l'intérieur d'un groupe est celui du serveur — on ne le retrie pas.
 */

export interface CategorizedRow {
  category_id: string | null
  category_name: string | null
}

export interface CatalogGroup<T extends CategorizedRow> {
  /** `null` pour le groupe « sans catégorie ». */
  categoryId: string | null
  /** `null` pour le groupe « sans catégorie » — la page met le libellé i18n. */
  categoryName: string | null
  services: T[]
}

export function groupByCategory<T extends CategorizedRow>(rows: readonly T[]): CatalogGroup<T>[] {
  const named = new Map<string, CatalogGroup<T>>()
  const uncategorized: T[] = []

  for (const row of rows) {
    // Une catégorie dont le nom manque (jointure orpheline) n'est pas une
    // catégorie affichable : la ligne rejoint « sans catégorie » plutôt que
    // de coiffer un bloc vide de sens.
    if (row.category_id === null || row.category_name === null) {
      uncategorized.push(row)
      continue
    }
    const existing = named.get(row.category_id)
    if (existing) {
      existing.services.push(row)
    } else {
      named.set(row.category_id, { categoryId: row.category_id, categoryName: row.category_name, services: [row] })
    }
  }

  const groups = [...named.values()].sort((a, b) =>
    (a.categoryName ?? '').localeCompare(b.categoryName ?? '', undefined, { sensitivity: 'base' }),
  )

  if (uncategorized.length > 0) {
    groups.push({ categoryId: null, categoryName: null, services: uncategorized })
  }

  return groups
}
