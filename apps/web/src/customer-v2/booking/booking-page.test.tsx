import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerV2BookingPage } from '@/customer-v2/booking/booking-page'

/**
 * The booking flow's product contract.
 *
 * Load-bearing rules: a `?barber=` entry never shows the barber step; a shop
 * entry with several bookable barbers does; the mutation receives exactly the
 * chosen context; and an anonymous booking's claim token reaches the existing
 * pending-claim store, because that store is what lets the customer attach the
 * appointment to an account they create later.
 */

const bookMutate = vi.fn()
const storeToken = vi.fn()

const state: {
  roster: Array<{ barberId: string; displayName: string }>
  /* Per-date slot lists; `null` means every date has the default two slots. */
  slotsByDate: Record<string, Array<{ slotStart: string; slotEnd: string }>> | null
  user: { id: string; email: string } | null
  myProfile: { displayName: string | null; email: string | null } | null
} = {
  roster: [],
  slotsByDate: null,
  user: null,
  myProfile: null,
}

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ session: null, user: state.user, loading: false }),
}))

vi.mock('@/lib/queries/customer-profile', () => ({
  storePendingClaimToken: (token: string) => storeToken(token),
  useMyCustomerProfile: () => ({ data: state.myProfile, isPending: false }),
}))

vi.mock('@/lib/analytics', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
  useTrackView: vi.fn(),
}))

vi.mock('@/lib/queries/customer-app', () => ({
  MY_APPOINTMENTS_KEY: ['my-appointments'],
}))

vi.mock('@/lib/calendar/ics', () => ({
  downloadIcs: vi.fn(),
}))

