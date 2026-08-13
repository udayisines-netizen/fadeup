import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerHomePage } from '@/pages/customer-home-page'
import { useAuth } from '@/lib/auth-context'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'
import { useMyAppointments, useMyQueueStatus } from '@/lib/queries/customer-app'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/lib/queries/customer-profile', () => ({
  useMyCustomerProfile: vi.fn(),
}))

vi.mock('@/lib/queries/customer-app', () => ({
  useMyAppointments: vi.fn(),
  useMyQueueStatus: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)
const mockUseMyCustomerProfile = vi.mocked(useMyCustomerProfile)
const mockUseMyAppointments = vi.mocked(useMyAppointments)
const mockUseMyQueueStatus = vi.mocked(useMyQueueStatus)

function successQuery(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CustomerHomePage />
    </MemoryRouter>,
  )
}

describe('CustomerHomePage', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseMyAppointments.mockReturnValue(successQuery([]))
    mockUseMyQueueStatus.mockReturnValue(successQuery([]))
  })

  it('prompts onboarding when the customer has never completed it — never a fabricated dashboard', () => {
    mockUseMyCustomerProfile.mockReturnValue(successQuery(null))

    renderPage()

    expect(screen.getByText('Tell us your habits')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/app/customer/onboarding')
  })

  it('shows no onboarding prompt once onboarding is complete, with no queue/appointment/rebook data', () => {
    mockUseMyCustomerProfile.mockReturnValue(successQuery({ onboardingCompletedAt: '2026-08-01T00:00:00Z', haircutFrequency: null }))

    renderPage()

    expect(screen.queryByText('Tell us your habits')).not.toBeInTheDocument()
  })

  it('prioritizes an active queue entry above everything else', () => {
    mockUseMyCustomerProfile.mockReturnValue(successQuery({ onboardingCompletedAt: '2026-08-01T00:00:00Z', haircutFrequency: null }))
    mockUseMyQueueStatus.mockReturnValue(
      successQuery([
        {
          id: 'q-1',
          organizationId: 'org-1',
          organizationName: 'Le Fade Parisien',
          organizationSlug: 'demo-le-fade-parisien',
          locationId: 'loc-1',
          locationName: 'Main',
          status: 'waiting',
          queuePosition: 3,
          barberDisplayName: null,
          createdAt: '2026-08-13T10:00:00Z',
        },
      ]),
    )
    mockUseMyAppointments.mockReturnValue(
      successQuery([
        {
          id: 'a-1',
          organizationId: 'org-1',
          organizationName: 'Le Fade Parisien',
          organizationSlug: 'demo-le-fade-parisien',
          locationId: 'loc-1',
          locationName: 'Main',
          barberId: 'barber-1',
          barberDisplayName: 'Karim',
          serviceId: 'svc-1',
          serviceName: 'Fade',
          startsAt: '2099-01-01T10:00:00Z',
          endsAt: '2099-01-01T10:30:00Z',
          status: 'confirmed',
          priceCents: 2000,
        },
      ]),
    )

    renderPage()

    expect(screen.getByText("You're in line")).toBeInTheDocument()
    expect(screen.getByText('2 people ahead of you')).toBeInTheDocument()
    expect(screen.queryByText('Upcoming appointment')).not.toBeInTheDocument()
  })

  it('shows the upcoming appointment when there is no active queue entry', () => {
    mockUseMyCustomerProfile.mockReturnValue(successQuery({ onboardingCompletedAt: '2026-08-01T00:00:00Z', haircutFrequency: null }))
    mockUseMyAppointments.mockReturnValue(
      successQuery([
        {
          id: 'a-1',
          organizationId: 'org-1',
          organizationName: 'Le Fade Parisien',
          organizationSlug: 'demo-le-fade-parisien',
          locationId: 'loc-1',
          locationName: 'Main',
          barberId: 'barber-1',
          barberDisplayName: 'Karim',
          serviceId: 'svc-1',
          serviceName: 'Fade',
          startsAt: '2099-01-01T10:00:00Z',
          endsAt: '2099-01-01T10:30:00Z',
          status: 'confirmed',
          priceCents: 2000,
        },
      ]),
    )

    renderPage()

    expect(screen.getByText('Upcoming appointment')).toBeInTheDocument()
  })

  it('always offers the Discover CTA, real data or not', () => {
    mockUseMyCustomerProfile.mockReturnValue(successQuery(null))

    renderPage()

    expect(screen.getByRole('link', { name: 'Discover barbers' })).toHaveAttribute('href', '/search')
  })

  it('shows an error state, not a raw error message, when the profile fails to load', () => {
    mockUseMyCustomerProfile.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('network error'),
      refetch: vi.fn(),
    } as never)

    renderPage()

    expect(screen.getByText("Couldn't load your home")).toBeInTheDocument()
  })
})
