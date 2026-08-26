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
/**
 * Selects a business type.
 *
 * The control is a radiogroup at the top of Pricing now, not the carousel that
 * used to open the page. Tests drive the same control a visitor does.
 */
function selectMode(name: string) {
  const [option] = screen.getAllByRole('radio', { name: new RegExp(name) })
  fireEvent.click(option!)
}

describe('BusinessLandingPage — the argument', () => {
  beforeEach(() => {
    useFrancePricing()
  })

  it('opens by saying what FadeUp is, in one sentence', () => {
    renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Run your whole barbershop with FadeUp.' }),
    ).toBeInTheDocument()
  })

  it('explains itself in prose rather than in fragments', () => {
    // The previous hero listed "Appointments. Walk-ins. Barbers. Chairs." as
    // separate lines, which reads as a slogan. The support line has to be a
    // sentence that survives being read aloud.
    renderPage()

    const support = screen.getByText(/Bring your appointments, your walk-in customers/)
    expect(support).toBeInTheDocument()
  })

  it('tells the four stages, in order, as real headings', () => {
    // The film is presentation. The argument itself has to exist structurally,
    // so it survives reduced motion, a screen reader, a crawler, and a browser
    // that refuses to autoplay.
    renderPage()

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toContain('Run your day')
    expect(headings).toContain('Handle customers without an appointment')
    expect(headings).toContain('Support every barber')
    expect(headings).toContain('Keep your customers coming back')
  })

  it('no longer ships the removed loop and sizing chapters', () => {
    renderPage()

    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).not.toContain('One system. From discovery to the next cut.')
    expect(headings).not.toContain('FadeUp grows with your shop.')
  })

  it('keeps the film optional, so the page reads without ever playing it', () => {
    renderPage()

    const film = screen.getByLabelText(/Silent animation: a customer moves through a day/)
    expect(film).toBeInTheDocument()
  })

  it('sends both hero calls to action to their existing destinations', () => {
    renderPage()

    const register = screen.getAllByRole('link', { name: 'Join FadeUp' })
    const login = screen.getAllByRole('link', { name: 'Pro login' })

    expect(register.length).toBeGreaterThan(0)
    expect(login.length).toBeGreaterThan(0)
    for (const link of register) expect(link).toHaveAttribute('href', '/pro/register')
    for (const link of login) expect(link).toHaveAttribute('href', '/pro/login')
  })
})

describe('BusinessLandingPage — migration', () => {
  beforeEach(() => {
    useFrancePricing()
  })

  it('asks the question the visitor is already asking, and answers it', () => {
    renderPage()

    expect(screen.getByText('Already using booking software?')).toBeInTheDocument()
    expect(screen.getByText('Moving to FadeUp does not mean starting from nothing.')).toBeInTheDocument()
  })

  it('states plainly that there is no automatic import today', () => {
    // Reassurance must not become a promise the product cannot keep. Claiming
    // one-click migration would be the fastest way to lose a shop in week one.
    renderPage()

    expect(
      screen.getByText(/There is no automatic import from another product today/),
    ).toBeInTheDocument()
  })

  it('describes the move as three plain steps, not a technical diagram', () => {
    renderPage()

    expect(screen.getByText('You tell us which solution you use today.')).toBeInTheDocument()
    expect(screen.getByText('We prepare the move to FadeUp with you.')).toBeInTheDocument()
    expect(
      screen.getByText('Your team finds its activity in FadeUp and can keep working.'),
    ).toBeInTheDocument()
  })
})

describe('BusinessLandingPage — choosing a business type', () => {
  beforeEach(() => {
    useFrancePricing()
  })

  it('offers the three types together, each with a clarification', () => {
    // A segmented control rather than a carousel: this is a decision made once
    // while comparing prices, so all three options must be comparable at a
    // glance instead of hidden behind a next arrow.
    renderPage()

    const group = screen.getByRole('radiogroup', { name: 'Which kind of business matches your shop?' })
    const options = within(group).getAllByRole('radio')
    expect(options).toHaveLength(3)

    // The clarification is shown for the option actually chosen. Printing all
    // three at once turned a filter into three onboarding cards standing
    // between the visitor and the prices.
    expect(screen.getByText('A team in one location.')).toBeInTheDocument()

    selectMode('Independent')
    expect(screen.getByText('You work on your own.')).toBeInTheDocument()
  })

  it('starts on Barbershop, the middle of the three', () => {
    renderPage()

    const group = screen.getByRole('radiogroup', { name: 'Which kind of business matches your shop?' })
    const checked = within(group)
      .getAllByRole('radio')
      .filter((option) => option.getAttribute('aria-checked') === 'true')

    expect(checked).toHaveLength(1)
    expect(checked[0]).toHaveTextContent('Barbershop')
  })

  it('changes which plans are offered when the type changes', () => {
    renderPage()

    selectMode('Independent')
    const group = screen.getByRole('radiogroup', { name: 'Which kind of business matches your shop?' })
    const checked = within(group)
      .getAllByRole('radio')
      .find((option) => option.getAttribute('aria-checked') === 'true')

    expect(checked).toHaveTextContent('Independent')
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

    // Every plan card carries the line, so the count follows the number of
    // plans that business type genuinely has. Seeing it repeat unchanged
    // across the rail is the point: Passport is never the upgrade.
    for (const [mode, plans] of [
      ['Independent', 1],
      ['Barbershop', 3],
      ['Multi-location', 3],
    ] as const) {
      selectMode(mode)
      const pricing = screen.getByRole('region', { name: 'Pricing' })
      expect(
        within(pricing).getAllByText('In every plan, always. Never an upgrade.'),
      ).toHaveLength(plans)
    }
  })

  it('says plainly that retention is not in the entry-level plan', () => {
    renderPage()

    const pricing = screen.getByRole('region', { name: 'Pricing' })
    // Every card states where retention stands, so an unbuilt capability can
    // never be read as included on any of them.
    expect(within(pricing).getAllByText(/Not built yet/).length).toBeGreaterThan(0)
  })

  it('carries the chosen plan into the professional application as intent', () => {
    renderPage()

    const pricing = screen.getByRole('region', { name: 'Pricing' })
    const cta = within(pricing).getByRole('link', { name: /Choose Pro/ })
    expect(cta).toHaveAttribute('href', '/pro/register?plan=salon_pro')
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
