import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ClaimBadge } from '@/shared/ui/ClaimBadge'

describe('ClaimBadge', () => {
  it('unclaimed : ton neutre — aucun rouge, aucune icône d’alerte', () => {
    const { container } = render(<ClaimBadge state="unclaimed" />)
    const badge = container.querySelector('[data-state="unclaimed"]')
    expect(badge).not.toBeNull()
    expect(badge?.className).not.toMatch(/danger|warn|state-danger/)
    // Pas d'icône du tout sur unclaimed — le texte seul, transparent.
    expect(badge?.querySelector('svg')).toBeNull()
    expect(screen.getByText(/not yet managed on fadeup/i)).toBeInTheDocument()
  })

  it('claimed et verified sont deux traitements distincts', () => {
    const { container: claimed } = render(<ClaimBadge state="claimed" />)
    const { container: verified } = render(<ClaimBadge state="verified" />)
    // Verified porte l'icône ; claimed non.
    expect(claimed.querySelector('svg')).toBeNull()
    expect(verified.querySelector('svg')).not.toBeNull()
  })
})
