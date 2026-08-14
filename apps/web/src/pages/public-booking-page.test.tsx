import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PublicBookingPage } from '@/pages/public-booking-page'
import { useAuth } from '@/lib/auth-context'
import { useMyCustomerProfile, storePendingClaimToken } from '@/lib/queries/customer-profile'
import {
  usePublicAvailableSlots,
  usePublicBarbers,
  usePublicLocations,
  usePublicOrganization,
  usePublicServices,
  useBookPublicAppointment,
} from '@/lib/queries/public-booking'

vi.mock('@/lib/queries/public-booking', () => ({
  usePublicOrganization: vi.fn(),
  usePublicLocations: vi.fn(),
  usePublicServices: vi.fn(),
  usePublicBarbers: vi.fn(),
  usePublicAvailableSlots: vi.fn(),
  useBookPublicAppointment: vi.fn(),
}))

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))

vi.mock('@/lib/queries/customer-profile', () => ({
  useMyCustomerProfile: vi.fn(),
  storePendingClaimToken: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)
const mockUseMyCustomerProfile = vi.mocked(useMyCustomerProfile)
const mockStorePendingClaimToken = vi.mocked(storePendingClaimToken)
const mockUsePublicOrganization = vi.mocked(usePublicOrganization)
const mockUsePublicLocations = vi.mocked(usePublicLocations)
const mockUsePublicServices = vi.mocked(usePublicServices)
const mockUsePublicBarbers = vi.mocked(usePublicBarbers)
const mockUsePublicAvailableSlots = vi.mocked(usePublicAvailableSlots)
const mockUseBookPublicAppointment = vi.mocked(useBookPublicAppointment)

function pendingQuery() {
  return { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() } as never
}

function successQuery(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function renderAtSlug(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/s/${slug}`]}>
      <Routes>
        <Route path="/s/:slug" element={<PublicBookingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PublicBookingPage', () => {
  beforeEach(() => {
    mockStorePendingClaimToken.mockClear()
    mockUseAuth.mockReturnValue({ session: null, user: null, loading: false })
    mockUseMyCustomerProfile.mockReturnValue(successQuery(null))
  })

  it('shows a friendly "not found" state for an unknown slug (resolved, zero rows — not an error)', async () => {
    mockUsePublicOrganization.mockReturnValue(successQuery(null))
    mockUsePublicLocations.mockReturnValue(pendingQuery())
    mockUsePublicServices.mockReturnValue(pendingQuery())
    mockUsePublicBarbers.mockReturnValue(pendingQuery())
    mockUsePublicAvailableSlots.mockReturnValue(pendingQuery())
    mockUseBookPublicAppointment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

    renderAtSlug('no-such-shop')

    expect(await screen.findByText("We couldn't find this shop")).toBeInTheDocument()
  })

  it('auto-skips a single location and lists services grouped by category', async () => {
    mockUsePublicOrganization.mockReturnValue(
      successQuery({ id: 'org-1', name: "Jack's Barbers", slug: 'jacks-barbers' }),
    )
    mockUsePublicLocations.mockReturnValue(
      successQuery([{ id: 'loc-1', name: 'Main Shop', addressLine1: null, addressLine2: null, city: 'Austin', region: 'TX', postalCode: null, country: 'US', timezone: 'America/Chicago' }]),
    )
    mockUsePublicServices.mockReturnValue(
      successQuery([
        { id: 'svc-1', categoryId: 'cat-1', categoryName: 'Haircuts', name: 'Classic Fade', description: null, durationMinutes: 30, priceCents: 3500 },
      ]),
    )
    mockUsePublicBarbers.mockReturnValue(pendingQuery())
    mockUsePublicAvailableSlots.mockReturnValue(pendingQuery())
    mockUseBookPublicAppointment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)

    renderAtSlug('jacks-barbers')

    expect(await screen.findByText('Classic Fade')).toBeInTheDocument()
    expect(screen.getByText('Haircuts')).toBeInTheDocument()
    expect(screen.getByText('$35.00')).toBeInTheDocument()
    // The single location was auto-selected — "Choose a location" should never appear.
    expect(screen.queryByText('Choose a location')).not.toBeInTheDocument()
  })

  // --- full journey: pick a service -> barber -> slot -> details -> booked ---

  function mockBookableShop(mutateAsync: ReturnType<typeof vi.fn>) {
    mockUsePublicOrganization.mockReturnValue(
      successQuery({ id: 'org-1', name: "Jack's Barbers", slug: 'jacks-barbers' }),
    )
    mockUsePublicLocations.mockReturnValue(
      successQuery([{ id: 'loc-1', name: 'Main Shop', addressLine1: null, addressLine2: null, city: 'Austin', region: 'TX', postalCode: null, country: 'US', timezone: 'America/Chicago' }]),
    )
    mockUsePublicServices.mockReturnValue(
      successQuery([
        { id: 'svc-1', categoryId: 'cat-1', categoryName: 'Haircuts', name: 'Classic Fade', description: null, durationMinutes: 30, priceCents: 3500 },
      ]),
    )
    mockUsePublicBarbers.mockReturnValue(
      successQuery([{ barberId: 'brb-1', staffProfileId: 'sp-1', displayName: 'Alex', bio: null, avatarUrl: null }]),
    )
    mockUsePublicAvailableSlots.mockReturnValue(
      successQuery([{ slotStart: '2099-01-01T15:00:00Z', slotEnd: '2099-01-01T15:30:00Z' }]),
    )
    mockUseBookPublicAppointment.mockReturnValue({ mutateAsync, isPending: false } as never)
  }

  async function bookThrough(name: string) {
    fireEvent.click(await screen.findByText('Classic Fade'))
    // The single bookable barber is auto-selected, same as the single
    // location — the wizard goes straight to slots.
    const slot = await screen.findByRole('button', { name: /:\d\d\s?(AM|PM)/i })
    fireEvent.click(slot)
    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: name } })
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+15551230000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request appointment' }))
  }

  it('an anonymous booking keeps its claim token and offers the account that makes it useful', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      id: 'appt-1',
      startsAt: '2099-01-01T15:00:00Z',
      endsAt: '2099-01-01T15:30:00Z',
      status: 'pending',
      claimToken: 'tok-xyz',
    })
    mockBookableShop(mutateAsync)

    renderAtSlug('jacks-barbers')
    await bookThrough('Sam Rivera')

    expect(await screen.findByText('Request sent')).toBeInTheDocument()
    // The token is what lets the account they are being offered actually
    // contain this appointment — without it the CTA would be an empty promise.
    expect(mockStorePendingClaimToken).toHaveBeenCalledWith('tok-xyz')
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register?redirect=%2Fapp%2Fcustomer',
    )
    expect(screen.getByRole('link', { name: 'I already have an account' })).toBeInTheDocument()
  })

  it('a signed-in booking is already owned: no token stashed, straight to My Appointments', async () => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1', email: 'sam@example.test' } as never, loading: false })
    const mutateAsync = vi.fn().mockResolvedValue({
      id: 'appt-2',
      startsAt: '2099-01-01T15:00:00Z',
      endsAt: '2099-01-01T15:30:00Z',
      status: 'pending',
      claimToken: null,
    })
    mockBookableShop(mutateAsync)

    renderAtSlug('jacks-barbers')
    await bookThrough('Sam Rivera')

    expect(await screen.findByText('Request sent')).toBeInTheDocument()
    expect(mockStorePendingClaimToken).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'View my appointments' })).toHaveAttribute('href', '/app/customer/appointments')
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument()
  })

  it('prefills a signed-in customer\'s saved details instead of making them retype', async () => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1', email: 'sam@example.test' } as never, loading: false })
    mockUseMyCustomerProfile.mockReturnValue(
      successQuery({
        id: 'p-1', userId: 'user-1', displayName: 'Sam Rivera', phone: '+15551239999', email: 'sam@example.test',
        haircutFrequency: null, stylePreference: null, styleNotes: null, appointmentPreference: null, onboardingCompletedAt: null,
      }),
    )
    mockBookableShop(vi.fn())

    renderAtSlug('jacks-barbers')
    fireEvent.click(await screen.findByText('Classic Fade'))
    fireEvent.click(await screen.findByRole('button', { name: /:\d\d\s?(AM|PM)/i }))

    await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveValue('Sam Rivera'))
    expect(screen.getByLabelText('Phone number')).toHaveValue('+15551239999')
    expect(screen.getByLabelText('Email')).toHaveValue('sam@example.test')
  })
})
