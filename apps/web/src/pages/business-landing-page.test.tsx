import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BusinessLandingPage } from '@/pages/business-landing-page'
import { useFadeUpPricing } from '@/lib/commerce/pricing-context'
import { planPriceMinor, formatPlanPrice } from '@/lib/commerce/pricing'
import type { PlanId } from '@/lib/commerce/plans'

vi.mock('@/lib/commerce/pricing-context', () => ({ useFadeUpPricing: vi.fn() }))

const mockPricing = vi.mocked(useFadeUpPricing)

function renderPage() {
  return render(
    <MemoryRouter>
      <BusinessLandingPage />
    </MemoryRouter>,
  )
}

/** Puts the page in the France commercial region, which is the reference catalog. */
function useFrancePricing() {
  mockPricing.mockReturnValue({
    region: 'eu',
    currency: 'EUR',
    isResolved: true,
    formatPlan: (planId: PlanId) => formatPlanPrice(planId, 'eu', 'en'),
    planMinor: (planId: PlanId) => planPriceMinor(planId, 'eu'),
  })
}

/** Steps the mode selector to a named business type. */
function selectMode(name: string) {
  // The dots jump straight to a mode and are labelled with its name — the same
  // control a visitor uses, rather than a test-only hook.
  const [dot] = screen.getAllByRole('button', { name })
  fireEvent.click(dot!)
}

