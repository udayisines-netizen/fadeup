import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BusinessLandingPage } from '@/pages/business-landing-page'
import { useFadeUpPricing } from '@/lib/commerce/pricing-context'
import { SCENE_IDS } from '@/components/marketing/product-stage'

vi.mock('@/lib/commerce/pricing-context', () => ({ useFadeUpPricing: vi.fn() }))

const mockPricing = vi.mocked(useFadeUpPricing)

function renderPage() {
  return render(
    <MemoryRouter>
      <BusinessLandingPage />
    </MemoryRouter>,
  )
}

describe('BusinessLandingPage — the product story', () => {
  beforeEach(() => {
    mockPricing.mockReturnValue({
      region: 'eu',
      pricing: { region: 'eu', currency: 'EUR', monthlyAmountMinor: 4900, formatLocale: 'fr-FR' },
      isResolved: true,
      formattedMonthly: '€49',
    })
  })

  it('leads with running the shop, not with a feature list', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Run the whole shop.' })).toBeInTheDocument()
  })

  it('tells the whole operating loop, in order, as real headings', () => {
    // The scroll animation is presentation. The argument itself has to exist
    // structurally, so it survives reduced motion, a screen reader and a
    // crawler.
    renderPage()

    const expected = [
      'Your day, already organised.',
      'But your shop is not only appointments.',
      'Walk in. Not wait around.',
      'The chair that frees up first.',
      'FadeUp works while you work.',
      'Remember the cut.',
      'Turn a cut into a customer.',
      'See the whole floor.',
      'Today first. Everything else after.',
      'Your barbers, your chairs, your rules.',
      'Meet the next ones.',
      'Found by city, service or name.',
      'Back in the chair.',
    ]

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    for (const title of expected) {
      expect(headings, `missing scene: ${title}`).toContain(title)
    }
    expect(expected).toHaveLength(SCENE_IDS.length)
  })

  it('closes the loop and names every stage of it', () => {
    renderPage()

    const heading = screen.getByRole('heading', { name: 'One system. From discovery to the next cut.' })
    // Scoped to the loop's own list: words like "Barber" legitimately appear
    // elsewhere on the page (a role in the team stage, for one).
    const loopSection = heading.closest('section')!
    const steps = within(loopSection).getByRole('list')

    for (const step of ['Discover', 'Book or queue', 'Barber', 'Chair', 'Passport', 'Rebook']) {
      expect(within(steps).getByText(step)).toBeInTheDocument()
    }
  })

  it('positions against existing booking software without attacking it', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Good. Your calendar is already digital.' })).toBeInTheDocument()
    expect(screen.getByText(/no automatic import today/i)).toBeInTheDocument()
  })

  it('shows only business types the product actually supports', () => {
    renderPage()

    for (const type of ['Independent barber', 'Private studio', 'Barbershop', 'Multi-location']) {
      expect(screen.getByText(type)).toBeInTheDocument()
    }
  })

  it('takes the price from the commercial pricing source, never from the page', () => {
    renderPage()

    expect(screen.getByText('€49')).toBeInTheDocument()
    expect(screen.getByText('per month')).toBeInTheDocument()
  })

  it('shows the currency of the visitor REGION, not of their language', () => {
    // A French-reading visitor in the United States is billed in USD. Language
    // chooses words; geography chooses money.
    mockPricing.mockReturnValue({
      region: 'us',
      pricing: { region: 'us', currency: 'USD', monthlyAmountMinor: 5400, formatLocale: 'en-US' },
      isResolved: true,
      formattedMonthly: '$54',
    })

    renderPage()

    expect(screen.getByText('$54')).toBeInTheDocument()
    expect(screen.queryByText('€49')).not.toBeInTheDocument()
  })

  it('shows no price at all until the region is known, rather than guessing', () => {
    mockPricing.mockReturnValue({
      region: 'intl',
      pricing: { region: 'intl', currency: 'EUR', monthlyAmountMinor: 4900, formatLocale: 'en-150' },
      isResolved: false,
      formattedMonthly: '€49',
    })

    renderPage()

    expect(screen.getByText('Checking your region…')).toBeInTheDocument()
    expect(screen.queryByText('€49')).not.toBeInTheDocument()
  })

  it('sends professionals to the professional entrances only', () => {
    renderPage()

    const proLinks = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => /login|register/.test(href))

    expect(proLinks.length).toBeGreaterThan(0)
    for (const href of proLinks) {
      expect(href).toMatch(/^\/pro\/(login|register)$/)
    }
    // The legacy alias must not come back.
    expect(proLinks).not.toContain('/pro/signup')
  })

  it('markets nothing the product does not have yet', () => {
    // Wallet, loyalty, payments, commissions and inventory are unbuilt lots.
    renderPage()

    const body = document.body.textContent ?? ''
    for (const unbuilt of ['Wallet', 'Loyalty', 'Referral', 'Commission', 'Inventory', 'Payments']) {
      expect(body, `page claims unbuilt feature: ${unbuilt}`).not.toContain(unbuilt)
    }
  })

  it('invents no statistics', () => {
    renderPage()

    const body = document.body.textContent ?? ''
    expect(body).not.toMatch(/\d+\s?% (more|increase|growth|revenue)/i)
    expect(body).not.toMatch(/\d[\d,.]* (shops|barbers|customers) (use|trust|joined)/i)
  })

  it('labels the product stage as an illustration wherever it appears', () => {
    renderPage()

    const captions = screen.getAllByText('Product illustration')
    expect(captions.length).toBeGreaterThanOrEqual(SCENE_IDS.length)
  })

  it('keeps the stage out of the accessibility tree, since the prose already says it', () => {
    const { container } = renderPage()

    const stages = container.querySelectorAll('[aria-hidden="true"]')
    expect(stages.length).toBeGreaterThan(0)

    // The narrative headings are NOT hidden — the story stays readable.
    const firstScene = screen.getByRole('heading', { name: 'Your day, already organised.' })
    expect(within(firstScene).queryByText('aria-hidden')).toBeNull()
    expect(firstScene.closest('[aria-hidden="true"]')).toBeNull()
  })
})
