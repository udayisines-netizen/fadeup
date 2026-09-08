import { describe, expect, it } from 'vitest'
import { formatDuration, formatMoney } from '@/shared/lib/format'
import { startingPrice } from '@/shared/data/discovery'
import type { ProfessionalSearchRow } from '@/shared/data/discovery'

/** M1a §10 — formatage des prix et le cas `null` (jamais un prix deviné). */

describe('formatMoney — centimes entiers uniquement', () => {
  it('formate des centimes en devise réelle', () => {
    expect(formatMoney(2500, 'EUR', 'fr').replace(/ | /g, ' ')).toContain('25')
  })
  it('un montant non entier jette en développement (euro passé pour des centimes)', () => {
    expect(() => formatMoney(25.5, 'EUR', 'fr')).toThrow()
  })
})

describe('formatDuration', () => {
  it('sous 60 minutes : minutes seules', () => {
    expect(formatDuration(45, 'fr')).toMatch(/45/)
  })
  it('60 et plus : heures + minutes, jamais « 75 min »', () => {
    const formatted = formatDuration(75, 'fr')
    expect(formatted).toMatch(/1/)
    expect(formatted).not.toMatch(/75/)
  })
})

describe('startingPrice — null n’est pas zéro', () => {
  const row = (cents: number | null, org = 'org-1') =>
    ({ starting_price_cents: cents, organization_id: org }) as ProfessionalSearchRow

  it('prix réel + devise résolue → l’objet prix', () => {
    expect(startingPrice(row(1500), { 'org-1': 'EUR' })).toEqual({ cents: 1500, currency: 'EUR' })
  })
  it('sans prix publié → null (l’UI affiche « — », jamais une estimation)', () => {
    expect(startingPrice(row(null), { 'org-1': 'EUR' })).toBeNull()
  })
  it('sans devise résolue → null (formater dans une devise devinée = donnée fabriquée)', () => {
    expect(startingPrice(row(1500), {})).toBeNull()
    expect(startingPrice(row(1500), undefined)).toBeNull()
  })
  it('un zéro COMPTÉ reste un prix affichable (0 ≠ null)', () => {
    expect(startingPrice(row(0), { 'org-1': 'EUR' })).toEqual({ cents: 0, currency: 'EUR' })
  })
})
