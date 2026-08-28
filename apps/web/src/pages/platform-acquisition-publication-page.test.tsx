import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformAcquisitionPublicationPage } from '@/pages/platform-acquisition-publication-page'
import { ToastProvider } from '@/components/ui/toast'
import {
  usePublicationQueue,
  usePublicationQueueCounts,
  usePublishExternalProfessional,
  useRefreshPublicationEligibility,
  type PublicationCandidate,
} from '@/lib/queries/acquisition/publication'
import { usePlatformRole } from '@/routes/require-platform-role'

vi.mock('@/lib/queries/acquisition/publication', () => ({
  usePublicationQueue: vi.fn(),
  usePublicationQueueCounts: vi.fn(),
  usePublishExternalProfessional: vi.fn(),
  useRefreshPublicationEligibility: vi.fn(),
}))
vi.mock('@/routes/require-platform-role', () => ({ usePlatformRole: vi.fn() }))

const mockQueue = vi.mocked(usePublicationQueue)
const mockCounts = vi.mocked(usePublicationQueueCounts)
const mockPublish = vi.mocked(usePublishExternalProfessional)
const mockRefresh = vi.mocked(useRefreshPublicationEligibility)
const mockRole = vi.mocked(usePlatformRole)

function candidate(overrides: Partial<PublicationCandidate> = {}): PublicationCandidate {
  return {
    prospectId: 'p-1',
    canonicalName: 'Fade City',
    country: 'FR',
    entityKind: 'independent',
    prospectType: 'barbershop',
    websiteDomain: 'fadecity.fr',
    firstDiscoveredAt: '2026-08-01T09:00:00.000Z',
    isEligible: true,
    blockReason: null,
    distinctSourceCount: 2,
    hasTrustAnchor: false,
    evaluatedAt: '2026-08-28T09:00:00.000Z',
    professionalId: null,
    isPublished: false,
    ...overrides,
  }
}

function resolved(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function idleMutation() {
  return { mutateAsync: vi.fn(), isPending: false, variables: undefined } as never
}

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <PlatformAcquisitionPublicationPage />
      </MemoryRouter>
    </ToastProvider>,
  )
}

describe('PlatformAcquisitionPublicationPage — /platform/acquisition/publication', () => {
  beforeEach(() => {
    mockQueue.mockReturnValue(resolved([]))
    mockCounts.mockReturnValue(resolved({ eligible: 0, blocked: 0, published: 0 }))
    mockPublish.mockReturnValue(idleMutation())
    mockRefresh.mockReturnValue(idleMutation())
    mockRole.mockReturnValue('platform_admin' as never)
  })

  it('opens on the queue that is actual work', () => {
    renderPage()

    expect(screen.getByRole('tab', { name: /Ready to publish/ })).toHaveAttribute('aria-selected', 'true')
    expect(mockQueue).toHaveBeenCalledWith('eligible')
  })

  it('states what publishing creates before anyone clicks it', () => {
    renderPage()

    // The safe-default promise the whole lot rests on. If this copy ever stops
    // matching the schema, an operator is being told something untrue about
    // what they are creating.
    expect(screen.getByText(/no availability, no queue and no schedule/i)).toBeInTheDocument()
    expect(screen.getByText(/invisible to the public until its owner claims it/i)).toBeInTheDocument()
  })

  it('offers Publish to an admin on an eligible candidate', () => {
    mockQueue.mockReturnValue(resolved([candidate()]))
    renderPage()

    expect(screen.getByRole('button', { name: 'Publish profile' })).toBeInTheDocument()
  })

  it('withholds Publish from platform_support, who may read but not decide', () => {
    mockRole.mockReturnValue('platform_support' as never)
    mockQueue.mockReturnValue(resolved([candidate()]))
    renderPage()

    expect(screen.queryByRole('button', { name: 'Publish profile' })).not.toBeInTheDocument()
    // Read-only still means readable: the candidate itself is on the page.
    expect(screen.getByText('Fade City')).toBeInTheDocument()
  })

  it('never offers Publish on an ineligible candidate, whatever the role', () => {
    mockQueue.mockReturnValue(
      resolved([candidate({ isEligible: false, blockReason: 'unresolved_duplicate', distinctSourceCount: 1 })]),
    )
    renderPage()

    expect(screen.queryByRole('button', { name: 'Publish profile' })).not.toBeInTheDocument()
  })

  it('tells a blocked candidate’s reader what would clear the block', () => {
    mockQueue.mockReturnValue(
      resolved([candidate({ isEligible: false, blockReason: 'insufficient_source_evidence', distinctSourceCount: 1 })]),
    )
    renderPage()

    expect(screen.getByText('Not enough identity evidence')).toBeInTheDocument()
    expect(screen.getByText(/two independent sources, or one verified business registry/i)).toBeInTheDocument()
  })

  it('distinguishes a registry record from directory agreement in words, not only an icon', () => {
    mockQueue.mockReturnValue(resolved([candidate({ hasTrustAnchor: true, distinctSourceCount: 1 })]))
    renderPage()

    expect(screen.getByText('Verified registry record')).toBeInTheDocument()
  })

  it('shows a real empty state rather than a blank panel', () => {
    renderPage()

    expect(screen.getByText('Nothing waiting to publish')).toBeInTheDocument()
  })

  it('surfaces a load failure instead of rendering an empty queue', () => {
    mockQueue.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('permission denied'),
    } as never)
    renderPage()

    expect(screen.getByText("Couldn't load the publication queue")).toBeInTheDocument()
    expect(screen.getByText('permission denied')).toBeInTheDocument()
  })
})
