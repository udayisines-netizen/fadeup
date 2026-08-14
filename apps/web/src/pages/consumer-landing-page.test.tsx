import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsumerLandingPage } from '@/pages/consumer-landing-page'
import { useSearchPublicProfessionals } from '@/lib/queries/marketplace'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/lib/queries/marketplace', () => ({ useSearchPublicProfessionals: vi.fn() }))

const mockSearch = vi.mocked(useSearchPublicProfessionals)

function resolved(data: unknown) {
  return { data, isPending: false, isError: false, error: null } as never
}

const BARBER = {
  entityType: 'barber' as const,
  organizationId: 'org-1',
  organizationName: 'Fade City',
  organizationSlug: 'fade-city',
  barberId: 'b-1',
  barberDisplayName: 'Yanis Bouzid',
  barberAvatarUrl: null,
  barberTitle: 'Skin fades & beard work',
  locationId: 'loc-1',
  locationName: 'Combs',
  addressLine1: null,
  city: 'Combs',
  region: null,
  postalCode: '77380',
  country: 'FR',
  distanceKm: null,
  startingPriceCents: null,
  isOpenNow: null,
  queueWaitingCount: 0,
  totalCount: 1,
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ConsumerLandingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ConsumerLandingPage — "/" helps someone find a barber', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockSearch.mockReturnValue(resolved([BARBER]))
  })

  it('leads with discovery, not with a software pitch', () => {
    renderPage()

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toContain('Find the barber')
    expect(heading.textContent).toContain('who gets your cut.')
  })

  it('makes search the primary action and encodes it into a shareable URL', () => {
    renderPage()

    const [whereInput] = screen.getAllByPlaceholderText('City or postal code')
    fireEvent.change(whereInput!, { target: { value: 'Combs' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Find a barber' })[0]!)

    expect(mockNavigate).toHaveBeenCalledWith('/search?city=Combs')
  })

  it('carries a free-text query through to the results page', () => {
    renderPage()

    const [whatInput] = screen.getAllByPlaceholderText('Barber, shop or service')
    fireEvent.change(whatInput!, { target: { value: 'skin fade' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Find a barber' })[0]!)

    expect(mockNavigate).toHaveBeenCalledWith('/search?q=skin+fade')
  })

  it('shows real marketplace professionals, linked to their public profile', () => {
    renderPage()

    expect(screen.getByText('Yanis Bouzid')).toBeInTheDocument()
    expect(screen.getByText('Skin fades & beard work')).toBeInTheDocument()
    const profileLink = screen.getByRole('link', { name: /Yanis Bouzid/ })
    expect(profileLink).toHaveAttribute('href', '/s/fade-city/profile')
  })

  it('says so honestly when no shop nearby has published yet', () => {
    // Never fill the section with plausible-looking strangers — an empty
    // marketplace is a real state, and inventing barbers to hide it would be
    // the one thing this page must not do.
    mockSearch.mockReturnValue(resolved([]))

    renderPage()

    expect(screen.getByText('FadeUp is opening city by city.')).toBeInTheDocument()
    expect(screen.queryByText('Yanis Bouzid')).not.toBeInTheDocument()
  })

  it('introduces Fade Passport as something the customer owns', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'FadeUp remembers your cut.' })).toBeInTheDocument()
  })

  it('labels every illustrative surface so it cannot read as live data', () => {
    renderPage()

    // The Passport and rebook panels are pictures of the product, not results.
    expect(screen.getAllByText('Product illustration').length).toBeGreaterThanOrEqual(2)
  })

  it('ends by returning the visitor to discovery, not to a B2B pitch', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Find your barber.' })).toBeInTheDocument()
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^\/pro\//)
    }
  })
})
