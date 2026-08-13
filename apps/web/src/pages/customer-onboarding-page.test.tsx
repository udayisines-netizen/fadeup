import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerOnboardingPage } from '@/pages/customer-onboarding-page'
import { useAuth } from '@/lib/auth-context'
import { useMyCustomerProfile, useUpsertMyCustomerProfile } from '@/lib/queries/customer-profile'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/lib/queries/customer-profile', () => ({
  useMyCustomerProfile: vi.fn(),
  useUpsertMyCustomerProfile: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)
const mockUseMyCustomerProfile = vi.mocked(useMyCustomerProfile)
const mockUseUpsert = vi.mocked(useUpsertMyCustomerProfile)

function renderPage() {
  return render(
    <MemoryRouter>
      <CustomerOnboardingPage />
    </MemoryRouter>,
  )
}

describe('CustomerOnboardingPage', () => {
  const mutateAsync = vi.fn().mockResolvedValue({})

  beforeEach(() => {
    mockNavigate.mockClear()
    mutateAsync.mockClear()
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseMyCustomerProfile.mockReturnValue({ data: null, isPending: false, isSuccess: true, isError: false, error: null, refetch: vi.fn() } as never)
    mockUseUpsert.mockReturnValue({ mutateAsync, isPending: false } as never)
  })

  it('saves the selected answers and marks onboarding complete, then returns home', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Every 2 weeks' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fade' }))
    fireEvent.click(screen.getByRole('button', { name: 'I like to book ahead' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          haircutFrequency: 'every_2_weeks',
          stylePreference: 'fade',
          appointmentPreference: 'appointment',
          markOnboardingComplete: true,
        }),
      ),
    )
    expect(mockNavigate).toHaveBeenCalledWith('/app/customer', { replace: true })
  })

  it('skipping marks onboarding complete without forcing any answer — real skippability, not a fake gate', async () => {
    renderPage()

    fireEvent.click(screen.getByText('Skip for now'))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ userId: 'user-1', markOnboardingComplete: true }),
    )
    expect(mockNavigate).toHaveBeenCalledWith('/app/customer', { replace: true })
  })
})
