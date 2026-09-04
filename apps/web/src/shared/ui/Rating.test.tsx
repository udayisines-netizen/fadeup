import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Rating } from '@/shared/ui/Rating'

describe('Rating', () => {
  it('null affiche « pas encore d’avis » — JAMAIS zéro étoile', () => {
    const { container } = render(<Rating value={null} />)
    expect(screen.getByText(/no reviews yet/i)).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).not.toMatch(/0/)
  })

  it('une note réelle affiche la valeur et le compte', () => {
    render(<Rating value={4.8} count={127} />)
    expect(screen.getByText('4.8')).toBeInTheDocument()
    expect(screen.getByText(/127/)).toBeInTheDocument()
  })

  it('porte un libellé accessible complet', () => {
    render(<Rating value={4.8} showCount={false} />)
    expect(screen.getByLabelText(/4\.8.*5/)).toBeInTheDocument()
  })
})
