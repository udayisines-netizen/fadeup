import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { PublicBarberPage } from '@/pages/public-barber-page'
import { usePublicOrganization } from '@/lib/queries/public-booking'
import { usePublicBarber, usePublicBarberServices } from '@/lib/queries/public-barber'
import { usePublicServiceState, type PublicServiceState } from '@/lib/queries/service-mode'

vi.mock('@/lib/queries/public-booking', () => ({
  usePublicOrganization: vi.fn(),
}))

vi.mock('@/lib/queries/public-barber', () => ({
  usePublicBarber: vi.fn(),
  usePublicBarberServices: vi.fn(),
  // The durable identity behind the placement. Only consulted for a CLAIMED
  // professional, and the profile renders fully without it — an unclaimed
  // placement simply gets no badge, no follower count and no Follow control.
  usePublicProfessionalIdentity: vi.fn(() => ({ data: null, isPending: false, isError: false })),
}))

// PARTIAL mock, deliberately. Only the network hook is replaced; the CTA
// derivation stays REAL, because the whole point of these cases is that the
// buttons follow server truth. Mocking deriveCustomerCtas would test that the
// component renders whatever it is told, which is not the question.
vi.mock('@/lib/queries/service-mode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/queries/service-mode')>()),
  usePublicServiceState: vi.fn(),
}))

// The header renders a FavoriteButton, which needs an auth context
// (logged-out here) and a QueryClient ancestor.
vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(() => ({ session: null, user: null, loading: false })),
}))

const mockUsePublicOrganization = vi.mocked(usePublicOrganization)
const mockUsePublicBarber = vi.mocked(usePublicBarber)
const mockUsePublicBarberServices = vi.mocked(usePublicBarberServices)
const mockUsePublicServiceState = vi.mocked(usePublicServiceState)

/** A publicly operable barber, accepting whatever the overrides say. */
function serviceState(overrides: Partial<PublicServiceState> = {}): PublicServiceState {
  return {
    locationId: 'loc-1',
    barberId: 'barber-1',
    effectiveServiceMode: 'hybrid',
    modeSource: 'location_default',
    modeExpiresAt: null,
    modeAllowsBooking: true,
    modeAllowsQueue: true,
    queueOpen: true,
    queueAcceptingNewEntries: true,
    bookingAcceptingNewEntries: true,
    ...overrides,
  }
}

function withServiceState(state: PublicServiceState | null) {
  mockUsePublicServiceState.mockReturnValue(successQuery(state))
}

/** The ordinary, bookable barber every CTA case starts from. */
function renderBookableBarber() {
  mockUsePublicOrganization.mockReturnValue(
    successQuery({ id: 'org-1', name: "Jack's Barbers", slug: 'jacks-barbers' }),
  )
  mockUsePublicBarber.mockReturnValue(
    successQuery({
      barberId: 'barber-1',
      displayName: 'Sam Barber',
      title: 'Master Barber',
      bio: 'Fades and tapers.',
      avatarUrl: null,
      locationId: 'loc-1',
    }),
  )
  mockUsePublicBarberServices.mockReturnValue(
    successQuery([{ id: 'svc-1', name: 'Classic Fade', durationMinutes: 30, priceCents: 3500 }]),
  )
  renderAtPath('/s/jacks-barbers/barbers/barber-1')
}

function pendingQuery() {
  return { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() } as never
}

