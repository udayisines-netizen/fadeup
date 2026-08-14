import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerProfilePage } from '@/pages/customer-profile-page'
import { ToastProvider } from '@/components/ui/toast'
import { useAuth } from '@/lib/auth-context'
import { getSupabaseClient } from '@/lib/supabase'
import { useMyCustomerProfile, useUpsertMyCustomerProfile } from '@/lib/queries/customer-profile'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/queries/customer-profile', () => ({
  useMyCustomerProfile: vi.fn(),
  useUpsertMyCustomerProfile: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)
const mockGetSupabaseClient = vi.mocked(getSupabaseClient)
const mockUseMyCustomerProfile = vi.mocked(useMyCustomerProfile)
const mockUseUpsert = vi.mocked(useUpsertMyCustomerProfile)

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <CustomerProfilePage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('CustomerProfilePage', () => {
  const mutateAsync = vi.fn().mockResolvedValue({})
  const signOut = vi.fn().mockResolvedValue({})
  const supabaseRpc = vi.fn().mockResolvedValue({ data: null, error: null })

  beforeEach(() => {
    mockNavigate.mockClear()
    mutateAsync.mockClear()
    signOut.mockClear()
    supabaseRpc.mockClear()
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockGetSupabaseClient.mockReturnValue({ auth: { signOut }, rpc: supabaseRpc } as never)
    mockUseMyCustomerProfile.mockReturnValue({
      data: {
        id: 'profile-1',
        userId: 'user-1',
        displayName: 'Jordan',
        phone: '',
        email: '',
        haircutFrequency: null,
        stylePreference: null,
        styleNotes: null,
        appointmentPreference: null,
        onboardingCompletedAt: null,
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    mockUseUpsert.mockReturnValue({ mutateAsync, isPending: false } as never)
  })

  it('shows the "no habits yet" empty state — never a fabricated habit summary', () => {
    renderPage()

    expect(screen.getByText("You haven't told us your habits yet.")).toBeInTheDocument()
  })

  it('shows real saved habits as badges once set', () => {
    mockUseMyCustomerProfile.mockReturnValue({
      data: {
        id: 'profile-1',
        userId: 'user-1',
        displayName: 'Jordan',
        phone: '+15551234',
        email: 'jordan@example.com',
        haircutFrequency: 'every_2_weeks',
        stylePreference: 'fade',
        styleNotes: null,
        appointmentPreference: 'either',
        onboardingCompletedAt: '2026-08-01T00:00:00Z',
      },
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as never)

    renderPage()

    expect(screen.getByText('Every 2 weeks')).toBeInTheDocument()
    expect(screen.getByText('Fade')).toBeInTheDocument()
    expect(screen.getByText('Either works')).toBeInTheDocument()
  })

  it('saves contact info WITHOUT retroactively claiming records that merely match it', async () => {
    // Security regression guard. An earlier version of this screen called
    // claim_customer_records(phone, email) on save, which treated typed-in
    // contact details as proof of ownership and let anyone take over a
    // stranger's unlinked shop record by entering their email. That RPC is
    // gone (20260813150000_appointment_ownership_hardening.sql); saving a
    // profile must now do nothing beyond saving the profile.
    renderPage()

    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+15559876' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ phone: '+15559876' }))
    expect(supabaseRpc).not.toHaveBeenCalled()
  })

  it('sign out ends the session and returns to customer login', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(signOut).toHaveBeenCalled())
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true })
  })
})
