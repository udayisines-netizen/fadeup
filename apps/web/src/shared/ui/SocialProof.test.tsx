import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SocialProof } from '@/shared/ui/SocialProof'

describe('SocialProof — cinq métriques distinctes, états vides honnêtes', () => {
  it('rend TOUJOURS les cinq métriques, chacune identifiable', () => {
    render(<SocialProof followers={12} verifiedClients={null} rating={null} reviews={null} likes={null} />)
    const block = screen.getByTestId('social-proof')
    const kinds = [...block.querySelectorAll('[data-kind]')].map((el) => el.getAttribute('data-kind'))
    expect(kinds).toEqual(['followers', 'verified-clients', 'rating', 'reviews', 'likes'])
  })

  it('une donnée absente rend « — », jamais un zéro fabriqué', () => {
    render(<SocialProof followers={null} verifiedClients={null} rating={null} reviews={null} likes={null} />)
    const block = screen.getByTestId('social-proof')
    expect(within(block).getAllByText('—')).toHaveLength(5)
    expect(block.textContent).not.toMatch(/\b0\b/)
  })

  it('les icônes des cinq métriques sont toutes différentes', () => {
    render(<SocialProof followers={1} verifiedClients={2} rating={4.5} reviews={3} likes={4} />)
    const block = screen.getByTestId('social-proof')
    const paths = [...block.querySelectorAll('[data-kind]')].map(
      (el) => el.querySelector('svg')?.innerHTML ?? '',
    )
    expect(new Set(paths).size).toBe(5)
  })
})
