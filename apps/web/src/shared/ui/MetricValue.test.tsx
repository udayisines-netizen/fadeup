import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricValue, type MetricValueProps } from '@/shared/ui/MetricValue'

const KINDS: MetricValueProps['kind'][] = ['followers', 'verified-clients', 'rating', 'reviews', 'likes']

describe('MetricValue', () => {
  it('les cinq métriques ont cinq rendus distincts (libellé + icône)', () => {
    const labels = new Set<string>()
    const icons = new Set<string>()
    for (const kind of KINDS) {
      const { container, unmount } = render(<MetricValue kind={kind} value={kind === 'rating' ? 4.8 : 12} />)
      const root = container.querySelector(`[data-kind="${kind}"]`)
      expect(root).not.toBeNull()
      labels.add(root?.textContent ?? '')
      // L'icône lucide expose sa classe propre — cinq icônes différentes.
      icons.add(container.querySelector('svg')?.getAttribute('class') ?? '')
      unmount()
    }
    expect(labels.size).toBe(5)
    expect(icons.size).toBe(5)
  })

  it('null produit un état vide honnête, jamais un zéro fabriqué', () => {
    const { container } = render(<MetricValue kind="followers" value={null} />)
    expect(container.textContent).not.toMatch(/\b0\b/)
    expect(container.textContent).toContain('—')
  })

  it('followers utilise la notation compacte', () => {
    const { container } = render(<MetricValue kind="followers" value={1247} />)
    expect(container.textContent).toMatch(/1[.,]2\s*[kK]/)
  })
})
