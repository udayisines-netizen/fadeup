import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerHomePage } from '@/pages/customer-home-page'
import { useAuth } from '@/lib/auth-context'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/lib/queries/customer-profile', () => ({
  useMyCustomerProfile: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)
const mockUseMyCustomerProfile = vi.mocked(useMyCustomerProfile)

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
  })

  it('prompts onboarding when the customer has never completed it — never a fabricated dashboard', () => {
    mockUseMyCustomerProfile.mockReturnValue({ data: null, isPending: false, isError: false, error: null, refetch: vi.fn() } as never)

    renderPage()

    expect(screen.getByText('Tell us your habits')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/app/customer/onboarding')
  })

  it('shows a plain welcome (no prompt) once onboarding is complete', () => {
    mockUseMyCustomerProfile.mockReturnValue({
      data: { onboardingCompletedAt: '2026-08-01T00:00:00Z' },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as never)

    renderPage()

    expect(screen.queryByText('Tell us your habits')).not.toBeInTheDocument()
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
  })

  it('always offers the Discover CTA, real data or not', () => {
    mockUseMyCustomerProfile.mockReturnValue({ data: null, isPending: false, isError: false, error: null, refetch: vi.fn() } as never)

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

    expect(screen.getByText("Couldn't load your profile")).toBeInTheDocument()
  })
})
