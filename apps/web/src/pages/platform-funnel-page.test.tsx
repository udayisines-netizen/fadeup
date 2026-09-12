import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/toast'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformFunnelPage } from '@/pages/platform-funnel-page'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { useAcquisitionFunnel } from '@/lib/queries/platform-plat3'
import type { PlatformPermission } from '@/lib/types'

vi.mock('@/routes/require-platform-role', () => ({ usePlatformPermissions: vi.fn() }))
vi.mock('@/lib/queries/platform-plat3', () => ({
  useAcquisitionFunnel: vi.fn(),
  refusalToken: vi.fn(() => null),
}))

const mockPermissions = vi.mocked(usePlatformPermissions)
const mockFunnel = vi.mocked(useAcquisitionFunnel)

function query(data: unknown, extra: Record<string, unknown> = {}) {
  return { data, isPending: false, isError: false, isSuccess: true, error: null, ...extra } as never
}

function grant(...permissions: PlatformPermission[]) {
  mockPermissions.mockReturnValue({
    permissions,
    can: (permission: PlatformPermission) => permissions.includes(permission),
  })
}

const WINDOW = { window_from: '2026-08-14T00:00:00.000Z', window_to: '2026-09-13T00:00:00.000Z' }

/** Le seuil vient du SERVEUR : la fixture en met un autre que 20 exprès. */
const MIN_SAMPLE = 15

function row(
  stage: string,
  order: number,
  total: number | null,
  extra: Partial<Record<string, unknown>> = {},
) {
  return {
    bucket_key: 'all',
    bucket_label: '',
    stage,
    stage_order: order,
    total,
    attributable: true,
    conversion_rate: null,
    rate_suppressed: false,
    min_sample: MIN_SAMPLE,
    ...WINDOW,
    ...extra,
  }
}

const OVERALL = [
  row('published', 1, 120),
  row('requests', 2, 40, { conversion_rate: 33.3 }),
  // Échantillon précédent sous le seuil : le taux est retenu, et l'écran le dit.
  row('emails', 3, 8, { rate_suppressed: false, conversion_rate: 20 }),
  row('claims', 4, 3, { rate_suppressed: true }),
  // La coupure d'attribution : population différente, aucun taux, mais un total.
  row('trials', 5, 106, { attributable: false }),
  row('subscriptions', 6, 4, { attributable: false }),
]

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PlatformFunnelPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('PlatformFunnelPage — /platform/funnel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    grant('crm.read')
    mockFunnel.mockReturnValue(query(OVERALL))
  })

  it('refuses a role without crm.read and reads no funnel', () => {
    grant('worker.operate', 'platform.settings')

    renderPage()

    expect(screen.getByText('The acquisition funnel is not visible with your role')).toBeInTheDocument()
    expect(mockFunnel).not.toHaveBeenCalled()
  })

  it('lays the six stages out in order with their real counts', () => {
    renderPage()

    const table = screen.getByRole('region', { name: 'Everything' })
    expect(within(table).getByText('Published')).toBeInTheDocument()
    expect(within(table).getByText('120')).toBeInTheDocument()
    expect(within(table).getByText('Subscriptions')).toBeInTheDocument()
  })

  it('says "not enough data" and shows the threshold the SERVER returned, never a copied constant', () => {
    renderPage()

    expect(screen.getByText('Not enough data')).toBeInTheDocument()
    expect(screen.getByText(`The server withholds a rate below ${MIN_SAMPLE} cases.`)).toBeInTheDocument()
    expect(screen.queryByText(/below 20 cases/)).not.toBeInTheDocument()
  })

  it('refuses a rate where the population changes, and says why instead of leaving a blank', () => {
    renderPage()

    expect(screen.getByText('No rate here')).toBeInTheDocument()
    expect(
      screen.getByText(/prospects on one side, organizations on the other/),
    ).toBeInTheDocument()
  })

  it('writes "not attributable" — never 0 and never a bar — when a stage cannot be tied to a bucket', async () => {
    mockFunnel.mockReturnValue(
      query([
        { ...row('published', 1, 9), bucket_key: 'z-1', bucket_label: 'Lyon' },
        { ...row('requests', 2, 2), bucket_key: 'z-1', bucket_label: 'Lyon' },
        { ...row('emails', 3, 2), bucket_key: 'z-1', bucket_label: 'Lyon' },
        { ...row('claims', 4, 1), bucket_key: 'z-1', bucket_label: 'Lyon' },
        { ...row('trials', 5, null, { attributable: false }), bucket_key: 'z-1', bucket_label: 'Lyon' },
        { ...row('subscriptions', 6, null, { attributable: false }), bucket_key: 'z-1', bucket_label: 'Lyon' },
      ]),
    )

    renderPage()
    await userEvent.click(screen.getByRole('radio', { name: 'By zone' }))

    expect(screen.getAllByText('Not attributable')).toHaveLength(2)
    expect(
      screen.getAllByText(/Nothing in the schema links an organization back to a prospect/).length,
    ).toBeGreaterThan(0)
    // La ligne « essais » ne porte AUCUN chiffre : ni compte, ni barre, ni zéro.
    const trials = screen.getByText('Trials started').closest('tr')
    expect(trials).not.toBeNull()
    expect(trials?.textContent ?? '').toContain('Not attributable')
    expect(trials?.textContent ?? '').not.toMatch(/\d/)
  })

  it('labels the unzoned bucket "No zone" and explains it in one line', async () => {
    mockFunnel.mockReturnValue(
      query([
        { ...row('published', 1, 5), bucket_key: 'unzoned', bucket_label: '' },
        { ...row('requests', 2, 1), bucket_key: 'unzoned', bucket_label: '' },
      ]),
    )

    renderPage()
    await userEvent.click(screen.getByRole('radio', { name: 'By zone' }))

    expect(screen.getByText('No zone')).toBeInTheDocument()
    expect(screen.getByText(/Prospects with no usable city/)).toBeInTheDocument()
  })

  it('names the period in the empty state rather than drawing six bars at zero', () => {
    mockFunnel.mockReturnValue(
      query([
        row('published', 1, 0),
        row('requests', 2, 0),
        row('emails', 3, 0),
        row('claims', 4, 0),
        row('trials', 5, 0),
        row('subscriptions', 6, 0),
      ]),
    )

    renderPage()

    expect(screen.getByText(/Nothing happened between .+ and .+/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Everything' })).not.toBeInTheDocument()
  })

  it('invents nothing: no goal, no target, no projection anywhere on the page', () => {
    const { container } = renderPage()

    expect(container.textContent ?? '').not.toMatch(/\btarget\b|\bgoal\b|\bprojection\b|\bforecast\b/i)
  })
})
