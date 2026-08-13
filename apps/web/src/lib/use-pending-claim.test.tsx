import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePendingClaimRedemption } from '@/lib/use-pending-claim'
import { useAuth } from '@/lib/auth-context'
import {
  PENDING_CLAIM_STORAGE_KEY,
  useRedeemAppointmentClaim,
} from '@/lib/queries/customer-profile'

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))

vi.mock('@/lib/queries/customer-profile', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queries/customer-profile')>(
    '@/lib/queries/customer-profile',
  )
  return { ...actual, useRedeemAppointmentClaim: vi.fn() }
})

const mockToast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mockToast }) }))

const mockUseAuth = vi.mocked(useAuth)
const mockUseRedeem = vi.mocked(useRedeemAppointmentClaim)

function Harness() {
  usePendingClaimRedemption()
  return <div>ready</div>
}

describe('usePendingClaimRedemption', () => {
  const mutateAsync = vi.fn()

  beforeEach(() => {
    mutateAsync.mockReset()
    mockToast.mockReset()
    window.sessionStorage.clear()
    mutateAsync.mockResolvedValue({ claimed: true, organizationName: 'Le Fade Parisien', startsAt: null })
    mockUseRedeem.mockReturnValue({ mutateAsync } as never)
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
  })

  it('redeems a stashed token once the customer has a session, and confirms it', async () => {
    window.sessionStorage.setItem(PENDING_CLAIM_STORAGE_KEY, 'tok-abc')

    render(<Harness />)

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith('tok-abc'))
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'success', title: 'Appointment added to your account' }),
      ),
    )
    // Single-use: the token must not survive to be replayed on the next mount.
    expect(window.sessionStorage.getItem(PENDING_CLAIM_STORAGE_KEY)).toBeNull()
  })

  it('does nothing at all when there is no pending booking to claim', async () => {
    render(<Harness />)

    await waitFor(() => expect(mutateAsync).not.toHaveBeenCalled())
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('never redeems without a session — the token is worthless until the customer has an account', async () => {
    window.sessionStorage.setItem(PENDING_CLAIM_STORAGE_KEY, 'tok-abc')
    mockUseAuth.mockReturnValue({ session: null, user: null, loading: false })

    render(<Harness />)

    await waitFor(() => expect(mutateAsync).not.toHaveBeenCalled())
    // Still waiting for them to sign in — must not be discarded.
    expect(window.sessionStorage.getItem(PENDING_CLAIM_STORAGE_KEY)).toBe('tok-abc')
  })

  it('stays silent when the token is expired or already spent', async () => {
    window.sessionStorage.setItem(PENDING_CLAIM_STORAGE_KEY, 'tok-stale')
    mutateAsync.mockResolvedValue({ claimed: false, organizationName: null, startsAt: null })

    render(<Harness />)

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(mockToast).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(PENDING_CLAIM_STORAGE_KEY)).toBeNull()
  })

  it('a redemption error never surfaces to the customer — they did not ask for this', async () => {
    window.sessionStorage.setItem(PENDING_CLAIM_STORAGE_KEY, 'tok-boom')
    mutateAsync.mockRejectedValue(new Error('network down'))

    render(<Harness />)

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(mockToast).not.toHaveBeenCalled()
  })
})
