import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/toast'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformWorkerPage } from '@/pages/platform-worker-page'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import {
  useCreateProspectDiscoveryJob,
  useProspectWorkerPasses,
  useProspectWorkerState,
  useSetProspectWorkerPaused,
} from '@/lib/queries/platform-plat3'
import type { PlatformPermission } from '@/lib/types'

vi.mock('@/routes/require-platform-role', () => ({ usePlatformPermissions: vi.fn() }))
vi.mock('@/lib/queries/platform-plat3', () => ({
  useProspectWorkerState: vi.fn(),
  useProspectWorkerPasses: vi.fn(),
  useSetProspectWorkerPaused: vi.fn(),
  useCreateProspectDiscoveryJob: vi.fn(),
  refusalToken: vi.fn(() => null),
}))

const mockPermissions = vi.mocked(usePlatformPermissions)
const mockState = vi.mocked(useProspectWorkerState)
const mockPasses = vi.mocked(useProspectWorkerPasses)
const mockPause = vi.mocked(useSetProspectWorkerPaused)
const mockLaunch = vi.mocked(useCreateProspectDiscoveryJob)

function query(data: unknown, extra: Record<string, unknown> = {}) {
  return { data, isPending: false, isError: false, isSuccess: true, error: null, ...extra } as never
}

function grant(...permissions: PlatformPermission[]) {
  mockPermissions.mockReturnValue({
    permissions,
    can: (permission: PlatformPermission) => permissions.includes(permission),
  })
}

const RUNNING = {
  is_paused: false,
  paused_at: null,
  paused_by_email: null,
  pause_reason: null,
  last_poll_at: '2026-09-12T10:00:00.000Z',
  seconds_since_last_poll: 4,
  last_poll_worker_id: 'worker-a',
  last_claim_at: '2026-09-12T09:59:00.000Z',
  last_successful_pass_at: '2026-09-12T08:00:00.000Z',
  jobs_queued: 2,
  jobs_running: 1,
  jobs_failed: 0,
  prospects_total: 1204,
  prospects_last_7_days: 37,
  is_live: true,
}

const PAUSED = {
  ...RUNNING,
  is_paused: true,
  paused_at: '2026-09-12T09:00:00.000Z',
  paused_by_email: 'founder@fade-up.com',
  pause_reason: 'quota Resend épuisé',
}

const DOWN = { ...RUNNING, is_live: false, seconds_since_last_poll: 518400 }

const PASS = {
  id: 'j-1',
  job_type: 'discovery' as const,
  status: 'completed',
  priority: 100,
  created_at: '2026-09-12T08:00:00.000Z',
  started_at: '2026-09-12T08:00:05.000Z',
  completed_at: '2026-09-12T08:04:00.000Z',
  failed_at: null,
  attempts: 1,
  worker_id: 'worker-a',
  launched_by_email: 'founder@fade-up.com',
  candidates_found: null,
  prospects_created: 12,
  sources_total: 4,
  sources_failed: 1,
  last_error: null,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PlatformWorkerPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('PlatformWorkerPage — /platform/worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    grant('worker.operate')
    mockState.mockReturnValue(query(RUNNING))
    mockPasses.mockReturnValue(query([]))
    mockPause.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    mockLaunch.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  })

  it('refuses a role without worker.operate and asks the worker nothing', () => {
    grant('crm.read', 'promotions.apply')

    renderPage()

    expect(screen.getByText('The worker is not visible with your role')).toBeInTheDocument()
    expect(mockState).not.toHaveBeenCalled()
    expect(mockPasses).not.toHaveBeenCalled()
  })

  it('says RUNNING when the heartbeat is fresh and nothing is paused', () => {
    renderPage()

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.queryByText('Paused')).not.toBeInTheDocument()
    expect(screen.queryByText('Down')).not.toBeInTheDocument()
  })

  it('says PAUSED with who, when and why — never a bare badge', () => {
    mockState.mockReturnValue(query(PAUSED))

    renderPage()

    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByText(/Paused by founder@fade-up\.com on/)).toBeInTheDocument()
    expect(screen.getByText(/quota Resend épuisé/)).toBeInTheDocument()
    expect(screen.queryByText('Down')).not.toBeInTheDocument()
  })

  it('says DOWN in words that cannot be read as a pause', () => {
    mockState.mockReturnValue(query(DOWN))

    renderPage()

    expect(screen.getByText('Down')).toBeInTheDocument()
    expect(screen.getByText(/The worker process is not polling the database\. This is not a pause/)).toBeInTheDocument()
  })

  it('says BOTH when the worker was paused and is also no longer polling', () => {
    mockState.mockReturnValue(query({ ...PAUSED, is_live: false }))

    renderPage()

    expect(screen.getByText('Down')).toBeInTheDocument()
    expect(screen.getByText('Also paused')).toBeInTheDocument()
    expect(screen.getByText(/Paused by founder@fade-up\.com on/)).toBeInTheDocument()
    expect(screen.getByText(/resuming it here will change nothing/)).toBeInTheDocument()
  })

  it('requires a reason before pausing, and never pauses on a bare click', async () => {
    const mutate = vi.fn()
    mockPause.mockReturnValue({ mutate, isPending: false } as never)

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))

    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause' }))
    expect(mutate).not.toHaveBeenCalled()

    await userEvent.type(within(dialog).getByLabelText('Reason'), 'incident disque')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause' }))
    expect(mutate).toHaveBeenCalledWith({ paused: true, reason: 'incident disque' }, expect.anything())
  })

  it('never launches a pass on a bare click, and says what a pass does before it runs', async () => {
    const mutate = vi.fn()
    mockLaunch.mockReturnValue({ mutate, isPending: false } as never)

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Launch a pass' }))

    expect(mutate).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText(/writes to the database and can create hundreds of prospects/),
    ).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Launch the pass' }))
    expect(mutate).toHaveBeenCalledWith({ jobType: 'discovery' }, expect.anything())
  })

  it('renders a missing counter as an em dash, never as zero, and names who launched the pass', () => {
    mockPasses.mockReturnValue(query([PASS]))

    renderPage()

    const log = screen.getByRole('region', { name: 'Pass log' })
    expect(within(log).getByText('12')).toBeInTheDocument()
    expect(within(log).queryByText('0')).not.toBeInTheDocument()
    expect(within(log).getByText('—')).toBeInTheDocument()
    expect(within(log).getByText('founder@fade-up.com')).toBeInTheDocument()
    expect(within(log).getByText('1 failed of 4')).toBeInTheDocument()
  })

  it('shows an honest empty state rather than an empty table when nothing was ever launched', () => {
    renderPage()

    expect(screen.getByText('No pass yet')).toBeInTheDocument()
    expect(screen.getByText(/Launching one writes to the database/)).toBeInTheDocument()
  })
})