describe('BusinessLandingPage — the first question', () => {
  beforeEach(() => {
    useFrancePricing()
  })

  it('leads by asking what kind of business you run', () => {
    renderPage()

    const selectors = screen.getAllByRole('group', { name: 'Choose the kind of business you run' })
    expect(selectors.length).toBeGreaterThan(0)
  })

  it('starts on Barbershop, the middle of the three', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Run the whole shop.' })).toBeInTheDocument()
  })

  it('rewrites the headline when the business type changes', () => {
    renderPage()

    selectMode('Independent')
    expect(screen.getByRole('heading', { level: 1, name: 'Run your whole book.' })).toBeInTheDocument()

    selectMode('Multi-location')
    expect(screen.getByRole('heading', { level: 1, name: 'Run every shop.' })).toBeInTheDocument()
  })

  it('offers previous and next as real buttons, not only a swipe', () => {
    renderPage()

    expect(screen.getAllByRole('button', { name: 'Previous business type' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Next business type' }).length).toBeGreaterThan(0)
  })

  it('loops forward through all three modes and back to the start', () => {
    renderPage()

    const [next] = screen.getAllByRole('button', { name: 'Next business type' })
    fireEvent.click(next!)
    expect(screen.getByRole('heading', { level: 1, name: 'Run every shop.' })).toBeInTheDocument()

    fireEvent.click(next!)
    expect(screen.getByRole('heading', { level: 1, name: 'Run your whole book.' })).toBeInTheDocument()

    fireEvent.click(next!)
    expect(screen.getByRole('heading', { level: 1, name: 'Run the whole shop.' })).toBeInTheDocument()
  })

  it('loops backwards too', () => {
    renderPage()

    const [previous] = screen.getAllByRole('button', { name: 'Previous business type' })
    fireEvent.click(previous!)
    expect(screen.getByRole('heading', { level: 1, name: 'Run your whole book.' })).toBeInTheDocument()
  })
})

describe('BusinessLandingPage — the product story', () => {
  beforeEach(() => {
    useFrancePricing()
  })

  it('tells the whole operating loop, in order, as real headings', () => {
    // The scroll animation is presentation. The argument itself has to exist
    // structurally, so it survives reduced motion, a screen reader and a
    // crawler.
    renderPage()

    const expected = [
      'Your day, already laid out.',
      'A slot fills itself.',
      'Your shop is not only appointments.',
      "Walk in. Don't wait around.",
      'The chair that frees up first.',
      'FadeUp works while you work.',
      'Remember the cut.',
      'Turn a cut into a regular.',
      'Pro is what brings them back.',
      'Today first. Settings after.',
      'Your barbers, your chairs, your rules.',
      'Meet the next ones.',
      'Found by city, service or name.',
      'Back in the chair.',
    ]

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    for (const title of expected) {
      expect(headings, `missing scene: ${title}`).toContain(title)
    }
  })

  it('retells the story differently for a barber working alone', () => {
    renderPage()
    selectMode('Independent')

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)

    // The beats that only make sense with a floor are rewritten...
    expect(headings).toContain('There is only one chair.')
    expect(headings).toContain('Your book, your rules.')
    expect(headings).not.toContain('The chair that frees up first.')

    // ...and the one that makes no sense at all is simply absent. A solo barber
    // does not scroll through a staff-management chapter to reach the pricing.
    expect(headings).not.toContain('Your barbers, your chairs, your rules.')
  })

  it('expands the world again for a multi-location business', () => {
    renderPage()
    selectMode('Multi-location')

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toContain('Every shop, one morning.')
    expect(headings).toContain('A team per shop.')
    expect(headings).toContain('Every floor, one console.')
  })

  it('marks the retention chapter as unbuilt inside the story itself', () => {
    // A visitor must not reach the pricing table and discover that something
    // they just watched does not exist yet.
    renderPage()

    expect(screen.getAllByText('On the roadmap').length).toBeGreaterThan(0)
  })
})

describe('BusinessLandingPage — pricing', () => {
  beforeEach(() => {
    useFrancePricing()
  })

  it('shows the three barbershop plans at the France reference prices', () => {
    renderPage()

    const pricing = screen.getByRole('region', { name: 'Pricing' })
    expect(within(pricing).getByText('€29')).toBeInTheDocument()
    expect(within(pricing).getByText('€49')).toBeInTheDocument()
    expect(within(pricing).getByText('€79')).toBeInTheDocument()
  })

  it('shows one plan, at 19 €, for an independent barber', () => {
    renderPage()
    selectMode('Independent')

    const pricing = screen.getByRole('region', { name: 'Pricing' })
    expect(within(pricing).getByText('€19')).toBeInTheDocument()
    expect(within(pricing).queryByText('€49')).not.toBeInTheDocument()
    expect(within(pricing).queryByText('€79')).not.toBeInTheDocument()
  })

  it('shows the multi-location ladder at 99, 149 and 249 €', () => {
    renderPage()
    selectMode('Multi-location')

    const pricing = screen.getByRole('region', { name: 'Pricing' })
    expect(within(pricing).getByText('€99')).toBeInTheDocument()
    expect(within(pricing).getByText('€149')).toBeInTheDocument()
    expect(within(pricing).getByText('€249')).toBeInTheDocument()
  })

  it('never paywalls Fade Passport, in any mode', () => {
    renderPage()

    for (const mode of ['Independent', 'Barbershop', 'Multi-location']) {
      selectMode(mode)
      const pricing = screen.getByRole('region', { name: 'Pricing' })
      expect(within(pricing).getByText('In every plan, always. Never an upgrade.')).toBeInTheDocument()
    }
  })

  it('says plainly that retention is not in the entry-level plan', () => {
    renderPage()

    const pricing = screen.getByRole('region', { name: 'Pricing' })
    // Pro is expanded by default, and it is the plan that packages retention.
    expect(within(pricing).getByText(/Not built yet/)).toBeInTheDocument()
  })

  it('carries the chosen plan into the professional application as intent', () => {
    renderPage()

    const pricing = screen.getByRole('region', { name: 'Pricing' })
    const cta = within(pricing).getByRole('link', { name: /Choose Pro/ })
    expect(cta).toHaveAttribute('href', '/pro/register?plan=shop_pro')
  })

  it('sends every professional CTA to the canonical registration path', () => {
    renderPage()

    for (const link of screen.getAllByRole('link', { name: /Join FadeUp/ })) {
      expect(link).toHaveAttribute('href', '/pro/register')
    }
    for (const link of screen.getAllByRole('link', { name: 'Pro login' })) {
      expect(link).toHaveAttribute('href', '/pro/login')
    }
    // The legacy path must not come back through a copy-paste.
    expect(screen.queryByRole('link', { name: /\/pro\/signup/ })).not.toBeInTheDocument()
  })
})

describe('BusinessLandingPage — the comparison', () => {
  beforeEach(() => {
    useFrancePricing()
  })

  it('keeps the detailed table behind a disclosure rather than in the first viewport', () => {
    renderPage()

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /See what changes between plans/ })).toBeInTheDocument()
  })

  it('marks unbuilt capabilities as coming, never as included', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /See what changes between plans/ }))

    const table = screen.getByRole('table')
    const retentionRow = within(table).getByRole('row', { name: /Return-cycle detection/ })

    // Pro and Business package retention, so those cells say "Coming" — and
    // critically, none of them says "Included".
    expect(within(retentionRow).getAllByText('Coming').length).toBe(2)
    expect(within(retentionRow).queryByText('Included')).not.toBeInTheDocument()
  })

  it('shows Fade Passport as included in every column', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /See what changes between plans/ }))

    const table = screen.getByRole('table')
    const passportRow = within(table).getByRole('row', { name: /Fade Passport/ })
    expect(within(passportRow).getAllByText('Included').length).toBe(3)
  })
})
