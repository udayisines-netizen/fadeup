import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Money } from '@/shared/ui/Money'
import { formatMoney } from '@/shared/lib/format'

describe('Money', () => {
  it('lève en développement sur une valeur non entière (garde price_cents)', () => {
    expect(() => formatMoney(35.5, 'EUR', 'fr')).toThrow(/integer cents/)
  })

  it('lève aussi sur un montant en euros passé par erreur (35.0 passe, 35,5 non)', () => {
    // 35 entiers = 0,35 € : silencieux par nature, mais 35.5 est le symptôme
    // détectable — la garde attrape ce cas.
    expect(() => formatMoney(2500.75, 'EUR', 'fr')).toThrow()
  })

  it('formate en FR (symbole après, virgule)', () => {
    expect(formatMoney(2500, 'EUR', 'fr')).toMatch(/25,00\s*€/)
  })

  it('formate en EN (symbole avant, point)', () => {
    expect(formatMoney(2500, 'EUR', 'en')).toMatch(/€\s*25\.00/)
  })

  it('rend « à partir de » quand from est posé', () => {
    render(<Money cents={2500} currency="EUR" locale="en" from />)
    expect(screen.getByText(/from/i)).toBeInTheDocument()
  })
})
