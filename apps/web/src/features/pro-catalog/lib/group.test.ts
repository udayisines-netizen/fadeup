import { describe, expect, it } from 'vitest'
import { groupByCategory } from './group'

interface Row {
  id: string
  category_id: string | null
  category_name: string | null
}

const row = (id: string, categoryId: string | null, categoryName: string | null): Row => ({
  id,
  category_id: categoryId,
  category_name: categoryName,
})

describe('groupByCategory', () => {
  it('un catalogue vide ne produit aucun groupe', () => {
    expect(groupByCategory([])).toEqual([])
  })

  it('groupe par catégorie et range les catégories par nom', () => {
    const groups = groupByCategory([
      row('a', 'c2', 'Coloration'),
      row('b', 'c1', 'Barbe'),
      row('c', 'c2', 'Coloration'),
    ])
    expect(groups.map((g) => g.categoryName)).toEqual(['Barbe', 'Coloration'])
    expect(groups[1]?.services.map((s) => s.id)).toEqual(['a', 'c'])
  })

  it("préserve l'ordre du serveur à l'intérieur d'un groupe", () => {
    const groups = groupByCategory([row('z', 'c1', 'Barbe'), row('a', 'c1', 'Barbe')])
    expect(groups[0]?.services.map((s) => s.id)).toEqual(['z', 'a'])
  })

  it('met les services sans catégorie en dernier', () => {
    const groups = groupByCategory([row('a', null, null), row('b', 'c1', 'Barbe')])
    expect(groups.map((g) => g.categoryId)).toEqual(['c1', null])
    expect(groups[1]?.categoryName).toBeNull()
  })

  it('un seul groupe quand aucun service n’est classé', () => {
    const groups = groupByCategory([row('a', null, null), row('b', null, null)])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.categoryId).toBeNull()
    expect(groups[0]?.services).toHaveLength(2)
  })

  it('une catégorie dont le nom manque ne coiffe pas un bloc vide de sens', () => {
    const groups = groupByCategory([row('a', 'orphan', null), row('b', 'c1', 'Barbe')])
    expect(groups.map((g) => g.categoryId)).toEqual(['c1', null])
    expect(groups[1]?.services.map((s) => s.id)).toEqual(['a'])
  })

  it('le tri des catégories ignore la casse et les accents', () => {
    const groups = groupByCategory([row('a', 'c1', 'Épilation'), row('b', 'c2', 'coupe')])
    expect(groups.map((g) => g.categoryName)).toEqual(['coupe', 'Épilation'])
  })
})