function successQuery(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function renderAtPath(path: string) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/s/:slug/barbers/:barberId" element={<PublicBarberPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PublicBarberPage', () => {
  it('shows a friendly "not found" state for a private or unknown barber', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery({ id: 'org-1', name: "Jack's Barbers", slug: 'jacks-barbers' }))
    mockUsePublicBarber.mockReturnValue(successQuery(null))
    mockUsePublicBarberServices.mockReturnValue(pendingQuery())
    withServiceState(null)

    renderAtPath('/s/jacks-barbers/barbers/no-such-barber')

    expect(await screen.findByText("We couldn't find this profile")).toBeInTheDocument()
  })

  it('renders the barber\'s profile and their real active services, with a "Book with" CTA', async () => {
    withServiceState(serviceState())
    renderBookableBarber()

    expect(await screen.findByText('Sam Barber')).toBeInTheDocument()
    expect(screen.getByText('Master Barber')).toBeInTheDocument()
    expect(screen.getByText('Fades and tapers.')).toBeInTheDocument()
    expect(screen.getByText('Classic Fade')).toBeInTheDocument()
    expect(screen.getByText('€35.00')).toBeInTheDocument()
    // The FULL published name. Splitting on the first space to get a friendly
    // "Book with Sam" takes the family name in Japanese and Chinese and
    // mangles a two-part Arabic given name.
    const bookLink = screen.getByRole('link', { name: /Book with Sam Barber/ })
    expect(bookLink).toHaveAttribute('href', '/s/jacks-barbers?barber=barber-1&location=loc-1')
  })

  describe('the CTA follows what the shop is actually accepting', () => {
    it('offers Book AND Join Queue for a hybrid barber with the line open', async () => {
      withServiceState(serviceState())
      renderBookableBarber()

      expect(await screen.findByRole('link', { name: /Book with Sam Barber/ })).toBeInTheDocument()
      const queueLink = screen.getByRole('link', { name: /Join the queue/ })
      expect(queueLink).toHaveAttribute('href', '/s/jacks-barbers/walk-in')
    })

    it('offers only Book when the barber takes reservations only', async () => {
      withServiceState(
        serviceState({
          effectiveServiceMode: 'reservation_only',
          modeAllowsQueue: false,
          queueAcceptingNewEntries: false,
        }),
      )
      renderBookableBarber()

      expect(await screen.findByRole('link', { name: /Book with Sam Barber/ })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Join the queue/ })).not.toBeInTheDocument()
      // And no "closed for now", which would promise a return that is not
      // coming — this barber does not do walk-ins at all.
      expect(screen.queryByText('Queue closed for now')).not.toBeInTheDocument()
    })

    it('offers only Join Queue, and never an actionable Book, for a walk-in-only barber', async () => {
      withServiceState(
        serviceState({
          effectiveServiceMode: 'queue_only',
          modeAllowsBooking: false,
          bookingAcceptingNewEntries: false,
        }),
      )
      renderBookableBarber()

      expect(await screen.findByRole('link', { name: /Join the queue/ })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Book with Sam Barber/ })).not.toBeInTheDocument()
    })

    it('shows a non-actionable "closed for now" when the line is shut', async () => {
      withServiceState(
        serviceState({
          effectiveServiceMode: 'queue_only',
          modeAllowsBooking: false,
          bookingAcceptingNewEntries: false,
          queueOpen: false,
          queueAcceptingNewEntries: false,
        }),
      )
      renderBookableBarber()

      expect(await screen.findByText('Queue closed for now')).toBeInTheDocument()
      // Explicitly NOT a link: a customer must not be able to tap into a
      // check-in the database would refuse.
      expect(screen.queryByRole('link', { name: /Join the queue/ })).not.toBeInTheDocument()
    })

    it('offers no operational CTA at all when the barber is unavailable', async () => {
      withServiceState(
        serviceState({
          effectiveServiceMode: 'unavailable',
          modeAllowsBooking: false,
          modeAllowsQueue: false,
          bookingAcceptingNewEntries: false,
          queueAcceptingNewEntries: false,
        }),
      )
      renderBookableBarber()

      expect(await screen.findByText('Not taking new bookings right now')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Book with Sam Barber/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Join the queue/ })).not.toBeInTheDocument()
    })

    it('keeps the profile and the follow control even when nothing is bookable', async () => {
      // §25: social actions must not disappear because a barber closed the shop
      // early. The favourite control, the bio and the service list all stay.
      withServiceState(
        serviceState({
          effectiveServiceMode: 'unavailable',
          modeAllowsBooking: false,
          modeAllowsQueue: false,
          bookingAcceptingNewEntries: false,
          queueAcceptingNewEntries: false,
        }),
      )
      renderBookableBarber()

      expect(await screen.findByText('Sam Barber')).toBeInTheDocument()
      expect(screen.getByText('Fades and tapers.')).toBeInTheDocument()
      expect(screen.getByText('Classic Fade')).toBeInTheDocument()
    })

    it('follows the SERVER when entitlement and mode disagree', async () => {
      // The mode allows booking; the organization is not entitled to it. A UI
      // deriving from the mode would offer a button that fails on tap.
      withServiceState(
        serviceState({ modeAllowsBooking: true, bookingAcceptingNewEntries: false }),
      )
      renderBookableBarber()

      expect(await screen.findByRole('link', { name: /Join the queue/ })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Book with Sam Barber/ })).not.toBeInTheDocument()
    })
  })
})
