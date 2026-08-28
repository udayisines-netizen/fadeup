import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformAcquisitionClaimsPage } from '@/pages/platform-acquisition-claims-page'
import { ToastProvider } from '@/components/ui/toast'
import {
  useProfessionalClaims,
  useProfessionalsByIds,
  useReviewProfessionalClaim,
  type ProfessionalClaim,
} from '@/lib/queries/professional-claims'
import { usePlatformRole } from '@/routes/require-platform-role'

vi.mock('@/lib/queries/professional-claims', () => ({
  useProfessionalClaims: vi.fn(),
  useProfessionalsByIds: vi.fn(),
  useReviewProfessionalClaim: vi.fn(),
}))
vi.mock('@/routes/require-platform-role', () => ({ usePlatformRole: vi.fn() }))

const mockClaims = vi.mocked(useProfessionalClaims)
const mockIdentities = vi.mocked(useProfessionalsByIds)
const mockReview = vi.mocked(useReviewProfessionalClaim)
const mockRole = vi.mocked(usePlatformRole)

function claim(overrides: Partial<ProfessionalClaim> = {}): ProfessionalClaim {
  return {
    id: 'c-1',
    professionalId: 'prof-1',
    claimantUserId: 'u-1',
    state: 'pending',
    evidence: 'I have run this shop since 2019.',
    submittedAt: '2026-08-20T09:00:00.000Z',
    decidedAt: null,
    decisionNote: null,
    ...overrides,
  }
}

function resolved(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <PlatformAcquisitionClaimsPage />
      </MemoryRouter>
    </ToastProvider>,
  )
}

describe('PlatformAcquisitionClaimsPage — /platform/acquisition/claims', () => {
  beforeEach(() => {
    mockClaims.mockReturnValue(resolved([]))
    mockIdentities.mockReturnValue(resolved(new Map()))
    mockReview.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    mockRole.mockReturnValue('platform_admin' as never)
  })

  it('opens on the pending queue, oldest first', () => {
    renderPage()

    expect(screen.getByRole('tab', { name: /Awaiting review/ })).toHaveAttribute('aria-selected', 'true')
    expect(mockClaims).toHaveBeenCalledWith('pending')
  })

  it('warns that FadeUp verifies nothing and that approval is permanent', () => {
    renderPage()

    // R1B deliberately built no verification engine. A reviewer who assumes
    // one exists is the exact failure this screen has to prevent.
    expect(screen.getByText(/no automated verification/i)).toBeInTheDocument()
    expect(screen.getByText(/cannot be undone or transferred/i)).toBeInTheDocument()
  })

  it('shows the claimant’s evidence as their words, attributed', () => {
    mockClaims.mockReturnValue(resolved([claim()]))
    renderPage()

    expect(screen.getByText(/Claimant’s evidence, in their words/i)).toBeInTheDocument()
    expect(screen.getByText('I have run this shop since 2019.')).toBeInTheDocument()
  })

  it('says an empty evidence field argues neither way', () => {
    mockClaims.mockReturnValue(resolved([claim({ evidence: null })]))
    renderPage()

    expect(screen.getByText(/not by itself a reason to reject, and it is not a reason to approve/i)).toBeInTheDocument()
  })

  it('offers a decision to an admin', () => {
    mockClaims.mockReturnValue(resolved([claim()]))
    renderPage()

    expect(screen.getByRole('button', { name: 'Approve claim' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  it('withholds the decision from platform_support', () => {
    mockRole.mockReturnValue('platform_support' as never)
    mockClaims.mockReturnValue(resolved([claim()]))
    renderPage()

    expect(screen.queryByRole('button', { name: 'Approve claim' })).not.toBeInTheDocument()
    expect(screen.getByText('I have run this shop since 2019.')).toBeInTheDocument()
  })

  it('offers no decision on a claim that is already decided', () => {
    mockClaims.mockReturnValue(
      resolved([claim({ state: 'approved', decidedAt: '2026-08-21T09:00:00.000Z' })]),
    )
    renderPage()

    expect(screen.queryByRole('button', { name: 'Approve claim' })).not.toBeInTheDocument()
  })

  it('labels state with words, never colour alone', () => {
    mockClaims.mockReturnValue(resolved([claim()]))
    renderPage()

    expect(screen.getByText('Awaiting review')).toBeInTheDocument()
  })

  it('shows a real empty state', () => {
    renderPage()

    expect(screen.getByText('No claims awaiting review')).toBeInTheDocument()
  })

  it('surfaces a load failure', () => {
    mockClaims.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('permission denied'),
    } as never)
    renderPage()

    expect(screen.getByText("Couldn't load claims")).toBeInTheDocument()
  })
})
