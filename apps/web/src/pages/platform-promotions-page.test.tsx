import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/toast'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformPromotionsPage } from '@/pages/platform-promotions-page'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import { useAllOrganizations, useOwnPlatformRole } from '@/lib/queries/platform'
import {
  useApplyPromotion,
  useBillingCatalog,
  useCreatePromotion,
  useEndPromotion,
  usePromotionRedemptions,
  usePromotionRoleLimits,
  usePromotions,
  useRevokePromotionRedemption,
  useVerifyPromotionSync,
} from '@/lib/queries/platform-plat3'
import type { PlatformPermission } from '@/lib/types'

vi.mock('@/routes/require-platform-role', () => ({ usePlatformPermissions: vi.fn() }))
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u-1' }, session: null, loading: false }) }))
vi.mock('@/lib/queries/platform', () => ({
  useAllOrganizations: vi.fn(),
  useOwnPlatformRole: vi.fn(),
}))
vi.mock('@/lib/queries/platform-plat3', () => ({
  usePromotions: vi.fn(),
  usePromotionRedemptions: vi.fn(),
  usePromotionRoleLimits: vi.fn(),
  useBillingCatalog: vi.fn(),
  useCreatePromotion: vi.fn(),
  useVerifyPromotionSync: vi.fn(),
  useEndPromotion: vi.fn(),
  useApplyPromotion: vi.fn(),
  useRevokePromotionRedemption: vi.fn(),
  refusalToken: vi.fn(() => null),
}))

const mockPermissions = vi.mocked(usePlatformPermissions)
const mockOrganizations = vi.mocked(useAllOrganizations)
const mockRole = vi.mocked(useOwnPlatformRole)
const mockPromotions = vi.mocked(usePromotions)
const mockRedemptions = vi.mocked(usePromotionRedemptions)
const mockLimits = vi.mocked(usePromotionRoleLimits)
const mockCatalog = vi.mocked(useBillingCatalog)
const mockCreate = vi.mocked(useCreatePromotion)
const mockVerify = vi.mocked(useVerifyPromotionSync)
const mockEnd = vi.mocked(useEndPromotion)
const mockApply = vi.mocked(useApplyPromotion)
const mockRevoke = vi.mocked(useRevokePromotionRedemption)

function query(data: unknown, extra: Record<string, unknown> = {}) {
  return { data, isPending: false, isError: false, isSuccess: true, error: null, ...extra } as never
}

function mutation() {
  return { mutate: vi.fn(), isPending: false } as never
}

function grant(...permissions: PlatformPermission[]) {
  mockPermissions.mockReturnValue({
    permissions,
    can: (permission: PlatformPermission) => permissions.includes(permission),
  })
}

const CONFIRMED = {
  id: 'p-1',
  code: 'RENTREE20',
  kind: 'percent' as const,
  percent_off: 20,
  amount_off_minor: null,
  duration: 'repeating' as const,
  duration_in_months: 3,
  starts_at: '2026-09-01T00:00:00.000Z',
  ends_at: '2026-10-01T00:00:00.000Z',
  max_redemptions: 50,
  redeemed_count: 4,
  active_redemptions: 3,
  eligible_plan_keys: [],
  status: 'active' as const,
  stripe_coupon_id: 'fadeup_promo_rentree20',
  stripe_confirmed_at: '2026-09-01T00:00:10.000Z',
  stripe_error: null,
  note: null,
  created_at: '2026-09-01T00:00:00.000Z',
  created_by_email: 'founder@fade-up.com',
}

const WAITING = {
  ...CONFIRMED,
  id: 'p-2',
  code: 'ATTENTE10',
  percent_off: 10,
  stripe_confirmed_at: null,
  stripe_coupon_id: 'fadeup_promo_attente10',
}

const REFUSED = {
  ...WAITING,
  id: 'p-3',
  code: 'REFUSE5',
  percent_off: 5,
  stripe_error: 'coupon already exists',
}