vi.mock('@/lib/queries/public-booking', () => ({
  usePublicOrganization: () => ({
    data: {
      id: 'org-1',
      name: 'Side Agency',
      slug: 'side-agency',
      currency: 'EUR',
      countryCode: 'FR',
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePublicLocations: () => ({
    data: [
      {
        id: 'loc-1',
        name: 'Side Agency',
        addressLine1: '19 rue Danton',
        addressLine2: null,
        city: 'Antony (92)',
        region: null,
        postalCode: null,
        country: 'FR',
        timezone: 'Europe/Paris',
      },
    ],
    isError: false,
    refetch: vi.fn(),
  }),
  usePublicServices: () => ({
    data: [
      {
        id: 'svc-1',
        categoryId: null,
        categoryName: null,
        name: 'Classic cut',
        description: null,
        durationMinutes: 30,
        priceCents: 2500,
      },
    ],
    isPending: false,
  }),
  usePublicBarbers: () => ({ data: state.roster, isPending: false }),
  usePublicAvailableSlots: (
    _slug?: string,
    _locationId?: string,
    _barberId?: string,
    _serviceId?: string,
    date?: string,
  ) => ({
    data: state.slotsByDate
      ? (state.slotsByDate[date ?? ''] ?? [])
      : [
          { slotStart: '2026-09-01T09:00:00+02:00', slotEnd: '2026-09-01T09:30:00+02:00' },
          { slotStart: '2026-09-01T09:30:00+02:00', slotEnd: '2026-09-01T10:00:00+02:00' },
        ],
    isPending: false,
    isError: false,
  }),
  useBookPublicAppointment: () => ({
    mutate: bookMutate,
    isPending: false,
    isError: false,
  }),
}))

function renderPage(query = '?location=loc-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/_preview/r5r/s/side-agency/book${query}`]}>
        <Routes>
          <Route path="/_preview/r5r/s/:slug/book" element={<CustomerV2BookingPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  bookMutate.mockReset()
  storeToken.mockReset()
  state.slotsByDate = null
  state.user = null
  state.myProfile = null
})

describe('the barber question is asked at most once', () => {
  it('skips the barber step entirely for a ?barber= entry', () => {
    state.roster = [
      { barberId: 'barber-1', displayName: 'Barber Test' },
      { barberId: 'barber-2', displayName: 'Jordan' },
    ]
    renderPage('?location=loc-1&barber=barber-1')

    fireEvent.click(screen.getByRole('button', { name: /Classic cut/ }))

    // Straight to time — no "Choose your barber" even though two are bookable.
    expect(screen.getByRole('heading', { name: 'Choose a time' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Choose your barber' })).not.toBeInTheDocument()
  })

  it('asks for the barber on a shop entry with a real choice', () => {
    state.roster = [
      { barberId: 'barber-1', displayName: 'Barber Test' },
      { barberId: 'barber-2', displayName: 'Jordan' },
    ]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Classic cut/ }))
    expect(screen.getByRole('heading', { name: 'Choose your barber' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Jordan' }))
    expect(screen.getByRole('heading', { name: 'Choose a time' })).toBeInTheDocument()
  })

  it('answers the step itself when exactly one barber offers the service', () => {
    state.roster = [{ barberId: 'barber-1', displayName: 'Barber Test' }]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Classic cut/ }))

    expect(screen.queryByRole('heading', { name: 'Choose your barber' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Choose a time' })).toBeInTheDocument()
  })
})

describe('confirmation sends exactly the chosen context', () => {
  it('books with slug, location, barber, service, slot and name — and stores the claim token', () => {
    state.roster = [{ barberId: 'barber-1', displayName: 'Barber Test' }]
    renderPage('?location=loc-1&barber=barber-1')

    fireEvent.click(screen.getByRole('button', { name: /Classic cut/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /9:00/ })[0])

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Test Customer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))

    expect(bookMutate).toHaveBeenCalledTimes(1)
    const [input, options] = bookMutate.mock.calls[0]
    expect(input).toMatchObject({
      organizationSlug: 'side-agency',
      locationId: 'loc-1',
      barberId: 'barber-1',
      serviceId: 'svc-1',
      startsAt: '2026-09-01T09:00:00+02:00',
      customerName: 'Test Customer',
    })

    // The anonymous claim reaches the EXISTING store — no second mechanism.
    act(() => {
      options.onSuccess({
        id: 'appt-1',
        startsAt: '2026-09-01T09:00:00+02:00',
        endsAt: '2026-09-01T09:30:00+02:00',
        status: 'confirmed',
        claimToken: 'claim-token-1',
      })
    })
    expect(storeToken).toHaveBeenCalledWith('claim-token-1')

    // The flow transformed in place into the confirmation.
    expect(screen.getByRole('heading', { name: 'Booked' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to Calendar' })).toBeInTheDocument()
  })
})

describe('review corrections', () => {
  const parisKey = (daysAhead: number) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() + daysAhead * 86_400_000))

  it('lands on the first day with free times instead of a dead empty day', async () => {
    state.roster = [{ barberId: 'b-1', displayName: 'Sofian' }]
    // Today and tomorrow empty; day+2 has the availability.
    state.slotsByDate = {
      [parisKey(2)]: [
        { slotStart: '2026-09-01T14:00:00+02:00', slotEnd: '2026-09-01T14:30:00+02:00' },
      ],
    }
    renderPage()
    fireEvent.click(screen.getByText('Classic cut'))

    // The auto-advance walks forward one effect pass per empty day.
    expect(await screen.findByText(/First free times are on/)).toBeInTheDocument()
    expect(screen.getByText(/2:00/)).toBeInTheDocument()
  })

  it('offers no Change control for a barber the flow answered itself', () => {
    state.roster = [{ barberId: 'b-1', displayName: 'Sofian' }]
    renderPage()
    fireEvent.click(screen.getByText('Classic cut'))

    // Service summary keeps its Change; the auto-answered barber has none.
    expect(screen.getByText('Sofian')).toBeInTheDocument()
    expect(screen.getAllByText('Change')).toHaveLength(1)
  })

  it('prefills a signed-in customer’s details from their profile', () => {
    state.roster = [{ barberId: 'b-1', displayName: 'Sofian' }]
    state.user = { id: 'user-1', email: 'nora@example.com' }
    state.myProfile = { displayName: 'Nora', email: 'nora@example.com' }
    renderPage()
    fireEvent.click(screen.getByText('Classic cut'))
    fireEvent.click(screen.getByText(/9:00/))

    expect(screen.getByDisplayValue('Nora')).toBeInTheDocument()
    expect(screen.getByDisplayValue('nora@example.com')).toBeInTheDocument()
  })
})
