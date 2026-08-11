import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PlatformAcquisitionSearchPage } from '@/pages/platform-acquisition-search-page'
import { useProspectSources } from '@/lib/queries/acquisition/sources'
import { useCreateProspectDiscoveryJob, useRecentProspectJobs } from '@/lib/queries/acquisition/jobs'
import { usePlatformRole } from '@/routes/require-platform-role'
import { ToastProvider } from '@/components/ui/toast'

vi.mock('@/lib/queries/acquisition/sources', () => ({
  useProspectSources: vi.fn(),
}))

vi.mock('@/lib/queries/acquisition/jobs', () => ({
  useCreateProspectDiscoveryJob: vi.fn(),
  useRecentProspectJobs: vi.fn(),
}))

vi.mock('@/routes/require-platform-role', () => ({
  usePlatformRole: vi.fn(),
}))

const mockUseProspectSources = vi.mocked(useProspectSources)
const mockUseCreateProspectDiscoveryJob = vi.mocked(useCreateProspectDiscoveryJob)
const mockUseRecentProspectJobs = vi.mocked(useRecentProspectJobs)
const mockUsePlatformRole = vi.mocked(usePlatformRole)

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PlatformAcquisitionSearchPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('PlatformAcquisitionSearchPage — discovery job creation', () => {
  // Reproduces the reported "crypto.randomUUID is not a function" bug: the
  // browser environment (or a non-secure/older-browser context) has no
  // crypto.randomUUID. The DB, not the browser, must generate prospect_jobs.id
  // — this only fires the (browser-only, non-authoritative) success toast.
  it('creates a discovery job with FR / Paris and shows the success toast even when crypto.randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', {
      randomUUID: undefined,
      getRandomValues: crypto.getRandomValues.bind(crypto),
    })

    mockUsePlatformRole.mockReturnValue('platform_owner')
    mockUseProspectSources.mockReturnValue({
      isPending: false,
      isError: false,
      data: [{ id: 'src-1', key: 'osm', displayName: 'OpenStreetMap', isEnabled: true, config: {}, createdAt: '', updatedAt: '' }],
    } as never)
    mockUseRecentProspectJobs.mockReturnValue({ isPending: false, isError: false, data: [] } as never)

    const mutateAsync = vi.fn().mockResolvedValue({
      id: 'server-generated-job-id',
      jobType: 'discovery',
      status: 'queued',
      priority: 100,
      payload: {},
      result: {},
      attempts: 0,
      maxAttempts: 5,
      scheduledAt: '2026-08-11T00:00:00.000Z',
      workerId: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      lastError: null,
      createdBy: 'owner-1',
      createdAt: '2026-08-11T00:00:00.000Z',
    })
    mockUseCreateProspectDiscoveryJob.mockReturnValue({ mutateAsync, isPending: false } as never)

    renderPage()

    fireEvent.change(screen.getByLabelText('City (optional)'), { target: { value: 'Paris' } })
    // Country defaults to FR already — submit as-is.
    fireEvent.click(screen.getByRole('button', { name: 'Start discovery search' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))

    const call = mutateAsync.mock.calls[0][0]
    expect(call.jobType).toBe('discovery')
    expect(call.payload).toMatchObject({ country: 'FR', city: 'Paris' })
    // The browser must never send its own id — the DB's
    // `gen_random_uuid()` default on prospect_jobs.id is authoritative.
    expect(call).not.toHaveProperty('id')
    expect(call.payload).not.toHaveProperty('id')

    // The success toast fires createUuid() for its own (non-authoritative)
    // key — this must not throw even without crypto.randomUUID.
    expect(await screen.findByText('Discovery job created')).toBeInTheDocument()
  })
})