const REDEMPTION_CODE = {
  id: 'r-1',
  promotion_id: 'p-1',
  code: 'RENTREE20',
  organization_id: 'o-1',
  organization_name: 'Salon Bellecour',
  applied_via: 'code' as const,
  applied_at: '2026-09-05T09:00:00.000Z',
  applied_by_email: null,
  reason: null,
  percent_off: 20,
  amount_off_minor: null,
  status: 'active' as const,
  revoked_at: null,
  revoke_reason: null,
}

const REDEMPTION_STAFF = {
  ...REDEMPTION_CODE,
  id: 'r-2',
  organization_id: 'o-2',
  organization_name: 'Fade Factory',
  applied_via: 'staff' as const,
  applied_by_email: 'sales@fade-up.com',
  reason: 'geste commercial après incident',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PlatformPromotionsPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('PlatformPromotionsPage — /platform/promotions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    grant('promotions.apply', 'promotions.manage', 'tenant.read')
    mockRole.mockReturnValue(query('platform_owner'))
    mockLimits.mockReturnValue(
      query([
        { role: 'platform_owner', max_percent_off: 100, max_amount_off_minor: 100000, max_duration_months: 36, may_grant_forever: true },
        { role: 'platform_sales', max_percent_off: 20, max_amount_off_minor: 5000, max_duration_months: 3, may_grant_forever: false },
      ]),
    )
    mockPromotions.mockReturnValue(query([CONFIRMED]))
    mockRedemptions.mockReturnValue(query([]))
    mockCatalog.mockReturnValue(query([]))
    mockOrganizations.mockReturnValue(query([{ id: 'o-1', name: 'Salon Bellecour', slug: 'bellecour', createdAt: '' }]))
    mockCreate.mockReturnValue(mutation())
    mockVerify.mockReturnValue(mutation())
    mockEnd.mockReturnValue(mutation())
    mockApply.mockReturnValue(mutation())
    mockRevoke.mockReturnValue(mutation())
  })

  it('refuses a role without promotions.apply and reads no promotion', () => {
    grant('worker.operate')

    renderPage()

    expect(screen.getByText('Promotions are not visible with your role')).toBeInTheDocument()
    expect(mockPromotions).not.toHaveBeenCalled()
  })

  it('never calls an unconfirmed promotion active, and removes the action that would apply it', () => {
    mockPromotions.mockReturnValue(query([CONFIRMED, WAITING]))

    renderPage()

    const list = screen.getByRole('region', { name: 'Promotions' })
    expect(within(list).getByText('Waiting for Stripe')).toBeInTheDocument()
    expect(within(list).getByText(/the discount does not exist yet and cannot be applied/)).toBeInTheDocument()
    // Une seule promotion est applicable : celle que Stripe a confirmée.
    expect(within(list).getAllByRole('button', { name: 'Apply' })).toHaveLength(1)
  })

  it('shows the Stripe error verbatim when Stripe refused', () => {
    mockPromotions.mockReturnValue(query([REFUSED]))

    renderPage()

    expect(screen.getByText('Stripe refused')).toBeInTheDocument()
    expect(screen.getByText('coupon already exists')).toBeInTheDocument()
  })

  it('hides creation, ending and revocation from a sales rep, who keeps the apply path', () => {
    grant('promotions.apply', 'tenant.read')
    mockRole.mockReturnValue(query('platform_sales'))
    mockRedemptions.mockReturnValue(query([REDEMPTION_STAFF]))

    renderPage()

    expect(screen.queryByRole('button', { name: 'New promotion' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check Stripe' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
  })

  it('shows the ceiling of the CALLER role, not the most permissive row in the table', () => {
    grant('promotions.apply', 'tenant.read')
    mockRole.mockReturnValue(query('platform_sales'))

    renderPage()

    expect(screen.getByText(/up to 20% off, for up to 3 months/)).toBeInTheDocument()
    expect(screen.queryByText(/up to 100% off/)).not.toBeInTheDocument()
  })

  it('says why applying is impossible rather than offering an empty organization picker', () => {
    grant('promotions.apply')
    mockRole.mockReturnValue(query('platform_sales'))

    renderPage()

    expect(screen.getByText(/needs the organization directory, which your role cannot read/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
    expect(mockOrganizations).not.toHaveBeenCalled()
  })

  it('tells each redemption apart: a code typed by the salon versus a sales rep', () => {
    mockRedemptions.mockReturnValue(query([REDEMPTION_CODE, REDEMPTION_STAFF]))

    renderPage()

    const list = screen.getByRole('region', { name: 'Discounts granted' })
    expect(within(list).getByText('Code typed by the salon')).toBeInTheDocument()
    expect(within(list).getByText('Posted by a sales rep')).toBeInTheDocument()
    expect(within(list).getByText('sales@fade-up.com')).toBeInTheDocument()
    expect(within(list).getByText('geste commercial après incident')).toBeInTheDocument()
  })

  it('warns and requires a reason before ending a promotion, and never ends on a bare click', async () => {
    const mutate = vi.fn()
    mockEnd.mockReturnValue({ mutate, isPending: false } as never)

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'End' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'End the promotion' }))
    expect(mutate).not.toHaveBeenCalled()

    await userEvent.type(within(dialog).getByLabelText('Reason'), 'campagne terminée')
    await userEvent.click(within(dialog).getByRole('button', { name: 'End the promotion' }))
    expect(mutate).toHaveBeenCalledWith({ promotionId: 'p-1', reason: 'campagne terminée' }, expect.anything())
  })

  it('warns and requires a reason before revoking a granted discount', async () => {
    const mutate = vi.fn()
    mockRevoke.mockReturnValue({ mutate, isPending: false } as never)
    mockRedemptions.mockReturnValue(query([REDEMPTION_STAFF]))

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/the next invoice is at full price/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke the discount' }))
    expect(mutate).not.toHaveBeenCalled()

    await userEvent.type(within(dialog).getByLabelText('Reason'), 'erreur de saisie')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke the discount' }))
    expect(mutate).toHaveBeenCalledWith({ redemptionId: 'r-2', reason: 'erreur de saisie' }, expect.anything())
  })

  it('requires both a salon and a reason before applying a discount', async () => {
    const mutate = vi.fn()
    mockApply.mockReturnValue({ mutate, isPending: false } as never)

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))

    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    expect(mutate).not.toHaveBeenCalled()

    await userEvent.selectOptions(within(dialog).getByLabelText('Salon'), 'o-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    expect(mutate).not.toHaveBeenCalled()

    await userEvent.type(within(dialog).getByLabelText('Reason'), 'client historique')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    expect(mutate).toHaveBeenCalledWith(
      { organizationId: 'o-1', promotionId: 'p-1', reason: 'client historique' },
      expect.anything(),
    )
  })

  it('offers only payable plans for eligibility, and shows no price on this screen', async () => {
    mockCatalog.mockReturnValue(
      query([
        { plan_key: 'free', display_name: 'Free', price_minor: 0, price_currency: 'EUR', is_available: true, tier: 0 },
        { plan_key: 'independent', display_name: 'Independent', price_minor: 2000, price_currency: 'EUR', is_available: true, tier: 1 },
      ]),
    )

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'New promotion' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Independent')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Free')).not.toBeInTheDocument()
    expect(dialog.textContent ?? '').not.toMatch(/20,00|20\.00|€20/)
  })

  it('refuses a malformed code client-side without ever calling the server', async () => {
    const mutate = vi.fn()
    mockCreate.mockReturnValue({ mutate, isPending: false } as never)

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'New promotion' }))

    const dialog = screen.getByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Code'), 'AB')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(mutate).not.toHaveBeenCalled()
    expect(within(dialog).getByText('A promotion code is 4 to 24 letters or digits.')).toBeInTheDocument()
  })
})
