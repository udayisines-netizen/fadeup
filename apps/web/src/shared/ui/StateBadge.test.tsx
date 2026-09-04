import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StateBadge, type FadeUpState } from '@/shared/ui/StateBadge'

const ALL: FadeUpState[] = [
  'bookable',
  'not-bookable',
  'available',
  'unavailable',
  'pending-request',
  'confirmed',
  'queue-open',
  'queue-full',
  'queue-closed',
  'called',
  'missed',
  'offline',
  'reconnecting',
  'partial-data',
]

describe('StateBadge', () => {
  it('chaque état porte un libellé traduit ET une forme — jamais la couleur seule', () => {
    for (const state of ALL) {
      const { container, unmount } = render(<StateBadge state={state} />)
      const badge = container.querySelector(`[data-state="${state}"]`)
      expect(badge?.textContent?.trim()).toBeTruthy()
      // Une forme en complément : icône svg ou point « live ».
      expect(badge?.querySelector('svg, span[aria-hidden]')).not.toBeNull()
      unmount()
    }
  })

  it('pending-request ne suggère JAMAIS une confirmation', () => {
    render(<StateBadge state="pending-request" />)
    expect(screen.getByText(/awaiting confirmation/i)).toBeInTheDocument()
    expect(screen.queryByText(/^booked$|^confirmed$/i)).toBeNull()
  })
})
