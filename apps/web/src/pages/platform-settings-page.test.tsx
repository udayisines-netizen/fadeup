import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/toast'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformSettingsPage } from '@/pages/platform-settings-page'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { usePlatformSettings, useSetPlatformSetting } from '@/lib/queries/platform-plat3'
import type { PlatformPermission } from '@/lib/types'

vi.mock('@/routes/require-platform-role', () => ({ usePlatformPermissions: vi.fn() }))
vi.mock('@/lib/queries/platform-plat3', () => ({
  usePlatformSettings: vi.fn(),
  useSetPlatformSetting: vi.fn(),
  refusalToken: vi.fn(() => null),
}))

const mockPermissions = vi.mocked(usePlatformPermissions)
const mockSettings = vi.mocked(usePlatformSettings)
const mockSave = vi.mocked(useSetPlatformSetting)

function query(data: unknown, extra: Record<string, unknown> = {}) {
  return { data, isPending: false, isError: false, isSuccess: true, error: null, ...extra } as never
}

function grant(...permissions: PlatformPermission[]) {
  mockPermissions.mockReturnValue({
    permissions,
    can: (permission: PlatformPermission) => permissions.includes(permission),
  })
}

const CAPACITY = {
  key: 'queue.capacity_per_barber',
  family: 'queue' as const,
  source: 'platform_settings' as const,
  value: 20,
  min_value: 1,
  max_value: 200,
  is_integer: true,
  unit: 'people',
  sort_order: 10,
  updated_at: null,
  updated_by_email: null,
}

const CANCEL = {
  key: 'booking.free_cancel_hours',
  family: 'booking' as const,
  source: 'platform_settings' as const,
  value: 12,
  min_value: 0,
  max_value: 168,
  is_integer: true,
  unit: 'hours',
  sort_order: 30,
  updated_at: '2026-09-10T09:00:00.000Z',
  updated_by_email: 'founder@fade-up.com',
}

const WEIGHT = {
  key: 'search.weight_proximity',
  family: 'search' as const,
  source: 'feed_ranking_weights' as const,
  value: 1.5,
  min_value: 0,
  max_value: 100,
  is_integer: false,
  unit: 'weight',
  sort_order: 20,
  updated_at: '2026-09-07T12:00:00.000Z',
  updated_by_email: null,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PlatformSettingsPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('PlatformSettingsPage — /platform/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    grant('platform.settings')
    mockSettings.mockReturnValue(query([CAPACITY, CANCEL, WEIGHT]))
    mockSave.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  })

  it('refuses a role without platform.settings with an honest sentence, and reads nothing', () => {
    grant('crm.read', 'promotions.apply')

    renderPage()

    expect(screen.getByText('These defaults are not visible with your role')).toBeInTheDocument()
    expect(mockSettings).not.toHaveBeenCalled()
  })

  it('states what each setting is for AND what changing it does', () => {
    renderPage()

    expect(screen.getByText('Queue capacity per barber')).toBeInTheDocument()
    expect(
      screen.getByText(/Applies to every salon that has not set its own limit\. Salons that set theirs keep it\./),
    ).toBeInTheDocument()
    // Le nombre de salons touchés n'est pas promis avant l'écriture.
    expect(screen.getByText(/cannot be known before the change/)).toBeInTheDocument()
  })

  it('shows the server bounds and its unit next to the field', () => {
    renderPage()

    expect(screen.getByText('Between 1 and 200 people')).toBeInTheDocument()
    const input = screen.getByLabelText('Value')
    expect(input).toHaveAttribute('min', '1')
    expect(input).toHaveAttribute('max', '200')
  })

  it('never shows a price and says where the plan grid actually lives', () => {
    renderPage()

    expect(screen.getByText(/The plan grid lives in the plan catalogue/)).toBeInTheDocument()
    expect(screen.queryByText(/20 €|35 €|49 €|69 €|EUR/)).not.toBeInTheDocument()
  })

  it('tells the truth about the free-cancellation window being display only', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('radio', { name: 'Booking' }))

    expect(screen.getByText('Free cancellation window')).toBeInTheDocument()
    expect(screen.getByText(/FadeUp never refuses a late cancellation/)).toBeInTheDocument()
  })

  it('says plainly that the ranking weights do not touch marketplace search, and names their source', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('radio', { name: 'Ranking' }))

    expect(screen.getByText('Feed ranking — proximity')).toBeInTheDocument()
    expect(screen.getByText(/does NOT affect marketplace search, which has no score today/)).toBeInTheDocument()
    expect(screen.getByText('Feed weight')).toBeInTheDocument()
  })

  it('shows an em dash rather than a fake author when a setting was never changed', () => {
    renderPage()

    expect(screen.getByText('Last changed — by —')).toBeInTheDocument()
    // Celui qui l'a été porte bien son auteur.
    expect(screen.queryByText(/founder@fade-up.com/)).not.toBeInTheDocument()
  })

  it('sends the key, the new value and the reason, and refuses to save an unchanged value', async () => {
    const mutate = vi.fn()
    mockSave.mockReturnValue({ mutate, isPending: false } as never)

    renderPage()

    // Rien n'a bougé : le bouton ne part pas.
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    const input = screen.getByLabelText('Value')
    await userEvent.clear(input)
    await userEvent.type(input, '30')
    await userEvent.type(screen.getByLabelText('Reason'), 'trop court le samedi')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mutate).toHaveBeenCalledWith(
      { key: 'queue.capacity_per_barber', value: 30, reason: 'trop court le samedi' },
      expect.anything(),
    )
  })
})
