import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VerifiedBadge } from '@/components/ui/verified-badge'

// Deliberately NOT wrapped in a TooltipProvider: the badge is dropped into
// cards, list rows and profile headers all over the product, and it has to
// work in every one of them without its caller knowing Radix exists.
function renderBadge(props: Parameters<typeof VerifiedBadge>[0]) {
  return render(<VerifiedBadge {...props} />)
}

describe('VerifiedBadge', () => {
  it('renders nothing at all when the identity is not verified', () => {
    const { container } = renderBadge({ verified: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('carries a text alternative, so the meaning never depends on seeing the colour', () => {
    renderBadge({ verified: true })
    expect(screen.getByRole('img', { name: 'Verified identity' })).toBeInTheDocument()
  })

  it('is reachable by keyboard, so the tooltip is not pointer-only', () => {
    renderBadge({ verified: true })
    // The Radix trigger wraps the graphic in a focusable span. A tooltip that
    // only opens on hover fails WCAG 1.4.13 for anyone navigating by keyboard.
    const trigger = screen.getByRole('img', { name: 'Verified identity' }).parentElement
    expect(trigger).toHaveAttribute('tabindex', '0')
  })

  it('drops the tooltip wrapper — but never the label — in dense contexts', () => {
    renderBadge({ verified: true, withoutTooltip: true })
    const mark = screen.getByRole('img', { name: 'Verified identity' })
    expect(mark.parentElement).not.toHaveAttribute('tabindex')
  })

  it('draws its own geometry rather than embedding a trademarked asset', () => {
    const { container } = renderBadge({ verified: true })
    const paths = container.querySelectorAll('path')
    // Two paths: the twelve-lobe disc and the check. If this ever becomes an
    // <img> or an inline copy of somebody else's mark, this fails.
    expect(paths).toHaveLength(2)
    expect(container.querySelector('img')).toBeNull()
  })
})
